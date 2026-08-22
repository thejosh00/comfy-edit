/**
 * Serves a folder of images from the machine running the dev server, so the app
 * can open pictures ComfyUI has never seen.
 *
 * This runs in Node, inside Vite — it is the one part of the app that is not
 * browser code. It lives here rather than in src/core/ because it needs node:fs;
 * everything shape-related is in src/core/localImages.ts and shared with the UI.
 *
 * Same-origin is the whole point: an <img> or a fetch from another origin taints
 * the canvas, and a tainted canvas makes both getImageData and toBlob throw — so
 * a folder image would load and then be impossible to draw on or transform.
 */
import { createReadStream } from 'node:fs'
import { lstat, readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Connect, Plugin } from 'vite'
import {
  alphabetical,
  isImageFilename,
  newestFirst,
  LOCAL_BASE,
  type DirListing,
  type LocalImage,
} from '../core/localImages'

/** Enough for a working folder; a picker showing thousands is not usable anyway. */
const DEFAULT_LIMIT = 500

/** Deep enough for date-organised output folders, shallow enough to stay quick. */
const MAX_DEPTH = 6

/**
 * How much of a tree to look at before giving up on seeing all of it. The folder
 * is chosen in the app, so it can be a home directory with a hundred thousand
 * files under it — without a budget the picker would hang on a full recursive
 * stat. Spending the budget reports as `truncated`, the same as any other cap.
 */
const SCAN_LIMIT = 5000

const CONTENT_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.avif': 'image/avif',
}

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[extname(name).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * The subdirectories of `path`, for the folder chooser, or null if `path` is not
 * a directory that can be browsed. Only names are returned — no recursion and no
 * image counting, so opening a rung stays cheap on a large tree.
 */
export async function listDirs(path: string): Promise<DirListing | null> {
  // A relative path would resolve against the dev server's working directory,
  // which is nobody's intent; the client only ever sends absolute ones back.
  if (!path || !isAbsolute(path) || path.includes('\0')) return null

  const abs = resolve(path)
  const info = await stat(abs).catch(() => null)
  if (!info?.isDirectory()) return null

  const entries = await readdir(abs, { withFileTypes: true }).catch(() => null)
  if (!entries) return null

  const dirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))

  const parent = dirname(abs)
  return { path: abs, parent: parent === abs ? null : parent, dirs }
}

/** Where the chooser opens when it has nowhere else to start. */
export function defaultBrowsePath(): string {
  return homedir()
}

export type Listing = { images: LocalImage[]; truncated: boolean }

/**
 * Every image under `root`, in alphabetical order. A root that does not exist
 * lists as empty rather than throwing: a folder can be deleted between being
 * chosen and being opened again, and that should read as "no images" rather than
 * taking the picker down.
 */
export async function listImages(
  root: string,
  opts: { limit?: number; scanLimit?: number } = {},
): Promise<Listing> {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const scanLimit = opts.scanLimit ?? SCAN_LIMIT
  const rootAbs = resolve(root)
  const found: LocalImage[] = []
  let exhausted = false

  async function walk(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > MAX_DEPTH) return
    if (found.length >= scanLimit) {
      exhausted = true
      return
    }

    const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return

    for (const entry of entries) {
      // Dot-entries hold caches, thumbnails and version-control metadata.
      if (entry.name.startsWith('.')) continue
      // Symlinks are skipped rather than followed. A link inside the root can
      // point anywhere on the disk, which would undo resolveWithinRoot's work.
      if (entry.isSymbolicLink()) continue

      const childRel = rel ? `${rel}/${entry.name}` : entry.name
      const childAbs = join(dir, entry.name)

      if (entry.isDirectory()) {
        await walk(childAbs, childRel, depth + 1)
        continue
      }
      if (!entry.isFile() || !isImageFilename(entry.name)) continue
      if (found.length >= scanLimit) {
        exhausted = true
        return
      }

      const info = await stat(childAbs).catch(() => null)
      if (!info) continue
      found.push({ path: childRel, size: info.size, mtime: Math.round(info.mtimeMs) })
    }
  }

  await walk(rootAbs, '', 0)

  // Two different orders doing two different jobs. The cap is applied by recency,
  // because in a folder of renders the newest are the ones being worked on and
  // capping A-Z would keep the oldest half. What comes back is then sorted for
  // reading, which is what the picker shows.
  const kept = newestFirst(found).slice(0, limit)
  return { images: alphabetical(kept), truncated: exhausted || found.length > limit }
}

/**
 * The absolute path `rel` names inside `root`, or null if it names anything else.
 *
 * The path arrives as a query parameter, so this is the only thing standing
 * between the file route and an arbitrary read on the machine running the dev
 * server. Non-image extensions are refused too: the listing never offers one, so
 * a request for one is either a mistake or someone probing.
 */
export function resolveWithinRoot(root: string, rel: string): string | null {
  if (!rel || rel.includes('\0')) return null
  if (isAbsolute(rel)) return null
  if (!isImageFilename(rel)) return null

  const rootAbs = resolve(root)
  const abs = resolve(rootAbs, rel)
  const back = relative(rootAbs, abs)
  if (!back || back.startsWith('..') || isAbsolute(back)) return null

  return abs
}

function sendJson(res: import('node:http').ServerResponse, body: unknown): void {
  const payload = JSON.stringify(body)
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

function notFound(res: import('node:http').ServerResponse): void {
  res.statusCode = 404
  res.setHeader('Content-Type', 'text/plain')
  res.end('Not found')
}

/**
 * Mounts the three routes behind the folder chooser:
 *
 *   /local/dirs?path=   the subdirectories of one directory, for browsing
 *   /local/images?dir=  every image under a chosen directory
 *   /local/file?dir=&path=  one of those images
 *
 * The directory is chosen in the app and travels with each request, so nothing
 * here holds mutable state and two tabs can sit in different folders.
 *
 * Note what that means: any directory the dev server's user can read is
 * browsable, and any image under a chosen one is readable, by anything that can
 * reach this port. That is the same trust boundary the /comfy proxy already
 * assumes — a dev server on the loopback interface — but it is a wider surface
 * than a single configured root, so it is worth knowing about.
 */
export function localFolderPlugin(): Plugin {
  const middleware: Connect.NextHandleFunction = (req, res, next) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === `${LOCAL_BASE}/dirs`) {
      const path = url.searchParams.get('path') || defaultBrowsePath()
      void listDirs(path).then((listing) => {
        if (!listing) {
          notFound(res)
          return
        }
        sendJson(res, listing)
      })
      return
    }

    if (url.pathname === `${LOCAL_BASE}/images`) {
      const dir = url.searchParams.get('dir') ?? ''
      if (!dir || !isAbsolute(dir) || dir.includes('\0')) {
        notFound(res)
        return
      }
      const root = resolve(dir)
      void listImages(root).then(({ images, truncated }) => {
        sendJson(res, { root, truncated, images })
      })
      return
    }

    if (url.pathname === `${LOCAL_BASE}/file`) {
      const dir = url.searchParams.get('dir') ?? ''
      // The traversal guard still earns its keep: it is what keeps a chosen
      // folder's listing and its file reads describing the same set of files.
      const abs =
        isAbsolute(dir) && !dir.includes('\0')
          ? resolveWithinRoot(dir, url.searchParams.get('path') ?? '')
          : null
      if (!abs) {
        notFound(res)
        return
      }
      // lstat, not stat: stat follows symlinks, which would serve the target of a
      // link that resolveWithinRoot only checked the *name* of.
      void lstat(abs).then(
        (info) => {
          if (!info.isFile()) {
            notFound(res)
            return
          }
          res.statusCode = 200
          res.setHeader('Content-Type', contentTypeFor(abs))
          res.setHeader('Content-Length', String(info.size))
          // The folder is live: a file can be replaced while the app is open.
          res.setHeader('Cache-Control', 'no-cache')
          createReadStream(abs).pipe(res)
        },
        () => notFound(res),
      )
      return
    }

    next()
  }

  return {
    name: 'comfy-edit:local-folder',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    // `vite preview` builds its own server, exactly as it does for the proxy.
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    },
  }
}

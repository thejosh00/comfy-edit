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
import { lstat, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
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

/** Twice the ~73px tile, so thumbnails stay sharp on a high-density display. */
export const THUMB_SIZE = 160

export type Thumbnail = { body: Buffer; contentType: string }

/**
 * sharp is a native module and the only part of this that can fail to build. It
 * is loaded once, lazily, and its absence degrades to serving the original file
 * rather than taking the picker down — slow, but working.
 */
type SharpFactory = typeof import('sharp')

let sharpModule: SharpFactory | null | undefined
async function loadSharp(): Promise<SharpFactory | null> {
  if (sharpModule !== undefined) return sharpModule
  let loaded: SharpFactory | null = null
  try {
    // sharp is CommonJS (`export =`), so which of these two holds the callable
    // depends on how the loader interops it. Take whichever one is a function.
    const mod = (await import('sharp')) as unknown as SharpFactory & { default?: SharpFactory }
    loaded = typeof mod.default === 'function' ? mod.default : mod
  } catch {
    loaded = null
  }
  sharpModule = loaded
  return loaded
}

/**
 * A tile-sized WebP of one image, or null if it is not an image this can read.
 * Cropped to a square because the tile renders with `object-fit: cover` — doing
 * it here means the bytes sent are the bytes shown.
 */
export async function renderThumbnail(abs: string, size = THUMB_SIZE): Promise<Thumbnail | null> {
  const sharp = await loadSharp()
  if (!sharp) {
    // No resizer: hand back the original so the picker still shows something.
    const body = await readFile(abs).catch(() => null)
    return body ? { body, contentType: contentTypeFor(abs) } : null
  }
  try {
    const body = await sharp(abs, { failOn: 'error' })
      .resize(size, size, { fit: 'cover', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer()
    return { body, contentType: 'image/webp' }
  } catch {
    return null
  }
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
 * Where a save should be written, or null if the request does not name a file
 * directly inside `dir`. The name arrives as a query parameter, so this is what
 * keeps a save inside the folder the user chose rather than anywhere on the disk.
 *
 * Stricter than resolveWithinRoot: no subdirectories, since the dialog asks for a
 * filename and a path would write somewhere the user did not choose.
 */
export function resolveSaveTarget(dir: string, name: string): string | null {
  if (!dir || !isAbsolute(dir) || dir.includes('\0')) return null
  if (!name || name.includes('\0')) return null
  if (name.includes('/') || name.includes('\\')) return null
  if (name === '.' || name === '..') return null
  if (extname(name).toLowerCase() !== '.png') return null
  if (name.length === '.png'.length) return null

  const abs = resolve(dir, name)
  // Belt and braces: after all of the above, the result must still sit directly
  // inside the folder.
  if (dirname(abs) !== resolve(dir)) return null
  return abs
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
 * A request carrying `v` names one version of one file, so it can be cached
 * forever — the listing hands out a new `v` when the file changes. Without one
 * the folder is live and the answer has to be revalidated every time, which is
 * what made reopening the picker re-download everything.
 */
function cacheControlFor(url: URL): string {
  return url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache'
}

function fail(res: import('node:http').ServerResponse, status: number, reason: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ reason }))
}

/** A generous ceiling for one image, and a bound on what a stray POST can buffer. */
const MAX_SAVE_BYTES = 64 * 1024 * 1024

function readBody(req: import('node:http').IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve_) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_SAVE_BYTES) {
        req.destroy()
        resolve_(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve_(Buffer.concat(chunks)))
    req.on('error', () => resolve_(null))
  })
}

/**
 * Mounts the three routes behind the folder chooser:
 *
 *   /local/dirs?path=       the subdirectories of one directory, for browsing
 *   /local/images?dir=      every image under a chosen directory
 *   /local/file?dir=&path=  one of those images
 *   /local/save?dir=&name=  POST, writes one image into a chosen directory
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

    if (url.pathname === `${LOCAL_BASE}/save`) {
      if (req.method !== 'POST') {
        fail(res, 405, 'Saving is a POST.')
        return
      }
      const target = resolveSaveTarget(
        url.searchParams.get('dir') ?? '',
        url.searchParams.get('name') ?? '',
      )
      if (!target) {
        fail(res, 400, 'That is not a filename that can be saved to this folder.')
        return
      }
      void readBody(req).then(async (body) => {
        if (!body?.length) {
          fail(res, 400, 'The image was empty.')
          return
        }
        try {
          // 'wx' fails rather than overwrites. Replacing a file the user did not
          // mean to name is the one mistake here that cannot be undone.
          await writeFile(target, body, { flag: 'wx' })
          sendJson(res, { path: target })
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code
          if (code === 'EEXIST') {
            fail(res, 409, `"${basename(target)}" already exists in that folder.`)
            return
          }
          fail(res, 500, `Could not write the file (${code ?? 'unknown error'}).`)
        }
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

    if (url.pathname === `${LOCAL_BASE}/thumb`) {
      const dir = url.searchParams.get('dir') ?? ''
      const abs =
        isAbsolute(dir) && !dir.includes('\0')
          ? resolveWithinRoot(dir, url.searchParams.get('path') ?? '')
          : null
      if (!abs) {
        notFound(res)
        return
      }
      void renderThumbnail(abs).then((thumb) => {
        if (!thumb) {
          notFound(res)
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', thumb.contentType)
        res.setHeader('Content-Length', String(thumb.body.length))
        res.setHeader('Cache-Control', cacheControlFor(url))
        res.end(thumb.body)
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
          res.setHeader('Cache-Control', cacheControlFor(url))
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

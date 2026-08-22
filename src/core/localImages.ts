/**
 * A folder of images on the machine running the dev server, listed by our own
 * middleware (see src/server/localFolder.ts) rather than by ComfyUI. Nothing here
 * touches the DOM or the network — the fetching lives in src/comfy/client.ts and
 * the walking lives in src/server/.
 */

/** Same-origin, for the same reason /comfy is: a cross-origin image taints the canvas. */
export const LOCAL_BASE = '/local'

export class LocalFolderError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocalFolderError'
  }
}

export type LocalImage = {
  /** Posix-style, relative to the configured root. The middleware's file key. */
  path: string
  size: number
  /** Epoch milliseconds. */
  mtime: number
}

export type LocalFolder = {
  /** The absolute root, shown to the user so they know which folder they are in. */
  root: string | null
  /** True when the listing hit its cap, so the UI can say the list is partial. */
  truncated: boolean
  images: LocalImage[]
}

/** One rung of the directory chooser. */
export type DirListing = {
  /** Absolute and normalised, as the server resolved it. */
  path: string
  /** Null at the filesystem root, which is what hides "up". */
  parent: string | null
  /** Subdirectory names, alphabetical. */
  dirs: string[]
}

/**
 * Where the chosen folder is remembered. Per browser, not per server: the choice
 * is the user's, and a second tab opening on a different folder would be the more
 * surprising behaviour.
 */
export const FOLDER_STORAGE_KEY = 'comfy-edit.imagesDir'

/**
 * What a browser can decode and `createImageBitmap` will accept. Deliberately not
 * every format on earth: an entry the picker offers but the canvas cannot draw is
 * worse than one it never offered.
 */
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif'] as const

export function isImageFilename(name: string): boolean {
  const dot = name.lastIndexOf('.')
  // `dot < 1` rejects both "noextension" and ".png" — the latter is a dotfile
  // whose whole name is the extension, not an image called nothing.
  if (dot < 1) return false
  const ext = name.slice(dot).toLowerCase()
  return (IMAGE_EXTENSIONS as readonly string[]).includes(ext)
}

/**
 * Newest first, ties broken by path. The tie-break is not cosmetic: files that
 * arrived in one batch share an mtime to the millisecond, and without it their
 * order is whatever readdir returned, which differs between filesystems.
 *
 * Not what the picker displays — see `alphabetical`. This decides which images
 * survive the listing cap, where recency is the useful question.
 */
export function newestFirst(images: readonly LocalImage[]): LocalImage[] {
  return [...images].sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
}

/**
 * A-Z by path, the order the picker shows. Numeric so an unpadded `render-2`
 * precedes `render-10`, and case-insensitive so the list reads the way a file
 * manager's does. Sorting by the whole path keeps each subfolder together.
 *
 * The final comparison is the tie-break: `sensitivity: 'base'` calls names that
 * differ only by case equal, which would otherwise leave their order to chance.
 */
export function alphabetical(images: readonly LocalImage[]): LocalImage[] {
  return [...images].sort(
    (a, b) =>
      a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }) ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  )
}

/**
 * `version` is the file's mtime. The folder is live, so these URLs cannot simply
 * be cached forever — but keyed on mtime, an unchanged file is never re-fetched
 * and a changed one gets a URL the cache has never seen. No revalidation round
 * trip in either case, which is what makes reopening the picker free.
 */
function versioned(route: string, params: Record<string, string>, version?: number): string {
  const query = new URLSearchParams(params)
  if (version !== undefined) query.set('v', String(version))
  return `${LOCAL_BASE}/${route}?${query}`
}

export function localFileUrl(dir: string, path: string, version?: number): string {
  return versioned('file', { dir, path }, version)
}

/**
 * A tile-sized version of one image. Tiles render at ~73px, so sending the full
 * file — routinely 2.5MB for a render — is hundreds of megabytes for a folder
 * that shows as a few hundred kilobytes of thumbnails.
 */
export function thumbUrl(dir: string, path: string, version?: number): string {
  return versioned('thumb', { dir, path }, version)
}

export function imagesUrl(dir: string): string {
  return `${LOCAL_BASE}/images?${new URLSearchParams({ dir })}`
}

/**
 * Browse a directory. With no path the server answers with the home directory —
 * sending an empty one instead would be a request to browse "", which is not a
 * place.
 */
export function dirsUrl(path?: string | null): string {
  return path ? `${LOCAL_BASE}/dirs?${new URLSearchParams({ path })}` : `${LOCAL_BASE}/dirs`
}

/**
 * The full identity of an image — used for the tooltip and the alt text, where
 * there is room for it and the subfolder is often what tells two files apart.
 */
export function displayName(path: string): string {
  return path
}

/**
 * The tile caption. A thumbnail is only wide enough for a few characters, and the
 * leading folder is the part they can least afford: every file in one subfolder
 * would caption identically. The full path stays on the tooltip.
 */
export function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

function isRecord(json: unknown): json is Record<string, unknown> {
  return !!json && typeof json === 'object' && !Array.isArray(json)
}

export function parseDirListing(json: unknown): DirListing {
  if (!isRecord(json) || typeof json['path'] !== 'string' || !Array.isArray(json['dirs'])) {
    throw new LocalFolderError('The directory listing was not in the expected form.')
  }
  if (json['dirs'].some((d) => typeof d !== 'string')) {
    throw new LocalFolderError('The directory listing contained a name that was not text.')
  }
  return {
    path: json['path'],
    parent: typeof json['parent'] === 'string' ? json['parent'] : null,
    dirs: json['dirs'] as string[],
  }
}

export function parseLocalFolder(json: unknown): LocalFolder {
  if (!isRecord(json) || typeof json['root'] !== 'string' || !Array.isArray(json['images'])) {
    throw new LocalFolderError('The image folder listing was not in the expected form.')
  }

  const images = json['images'].map((raw, i) => {
    if (!isRecord(raw) || typeof raw['path'] !== 'string' || raw['path'] === '') {
      throw new LocalFolderError(`Image folder listing: entry ${i} has no path.`)
    }
    return {
      path: raw['path'],
      size: typeof raw['size'] === 'number' ? raw['size'] : 0,
      mtime: typeof raw['mtime'] === 'number' ? raw['mtime'] : 0,
    }
  })

  return {
    root: json['root'],
    truncated: json['truncated'] === true,
    images,
  }
}

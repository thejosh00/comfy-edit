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
  /** False when no IMAGES_DIR is configured — the feature is then simply absent. */
  enabled: boolean
  /** The absolute root, shown to the user so they know which folder they are in. */
  root: string | null
  /** True when the listing hit its cap, so the UI can say the list is partial. */
  truncated: boolean
  images: LocalImage[]
}

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
 */
export function newestFirst(images: readonly LocalImage[]): LocalImage[] {
  return [...images].sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
}

export function localFileUrl(path: string): string {
  return `${LOCAL_BASE}/file?${new URLSearchParams({ path })}`
}

/** The subfolder is often the only thing telling two files apart, so it stays. */
export function displayName(path: string): string {
  return path
}

function isRecord(json: unknown): json is Record<string, unknown> {
  return !!json && typeof json === 'object' && !Array.isArray(json)
}

export function parseLocalFolder(json: unknown): LocalFolder {
  if (!isRecord(json) || typeof json['enabled'] !== 'boolean' || !Array.isArray(json['images'])) {
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
    enabled: json['enabled'],
    root: typeof json['root'] === 'string' ? json['root'] : null,
    truncated: json['truncated'] === true,
    images,
  }
}

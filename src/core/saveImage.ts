/**
 * Saving an image back out to a folder on the machine running the dev server.
 * Pure: the request lives in src/comfy/client.ts and the writing in src/server/.
 */
import { LOCAL_BASE } from './localImages'
import type { EntryOrigin } from './history'

/**
 * The only format written. The canvas exports PNG, so a name ending in .jpg would
 * produce a file whose contents disagree with its extension — most tools open it
 * anyway and one or two refuse, which is a slow and confusing way to find out.
 */
const EXTENSION = '.png'

/** Remembered separately from the folder images are opened from — they are rarely the same place. */
export const SAVE_FOLDER_STORAGE_KEY = 'comfy-edit.saveDir'

export type SaveName = { ok: true; name: string } | { ok: false; reason: string }

/**
 * Turn what was typed into a filename that can be written, or say why it cannot.
 * A bare name only — the dialog asks for a filename, and accepting a path would
 * quietly write outside the folder the user chose.
 */
export function prepareSaveName(raw: string): SaveName {
  const trimmed = raw.trim()
  if (!trimmed) return { ok: false, reason: 'Give the image a name.' }
  if (trimmed.includes('\0')) return { ok: false, reason: 'That name is not a valid filename.' }
  if (/[/\\]/.test(trimmed)) {
    return { ok: false, reason: 'Give a filename only — the folder is chosen above.' }
  }
  if (trimmed === '.' || trimmed === '..') {
    return { ok: false, reason: 'That name is not a valid filename.' }
  }

  // A name with no dot is the common case — people type "sunset", not "sunset.png".
  const name = trimmed.includes('.') ? trimmed : `${trimmed}${EXTENSION}`

  if (!name.toLowerCase().endsWith(EXTENSION)) {
    return { ok: false, reason: 'Images are saved as PNG — use a name ending in .png.' }
  }
  // ".png" is an extension with nothing in front of it, not a file called nothing.
  if (name.length === EXTENSION.length) {
    return { ok: false, reason: 'Give the image a name before the .png.' }
  }

  return { ok: true, name }
}

/**
 * What the filename field starts on. A generation is named after the workflow and
 * seed that produced it: it says something about the image, and two saves from one
 * session differ by default, which keeps "that name is taken" off the common path.
 */
export function defaultSaveName(origin: EntryOrigin): string {
  if (origin.kind !== 'generation') return `image${EXTENSION}`
  return `${origin.workflowId}-${origin.seed}${EXTENSION}`
}

export function saveUrl(dir: string, name: string): string {
  return `${LOCAL_BASE}/save?${new URLSearchParams({ dir, name })}`
}

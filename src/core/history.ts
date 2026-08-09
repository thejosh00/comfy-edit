export type EntryOrigin =
  | { kind: 'upload' }
  | { kind: 'generation'; workflowId: string; prompt: string; seed: number; promptId: string }

export type HistoryEntry = {
  id: string
  label: string
  /** A blob: object URL. Held for the session only — history does not survive a reload. */
  src: string
  width: number
  height: number
  createdAt: number
  parentId: string | null
  origin: EntryOrigin
}

export type HistoryState = {
  entries: HistoryEntry[]
  currentId: string | null
}

export function emptyHistory(): HistoryState {
  return { entries: [], currentId: null }
}

/**
 * Append and select. Ids and timestamps are supplied by the caller so that
 * crypto.randomUUID, Date.now and URL.createObjectURL stay out of core — which
 * is what makes every test here plain equality rather than clock mocking.
 */
export function addEntry(
  history: HistoryState,
  id: string,
  entry: Omit<HistoryEntry, 'id'>,
): HistoryState {
  return {
    entries: [...history.entries, { ...entry, id }],
    currentId: id,
  }
}

/** Entries are never removed, so branching cannot destroy the path branched from. */
export function selectEntry(history: HistoryState, id: string): HistoryState {
  if (!history.entries.some((e) => e.id === id)) {
    // In a session-only store an unknown id means a caller bug; swallowing it
    // would surface as a blank workspace.
    throw new Error(`No history entry with id '${id}'.`)
  }
  return { ...history, currentId: id }
}

export function currentEntry(history: HistoryState): HistoryEntry | null {
  return history.entries.find((e) => e.id === history.currentId) ?? null
}

export function nextGenerationLabel(history: HistoryState, workflowId: string): string {
  const count = history.entries.filter(
    (e) => e.origin.kind === 'generation' && e.origin.workflowId === workflowId,
  ).length
  return `${workflowId} #${count + 1}`
}

import { describe, it, expect } from 'vitest'
import {
  emptyHistory,
  addEntry,
  selectEntry,
  currentEntry,
  nextGenerationLabel,
  type EntryOrigin,
  type HistoryEntry,
  type HistoryState,
} from '../../src/core/history'

const upload = (over: Partial<HistoryEntry> = {}): Omit<HistoryEntry, 'id'> => ({
  label: 'Original',
  src: 'blob:original',
  width: 256,
  height: 256,
  createdAt: 1000,
  parentId: null,
  origin: { kind: 'upload' },
  ...over,
})

const generation = (
  workflowId: string,
  parentId: string,
  over: Partial<HistoryEntry> = {},
): Omit<HistoryEntry, 'id'> => ({
  label: `${workflowId} #1`,
  src: 'blob:generated',
  width: 256,
  height: 256,
  createdAt: 2000,
  parentId,
  origin: {
    kind: 'generation',
    workflowId,
    prompt: 'make it magenta',
    seed: 42,
    promptId: 'p1',
    loras: [],
  },
  ...over,
})

const seeded = (): HistoryState => addEntry(emptyHistory(), 'a', upload())

describe('emptyHistory', () => {
  it('has no entries and nothing selected', () => {
    expect(emptyHistory()).toEqual({ entries: [], currentId: null })
  })
})

describe('addEntry', () => {
  it('appends and selects the new entry', () => {
    const h = seeded()
    expect(h.entries).toHaveLength(1)
    expect(h.currentId).toBe('a')
  })

  it('keeps entries in the order they were produced', () => {
    let h = seeded()
    h = addEntry(h, 'b', generation('passthrough', 'a'))
    h = addEntry(h, 'c', generation('passthrough', 'b'))
    expect(h.entries.map((e) => e.id)).toEqual(['a', 'b', 'c'])
    expect(h.currentId).toBe('c')
  })

  it('records what produced a generated entry', () => {
    const h = addEntry(seeded(), 'b', generation('qwen-2511', 'a'))
    const entry = h.entries[1]!
    expect(entry.origin).toEqual({
      kind: 'generation',
      workflowId: 'qwen-2511',
      prompt: 'make it magenta',
      seed: 42,
      promptId: 'p1',
      loras: [],
    })
    expect(entry.parentId).toBe('a')
  })

  it('records the LoRAs that were applied, for provenance', () => {
    const loras = [{ file: 'darkbrush.safetensors', strength: 0.8 }]
    const origin: EntryOrigin = {
      kind: 'generation',
      workflowId: 'krea2-refine',
      prompt: 'make it magenta',
      seed: 42,
      promptId: 'p1',
      loras,
    }
    const h = addEntry(seeded(), 'b', generation('krea2-refine', 'a', { origin }))
    expect(h.entries[1]!.origin).toEqual(origin)
  })

  it('uses the id and timestamp it is given, generating neither itself', () => {
    // Keeps crypto.randomUUID and Date.now out of core, so tests are plain equality.
    const h = addEntry(emptyHistory(), 'fixed-id', upload({ createdAt: 12345 }))
    expect(h.entries[0]!.id).toBe('fixed-id')
    expect(h.entries[0]!.createdAt).toBe(12345)
  })

  it('does not mutate the input', () => {
    const before = seeded()
    addEntry(before, 'b', generation('passthrough', 'a'))
    expect(before.entries).toHaveLength(1)
    expect(before.currentId).toBe('a')
  })
})

describe('selectEntry', () => {
  it('changes the current entry', () => {
    let h = seeded()
    h = addEntry(h, 'b', generation('passthrough', 'a'))
    expect(selectEntry(h, 'a').currentId).toBe('a')
  })

  it('never removes an entry, so branching cannot destroy the path branched from', () => {
    let h = seeded()
    h = addEntry(h, 'b', generation('passthrough', 'a'))
    h = addEntry(h, 'c', generation('passthrough', 'b'))

    const back = selectEntry(h, 'a')
    expect(back.entries.map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })

  it('throws on an unknown id rather than blanking the workspace', () => {
    expect(() => selectEntry(seeded(), 'nope')).toThrow(/nope/)
  })

  it('does not mutate the input', () => {
    let h = seeded()
    h = addEntry(h, 'b', generation('passthrough', 'a'))
    selectEntry(h, 'a')
    expect(h.currentId).toBe('b')
  })
})

describe('currentEntry', () => {
  it('returns null when there is nothing selected', () => {
    expect(currentEntry(emptyHistory())).toBeNull()
  })

  it('returns the selected entry', () => {
    expect(currentEntry(seeded())?.id).toBe('a')
  })
})

describe('nextGenerationLabel', () => {
  it('starts at 1 for a workflow with no generations yet', () => {
    expect(nextGenerationLabel(seeded(), 'passthrough')).toBe('passthrough #1')
  })

  it('counts per workflow, not globally', () => {
    let h = seeded()
    h = addEntry(h, 'b', generation('passthrough', 'a'))
    h = addEntry(h, 'c', generation('qwen-2511', 'b'))

    expect(nextGenerationLabel(h, 'passthrough')).toBe('passthrough #2')
    expect(nextGenerationLabel(h, 'qwen-2511')).toBe('qwen-2511 #2')
    expect(nextGenerationLabel(h, 'other')).toBe('other #1')
  })

  it('ignores uploaded entries when counting', () => {
    let h = seeded()
    h = addEntry(h, 'b', upload({ label: 'Original 2' }))
    expect(nextGenerationLabel(h, 'passthrough')).toBe('passthrough #1')
  })
})

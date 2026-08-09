import { describe, it, expect } from 'vitest'
import {
  createDoc,
  commitShape,
  undo,
  redo,
  clearShapes,
  rebase,
  canUndo,
  canRedo,
} from '../../src/core/drawing'
import type { Shape } from '../../src/core/types'

const shape = (n: number): Shape => ({
  kind: 'rect',
  from: { x: n, y: n },
  to: { x: n + 10, y: n + 10 },
  color: '#ff0000',
  width: 2,
})

describe('createDoc', () => {
  it('starts empty against a base image', () => {
    const d = createDoc('img-1')
    expect(d).toEqual({ baseImageId: 'img-1', shapes: [], undone: [] })
  })
})

describe('commitShape', () => {
  it('appends in draw order', () => {
    const d = commitShape(commitShape(createDoc('a'), shape(1)), shape(2))
    expect(d.shapes).toEqual([shape(1), shape(2)])
  })

  it('clears the redo stack, so an undone mark cannot come back', () => {
    let d = commitShape(createDoc('a'), shape(1))
    d = undo(d)
    expect(d.undone).toHaveLength(1)

    d = commitShape(d, shape(2))
    expect(d.undone).toEqual([])
    expect(canRedo(d)).toBe(false)
  })

  it('does not mutate the input', () => {
    const before = createDoc('a')
    const after = commitShape(before, shape(1))
    expect(before.shapes).toEqual([])
    expect(after).not.toBe(before)
  })
})

describe('undo and redo', () => {
  it('moves the last shape onto the redo stack and back', () => {
    let d = commitShape(commitShape(createDoc('a'), shape(1)), shape(2))

    d = undo(d)
    expect(d.shapes).toEqual([shape(1)])
    expect(d.undone).toEqual([shape(2)])

    d = redo(d)
    expect(d.shapes).toEqual([shape(1), shape(2)])
    expect(d.undone).toEqual([])
  })

  it('undoes in reverse order of creation', () => {
    let d = createDoc('a')
    for (const n of [1, 2, 3]) d = commitShape(d, shape(n))
    d = undo(undo(d))
    expect(d.shapes).toEqual([shape(1)])
  })

  it('is a no-op on an empty stack', () => {
    const empty = createDoc('a')
    expect(undo(empty)).toEqual(empty)
    expect(redo(empty)).toEqual(empty)
  })

  it('does not mutate the input', () => {
    const before = commitShape(createDoc('a'), shape(1))
    undo(before)
    expect(before.shapes).toHaveLength(1)
  })
})

describe('clearShapes', () => {
  it('removes every mark and leaves nothing to undo', () => {
    let d = createDoc('a')
    for (const n of [1, 2, 3]) d = commitShape(d, shape(n))
    d = undo(d)

    d = clearShapes(d)
    expect(d.shapes).toEqual([])
    expect(d.undone).toEqual([])
    expect(canUndo(d)).toBe(false)
    expect(canRedo(d)).toBe(false)
  })

  it('keeps the base image', () => {
    expect(clearShapes(commitShape(createDoc('img-7'), shape(1))).baseImageId).toBe('img-7')
  })
})

describe('canUndo and canRedo', () => {
  it('are derived from the two stacks', () => {
    let d = createDoc('a')
    expect(canUndo(d)).toBe(false)
    expect(canRedo(d)).toBe(false)

    d = commitShape(d, shape(1))
    expect(canUndo(d)).toBe(true)
    expect(canRedo(d)).toBe(false)

    d = undo(d)
    expect(canUndo(d)).toBe(false)
    expect(canRedo(d)).toBe(true)
  })
})

describe('rebase', () => {
  it('adopts the new base image', () => {
    expect(rebase(createDoc('old'), 'new').baseImageId).toBe('new')
  })

  it('clears shapes, because they are already baked into the new base', () => {
    let d = createDoc('old')
    for (const n of [1, 2]) d = commitShape(d, shape(n))
    expect(rebase(d, 'new').shapes).toEqual([])
  })

  it('also clears the redo stack', () => {
    // The half a naive implementation misses. A surviving redo stack would let
    // the user redraw a mark that is already part of the image beneath it.
    let d = commitShape(commitShape(createDoc('old'), shape(1)), shape(2))
    d = undo(d)
    expect(d.undone).toHaveLength(1)

    const rebased = rebase(d, 'new')
    expect(rebased.undone).toEqual([])
    expect(canRedo(rebased)).toBe(false)
    expect(canUndo(rebased)).toBe(false)
  })

  it('does not mutate the input', () => {
    const before = commitShape(createDoc('old'), shape(1))
    rebase(before, 'new')
    expect(before.baseImageId).toBe('old')
    expect(before.shapes).toHaveLength(1)
  })
})

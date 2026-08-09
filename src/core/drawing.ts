import type { Shape } from './types'

/**
 * Retained-mode document: a base image plus an ordered list of marks re-rendered
 * each frame. Undo/redo is therefore list manipulation rather than pixel snapshots,
 * which is what keeps it unit-testable with no canvas (research.md D2).
 */
export type DrawingDoc = {
  baseImageId: string
  shapes: Shape[]
  undone: Shape[]
}

export function createDoc(baseImageId: string): DrawingDoc {
  return { baseImageId, shapes: [], undone: [] }
}

/** Committing discards the redo trail — the undo history is a stack, not a tree. */
export function commitShape(doc: DrawingDoc, shape: Shape): DrawingDoc {
  return { ...doc, shapes: [...doc.shapes, shape], undone: [] }
}

export function undo(doc: DrawingDoc): DrawingDoc {
  if (doc.shapes.length === 0) return doc
  const shapes = doc.shapes.slice(0, -1)
  const last = doc.shapes[doc.shapes.length - 1]!
  return { ...doc, shapes, undone: [...doc.undone, last] }
}

export function redo(doc: DrawingDoc): DrawingDoc {
  if (doc.undone.length === 0) return doc
  const undone = doc.undone.slice(0, -1)
  const last = doc.undone[doc.undone.length - 1]!
  return { ...doc, shapes: [...doc.shapes, last], undone }
}

export function clearShapes(doc: DrawingDoc): DrawingDoc {
  return { ...doc, shapes: [], undone: [] }
}

/**
 * Adopt a new base image and drop every mark.
 *
 * Both lists must be emptied, not just `shapes`: after a transformation the marks
 * are baked into the result's pixels, so a surviving redo stack would let the user
 * redraw a mark that is already part of the image beneath it.
 */
export function rebase(_doc: DrawingDoc, baseImageId: string): DrawingDoc {
  return { baseImageId, shapes: [], undone: [] }
}

export function canUndo(doc: DrawingDoc): boolean {
  return doc.shapes.length > 0
}

export function canRedo(doc: DrawingDoc): boolean {
  return doc.undone.length > 0
}

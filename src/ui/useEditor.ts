import { useCallback, useReducer } from 'react'
import {
  canRedo,
  canUndo,
  clearShapes,
  commitShape,
  createDoc,
  redo,
  undo,
  type DrawingDoc,
} from '../core/drawing'
import type { Shape, ToolId } from '../core/types'

export type BaseImage = { id: string; bitmap: ImageBitmap; width: number; height: number }

export type EditorState = {
  doc: DrawingDoc
  base: BaseImage | null
  tool: ToolId
  color: string
  width: number
  loadError: string | null
}

type Action =
  | { type: 'setBase'; base: BaseImage }
  | { type: 'commit'; shape: Shape }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setColor'; color: string }
  | { type: 'setWidth'; width: number }
  | { type: 'loadError'; message: string | null }

const INITIAL: EditorState = {
  doc: createDoc(''),
  base: null,
  tool: 'freehand',
  color: '#ff0000',
  width: 4,
  loadError: null,
}

/** Every mutation delegates to src/core — no logic lives in the reducer itself. */
function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'setBase':
      return { ...state, base: action.base, doc: createDoc(action.base.id), loadError: null }
    case 'commit':
      return { ...state, doc: commitShape(state.doc, action.shape) }
    case 'undo':
      return { ...state, doc: undo(state.doc) }
    case 'redo':
      return { ...state, doc: redo(state.doc) }
    case 'clear':
      return { ...state, doc: clearShapes(state.doc) }
    case 'setTool':
      return { ...state, tool: action.tool }
    case 'setColor':
      return { ...state, color: action.color }
    case 'setWidth':
      return { ...state, width: action.width }
    case 'loadError':
      return { ...state, loadError: action.message }
  }
}

export function useEditor() {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  const loadImageFile = useCallback(async (file: File) => {
    try {
      const bitmap = await createImageBitmap(file)
      dispatch({
        type: 'setBase',
        base: {
          id: `img-${crypto.randomUUID()}`,
          bitmap,
          width: bitmap.width,
          height: bitmap.height,
        },
      })
    } catch {
      dispatch({
        type: 'loadError',
        message: `Could not read "${file.name}" as an image.`,
      })
    }
  }, [])

  return {
    state,
    canUndo: canUndo(state.doc),
    canRedo: canRedo(state.doc),
    hasShapes: state.doc.shapes.length > 0,
    loadImageFile,
    commit: useCallback((shape: Shape) => dispatch({ type: 'commit', shape }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    clear: useCallback(() => dispatch({ type: 'clear' }), []),
    setTool: useCallback((tool: ToolId) => dispatch({ type: 'setTool', tool }), []),
    setColor: useCallback((color: string) => dispatch({ type: 'setColor', color }), []),
    setWidth: useCallback((width: number) => dispatch({ type: 'setWidth', width }), []),
  }
}

export type Editor = ReturnType<typeof useEditor>

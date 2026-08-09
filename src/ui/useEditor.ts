import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  canRedo,
  canUndo,
  clearShapes,
  commitShape,
  createDoc,
  rebase,
  redo,
  undo,
  type DrawingDoc,
} from '../core/drawing'
import { initialRunState, type RunState } from '../core/comfyEvents'
import {
  addEntry,
  emptyHistory,
  nextGenerationLabel,
  selectEntry,
  type EntryOrigin,
  type HistoryState,
} from '../core/history'
import { randomSeed, WorkflowConfigError } from '../core/workflow'
import { loadWorkflows, type LoadedWorkflow } from '../comfy/client'
import { runWorkflow, DEFAULT_RUN_TIMEOUT_MS } from '../comfy/runner'
import type { Shape, ToolId } from '../core/types'

export type BaseImage = { id: string; bitmap: ImageBitmap; width: number; height: number }

export type EditorState = {
  doc: DrawingDoc
  base: BaseImage | null
  tool: ToolId
  color: string
  width: number
  loadError: string | null

  workflows: LoadedWorkflow[]
  workflowError: string | null
  selectedWorkflowId: string
  prompt: string
  seed: number
  seedLocked: boolean
  run: RunState
  /** Increments when a run starts. Lets an observer distinguish this run's
   *  completion from the previous run's, which look identical otherwise. */
  runSeq: number

  history: HistoryState
}

export type NewImage = {
  base: BaseImage
  /** Object URL for the history thumbnail. */
  src: string
  createdAt: number
  origin: EntryOrigin
}

type Action =
  | { type: 'imageAdded'; image: NewImage; rebased: boolean }
  | { type: 'historySelected'; base: BaseImage }
  | { type: 'commit'; shape: Shape }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'setColor'; color: string }
  | { type: 'setWidth'; width: number }
  | { type: 'loadError'; message: string | null }
  | { type: 'workflowsLoaded'; workflows: LoadedWorkflow[] }
  | { type: 'workflowError'; message: string }
  | { type: 'selectWorkflow'; id: string }
  | { type: 'setPrompt'; prompt: string }
  | { type: 'setSeed'; seed: number }
  | { type: 'setSeedLock'; locked: boolean }
  | { type: 'runState'; run: RunState }
  | { type: 'runStarted'; seed: number }

const INITIAL: EditorState = {
  doc: createDoc(''),
  base: null,
  tool: 'freehand',
  color: '#ff0000',
  width: 4,
  loadError: null,

  workflows: [],
  workflowError: null,
  selectedWorkflowId: '',
  prompt: '',
  seed: randomSeed(),
  seedLocked: false,
  run: initialRunState(),
  runSeq: 0,
  history: emptyHistory(),
}

function labelFor(history: HistoryState, origin: EntryOrigin): string {
  if (origin.kind === 'generation') return nextGenerationLabel(history, origin.workflowId)
  const uploads = history.entries.filter((e) => e.origin.kind === 'upload').length
  return uploads === 0 ? 'Original' : `Original #${uploads + 1}`
}

/** Every mutation delegates to src/core — no logic lives in the reducer itself. */
function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'imageAdded': {
      const { base, src, createdAt, origin } = action.image
      return {
        ...state,
        base,
        // A transformation result rebases: the marks are already baked into it.
        doc: action.rebased ? rebase(state.doc, base.id) : createDoc(base.id),
        loadError: null,
        history: addEntry(state.history, base.id, {
          label: labelFor(state.history, origin),
          src,
          width: base.width,
          height: base.height,
          createdAt,
          parentId: state.history.currentId,
          origin,
        }),
      }
    }
    case 'historySelected':
      return {
        ...state,
        base: action.base,
        // Uncommitted marks are discarded and both stacks reset.
        doc: rebase(state.doc, action.base.id),
        history: selectEntry(state.history, action.base.id),
      }
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
    case 'workflowsLoaded':
      return {
        ...state,
        workflows: action.workflows,
        workflowError:
          action.workflows.length === 0
            ? 'No workflows are configured. Add one to public/workflows/manifest.json.'
            : null,
        selectedWorkflowId: action.workflows[0]?.meta.id ?? '',
      }
    case 'workflowError':
      return { ...state, workflows: [], workflowError: action.message }
    case 'selectWorkflow':
      return { ...state, selectedWorkflowId: action.id }
    case 'setPrompt':
      return { ...state, prompt: action.prompt }
    case 'setSeed':
      return { ...state, seed: action.seed }
    case 'setSeedLock':
      return { ...state, seedLocked: action.locked }
    case 'runState':
      return { ...state, run: action.run }
    case 'runStarted':
      return {
        ...state,
        seed: action.seed,
        runSeq: state.runSeq + 1,
        run: { ...initialRunState(), phase: 'uploading' },
      }
  }
}

const RUN_TIMEOUT_MS = Number(import.meta.env.VITE_RUN_TIMEOUT_MS) || DEFAULT_RUN_TIMEOUT_MS

export type TransformOutcome = {
  imageId: string
  workflowId: string
  prompt: string
  seed: number
  promptId: string
}

export function useEditor() {
  const [state, dispatch] = useReducer(reducer, INITIAL)

  // Validate every workflow before a run is possible, so misconfiguration is
  // reported at startup rather than after a failed transformation.
  useEffect(() => {
    let cancelled = false
    loadWorkflows()
      .then((workflows) => {
        if (!cancelled) dispatch({ type: 'workflowsLoaded', workflows })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        const message =
          e instanceof WorkflowConfigError || e instanceof Error
            ? e.message
            : 'Could not load workflow configuration.'
        dispatch({ type: 'workflowError', message })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ImageBitmaps are not state — they are handles the canvas draws from. Keyed by
  // the same id the history entry uses, so selecting an entry finds its bitmap.
  const bitmaps = useRef(new Map<string, ImageBitmap>())

  const adoptImage = useCallback(
    async (blob: Blob, origin: EntryOrigin, rebased: boolean): Promise<BaseImage> => {
      const bitmap = await createImageBitmap(blob)
      const base: BaseImage = {
        id: `img-${crypto.randomUUID()}`,
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
      }
      bitmaps.current.set(base.id, bitmap)

      dispatch({
        type: 'imageAdded',
        rebased,
        image: { base, src: URL.createObjectURL(blob), createdAt: Date.now(), origin },
      })
      return base
    },
    [],
  )

  const loadImageFile = useCallback(
    async (file: File): Promise<BaseImage | null> => {
      try {
        return await adoptImage(file, { kind: 'upload' }, false)
      } catch {
        dispatch({ type: 'loadError', message: `Could not read "${file.name}" as an image.` })
        return null
      }
    },
    [adoptImage],
  )

  const selectHistoryEntry = useCallback((id: string) => {
    const bitmap = bitmaps.current.get(id)
    if (!bitmap) return
    dispatch({
      type: 'historySelected',
      base: { id, bitmap, width: bitmap.width, height: bitmap.height },
    })
  }, [])

  const selected = state.workflows.find((w) => w.meta.id === state.selectedWorkflowId)

  const canRun =
    !!state.base &&
    !!selected &&
    !state.workflowError &&
    state.run.phase !== 'uploading' &&
    state.run.phase !== 'queued' &&
    state.run.phase !== 'running'

  /**
   * Composite the canvas, run it through the chosen workflow, and adopt the result
   * as the new base image. The workspace is left untouched on any failure.
   */
  const runTransform = useCallback(
    async (getBlob: () => Promise<Blob>): Promise<TransformOutcome | null> => {
      if (!selected || !state.base) return null

      const seed = state.seedLocked ? state.seed : randomSeed()
      dispatch({ type: 'runStarted', seed })

      try {
        const canvasBlob = await getBlob()
        const result = await runWorkflow(
          {
            canvasBlob,
            meta: selected.meta,
            graph: selected.graph,
            prompt: state.prompt,
            seed,
            timeoutMs: RUN_TIMEOUT_MS,
          },
          (run) => dispatch({ type: 'runState', run }),
        )

        const base = await adoptImage(
          result.blob,
          {
            kind: 'generation',
            workflowId: selected.meta.id,
            prompt: state.prompt,
            seed,
            promptId: result.promptId,
          },
          true,
        )
        return {
          imageId: base.id,
          workflowId: selected.meta.id,
          prompt: state.prompt,
          seed,
          promptId: result.promptId,
        }
      } catch {
        // runWorkflow has already pushed an error RunState carrying the reason.
        return null
      }
    },
    [selected, state.base, state.prompt, state.seed, state.seedLocked, adoptImage],
  )

  return {
    state,
    selected,
    canRun,
    canUndo: canUndo(state.doc),
    canRedo: canRedo(state.doc),
    hasShapes: state.doc.shapes.length > 0,
    loadImageFile,
    selectHistoryEntry,
    runTransform,
    commit: useCallback((shape: Shape) => dispatch({ type: 'commit', shape }), []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    clear: useCallback(() => dispatch({ type: 'clear' }), []),
    setTool: useCallback((tool: ToolId) => dispatch({ type: 'setTool', tool }), []),
    setColor: useCallback((color: string) => dispatch({ type: 'setColor', color }), []),
    setWidth: useCallback((width: number) => dispatch({ type: 'setWidth', width }), []),
    selectWorkflow: useCallback((id: string) => dispatch({ type: 'selectWorkflow', id }), []),
    setPrompt: useCallback((prompt: string) => dispatch({ type: 'setPrompt', prompt }), []),
    setSeed: useCallback((seed: number) => dispatch({ type: 'setSeed', seed }), []),
    setSeedLock: useCallback((locked: boolean) => dispatch({ type: 'setSeedLock', locked }), []),
  }
}

export type Editor = ReturnType<typeof useEditor>

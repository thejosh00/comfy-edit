import { useCallback, useEffect, useReducer } from 'react'
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
}

type Action =
  | { type: 'setBase'; base: BaseImage; rebased: boolean }
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
}

/** Every mutation delegates to src/core — no logic lives in the reducer itself. */
function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'setBase':
      return {
        ...state,
        base: action.base,
        // A transformation result rebases: the marks are already baked into it.
        doc: action.rebased ? rebase(state.doc, action.base.id) : createDoc(action.base.id),
        loadError: null,
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
  bitmap: ImageBitmap
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

  const setBaseFromBitmap = useCallback((bitmap: ImageBitmap, rebased: boolean): BaseImage => {
    const base: BaseImage = {
      id: `img-${crypto.randomUUID()}`,
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
    }
    dispatch({ type: 'setBase', base, rebased })
    return base
  }, [])

  const loadImageFile = useCallback(
    async (file: File): Promise<BaseImage | null> => {
      try {
        const bitmap = await createImageBitmap(file)
        return setBaseFromBitmap(bitmap, false)
      } catch {
        dispatch({ type: 'loadError', message: `Could not read "${file.name}" as an image.` })
        return null
      }
    },
    [setBaseFromBitmap],
  )

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

        const bitmap = await createImageBitmap(result.blob)
        const base = setBaseFromBitmap(bitmap, true)
        return {
          bitmap,
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
    [selected, state.base, state.prompt, state.seed, state.seedLocked, setBaseFromBitmap],
  )

  return {
    state,
    selected,
    canRun,
    canUndo: canUndo(state.doc),
    canRedo: canRedo(state.doc),
    hasShapes: state.doc.shapes.length > 0,
    loadImageFile,
    setBaseFromBitmap,
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

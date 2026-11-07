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
  markSaved,
  nextGenerationLabel,
  selectEntry,
  unsavedResultCount,
  type AppliedLora,
  type EntryOrigin,
  type HistoryState,
} from '../core/history'
import { randomSeed, WorkflowConfigError } from '../core/workflow'
import { batchSeeds, clampBatchCount, type BatchMode } from '../core/batch'
import {
  emptySelections,
  lorasFor,
  type LoraMeta,
  type LoraSelection,
} from '../core/loras'
import {
  defaultSaveName,
  prepareSaveName,
  SAVE_FOLDER_STORAGE_KEY,
} from '../core/saveImage'
import {
  FOLDER_STORAGE_KEY,
  LocalFolderError,
  type DirListing,
  type LocalFolder,
  type LocalImage,
} from '../core/localImages'
import {
  browseDirs,
  fetchLocalImage,
  listLocalImages,
  loadConfig,
  saveLocalImage,
  type LoadedWorkflow,
} from '../comfy/client'
import { runWorkflow, DEFAULT_RUN_TIMEOUT_MS } from '../comfy/runner'
import type { DrawToolId, Shape, ToolId } from '../core/types'

export type BaseImage = { id: string; bitmap: ImageBitmap; width: number; height: number }

export type EditorState = {
  doc: DrawingDoc
  base: BaseImage | null
  tool: ToolId
  /**
   * The drawing tool to come back to once a colour has been sampled. Picking a
   * colour is something you do in order to draw with it, so the eyedropper hands
   * back to whatever was in use rather than leaving the user to reselect it.
   */
  lastDrawTool: DrawToolId
  color: string
  width: number
  loadError: string | null

  workflows: LoadedWorkflow[]
  workflowError: string | null
  selectedWorkflowId: string
  /** Every LoRA the catalog knows about; filtered per workflow for display. */
  loraCatalog: LoraMeta[]
  /** One entry per slot the selected workflow declares. */
  loras: LoraSelection[]
  prompt: string
  seed: number
  seedLocked: boolean
  /** How many times Run executes the workflow, and what the repeats mean. */
  batchCount: number
  batchMode: BatchMode
  /** Non-null only while a batch is in flight; `index` is 1-based. */
  batch: { index: number; total: number } | null
  /** True from the click on Run until the batch has ended, however it ended. */
  runLocked: boolean
  /** Why something was refused during a run, or how a cancelled run ended. */
  notice: string | null
  /** An open is waiting on the user's answer to the unsaved-results warning. */
  openWarning: boolean

  run: RunState
  /** Increments when a run starts. Lets an observer distinguish this run's
   *  completion from the previous run's, which look identical otherwise. */
  runSeq: number

  history: HistoryState

  folder: FolderState
  chooser: ChooserState
  save: SaveState
}

/** Writing the current image back out to a chosen folder. */
export type SaveState = {
  open: boolean
  /** Absolute path of the chosen save folder; null until one has been chosen. */
  dir: string | null
  name: string
  saving: boolean
  error: string | null
  /** The full path of the last successful save, for the confirmation line. */
  savedPath: string | null
}

/** The chosen folder of images on the server, and its contents. */
export type FolderState = {
  /** Absolute path of the chosen folder; null until one has been chosen. */
  dir: string | null
  truncated: boolean
  images: LocalImage[]
  open: boolean
  loading: boolean
  error: string | null
}

/** The folder chooser: one rung of the server's filesystem at a time. */
export type ChooserState = {
  open: boolean
  /** Which folder is being chosen — the one images are opened from, or saved to. */
  target: 'images' | 'save'
  listing: DirListing | null
  /** The editable path field, which is not always a folder that exists yet. */
  path: string
  /**
   * True once the field has been typed into and not yet browsed to. A listing that
   * lands after that must not overwrite what the user is in the middle of typing.
   */
  pathDirty: boolean
  loading: boolean
  error: string | null
}

export type NewImage = {
  base: BaseImage
  /** Object URL for the history thumbnail. */
  src: string
  createdAt: number
  origin: EntryOrigin
  /**
   * Pins the new entry's parent. Variations must all hang off the image they were
   * generated from; without this each one would parent to the previous variation
   * and the strip would read as a chain that never happened.
   */
  parentId?: string | null
}

type Action =
  | { type: 'imageAdded'; image: NewImage; rebased: boolean }
  | { type: 'historySelected'; base: BaseImage }
  | { type: 'commit'; shape: Shape }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'clear' }
  | { type: 'setTool'; tool: ToolId }
  | { type: 'colorPicked'; color: string }
  | { type: 'setColor'; color: string }
  | { type: 'setWidth'; width: number }
  | { type: 'loadError'; message: string | null }
  | { type: 'workflowsLoaded'; workflows: LoadedWorkflow[]; loras: LoraMeta[] }
  | { type: 'workflowError'; message: string }
  | { type: 'selectWorkflow'; id: string }
  | { type: 'setLora'; slot: number; selection: LoraSelection }
  | { type: 'setPrompt'; prompt: string }
  | { type: 'setSeed'; seed: number }
  | { type: 'setSeedLock'; locked: boolean }
  | { type: 'runState'; run: RunState }
  | { type: 'runLocked' }
  | { type: 'notice'; message: string }
  | { type: 'openWarning'; open: boolean }
  | { type: 'runStarted'; seed: number; batchIndex: number; batchTotal: number }
  | { type: 'batchEnded'; notice: string | null }
  | { type: 'setBatchCount'; count: number }
  | { type: 'setBatchMode'; mode: BatchMode }
  | { type: 'folderListed'; folder: LocalFolder }
  | { type: 'folderError'; message: string }
  | { type: 'folderOpened' }
  | { type: 'folderClosed' }
  | { type: 'folderChosen'; dir: string }
  | { type: 'saveFolderChosen'; dir: string; name: string }
  | { type: 'saveOpened'; name: string }
  | { type: 'saveClosed' }
  | { type: 'saveNameEdited'; name: string }
  | { type: 'saveStarted' }
  | { type: 'saveFailed'; message: string }
  | { type: 'saveDone'; path: string }
  | { type: 'chooserOpened'; path: string; target: 'images' | 'save' }
  | { type: 'chooserRequested' }
  | { type: 'chooserClosed' }
  | { type: 'chooserListed'; listing: DirListing }
  | { type: 'chooserError'; message: string }
  | { type: 'chooserPathEdited'; path: string }

const INITIAL: EditorState = {
  doc: createDoc(''),
  base: null,
  tool: 'freehand',
  lastDrawTool: 'freehand',
  color: '#ff0000',
  width: 4,
  loadError: null,

  workflows: [],
  workflowError: null,
  selectedWorkflowId: '',
  loraCatalog: [],
  loras: [],
  prompt: '',
  seed: randomSeed(),
  seedLocked: false,
  batchCount: 1,
  batchMode: 'variations',
  batch: null,
  runLocked: false,
  notice: null,
  openWarning: false,
  run: initialRunState(),
  runSeq: 0,
  history: emptyHistory(),
  folder: {
    dir: null,
    truncated: false,
    images: [],
    open: false,
    loading: false,
    error: null,
  },
  chooser: {
    open: false,
    target: 'images',
    listing: null,
    path: '',
    pathDirty: false,
    loading: false,
    error: null,
  },
  save: { open: false, dir: null, name: '', saving: false, error: null, savedPath: null },
}

/**
 * The chosen folder outlives a reload. Read once at startup rather than in an
 * effect, so the first render already knows whether a folder is chosen and the
 * toolbar does not change under the user a moment later.
 */
function withStoredDir(initial: EditorState): EditorState {
  const dir = localStorage.getItem(FOLDER_STORAGE_KEY)
  const saveDir = localStorage.getItem(SAVE_FOLDER_STORAGE_KEY)
  return {
    ...initial,
    folder: { ...initial.folder, dir: dir ?? null },
    save: { ...initial.save, dir: saveDir ?? null },
  }
}

/** How many LoRA slots a workflow declares — zero when it declares none. */
function slotCount(workflows: LoadedWorkflow[], id: string): number {
  return workflows.find((w) => w.meta.id === id)?.meta.loraNodes?.length ?? 0
}

function labelFor(history: HistoryState, origin: EntryOrigin): string {
  // An upload always lands in a history that was just emptied, so it is always
  // the one original.
  return origin.kind === 'generation'
    ? nextGenerationLabel(history, origin.workflowId)
    : 'Original'
}

/** Every mutation delegates to src/core — no logic lives in the reducer itself. */
function reducer(state: EditorState, action: Action): EditorState {
  switch (action.type) {
    case 'imageAdded': {
      const { base, src, createdAt, origin, parentId } = action.image
      // Bringing in a new image starts a new line of work: the previous image's
      // lineage is no longer something the user can meaningfully return to, so it
      // is dropped. Everything else on the panel — workflow, instruction, seed,
      // LoRAs, run count — is how they were working, and survives untouched.
      const history = origin.kind === 'upload' ? emptyHistory() : state.history
      return {
        ...state,
        base,
        // A transformation result rebases: the marks are already baked into it.
        doc: action.rebased ? rebase(state.doc, base.id) : createDoc(base.id),
        loadError: null,
        history: addEntry(history, base.id, {
          label: labelFor(history, origin),
          src,
          width: base.width,
          height: base.height,
          createdAt,
          // `history`, not `state.history`: after a reset the old current id is
          // gone, and parenting the new original to it would resurrect a link to
          // an entry that no longer exists.
          parentId: parentId ?? history.currentId,
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
      return {
        ...state,
        tool: action.tool,
        lastDrawTool: action.tool === 'eyedropper' ? state.lastDrawTool : action.tool,
      }
    case 'colorPicked':
      return { ...state, color: action.color, tool: state.lastDrawTool }
    case 'setColor':
      return { ...state, color: action.color }
    case 'setWidth':
      return { ...state, width: action.width }
    case 'loadError':
      return { ...state, loadError: action.message }
    case 'workflowsLoaded': {
      const selectedWorkflowId = action.workflows[0]?.meta.id ?? ''
      return {
        ...state,
        workflows: action.workflows,
        workflowError:
          action.workflows.length === 0
            ? 'No workflows are configured. Add one to public/workflows/manifest.json.'
            : null,
        selectedWorkflowId,
        loraCatalog: action.loras,
        loras: emptySelections(slotCount(action.workflows, selectedWorkflowId)),
      }
    }
    case 'workflowError':
      return { ...state, workflows: [], workflowError: action.message, loras: [] }
    case 'selectWorkflow':
      // Re-selecting the same workflow must not discard the user's LoRA choices.
      if (action.id === state.selectedWorkflowId) return state
      // On a real change the slots are reset rather than carried over: the catalog
      // is filtered per workflow, so a selection made for one workflow may name a
      // file the next one cannot load.
      return {
        ...state,
        selectedWorkflowId: action.id,
        loras: emptySelections(slotCount(state.workflows, action.id)),
      }
    case 'setLora': {
      const loras = [...state.loras]
      loras[action.slot] = action.selection
      return { ...state, loras }
    }
    case 'setPrompt':
      return { ...state, prompt: action.prompt }
    case 'setSeed':
      return { ...state, seed: action.seed }
    case 'setSeedLock':
      return { ...state, seedLocked: action.locked }
    case 'runState':
      return { ...state, run: action.run }
    case 'runLocked':
      return { ...state, runLocked: true, notice: null }
    case 'openWarning':
      return { ...state, openWarning: action.open }
    case 'notice':
      return { ...state, notice: action.message }
    case 'runStarted':
      return {
        ...state,
        seed: action.seed,
        runSeq: state.runSeq + 1,
        batch: { index: action.batchIndex, total: action.batchTotal },
        run: { ...initialRunState(), phase: 'uploading' },
      }
    case 'batchEnded':
      return { ...state, batch: null, runLocked: false, notice: action.notice }
    case 'setBatchCount':
      return { ...state, batchCount: clampBatchCount(action.count) }
    case 'setBatchMode':
      return { ...state, batchMode: action.mode }
    case 'folderListed': {
      const { truncated, images } = action.folder
      return { ...state, folder: { ...state.folder, truncated, images, loading: false, error: null } }
    }
    case 'folderError':
      return { ...state, folder: { ...state.folder, loading: false, error: action.message } }
    case 'folderOpened':
      return { ...state, folder: { ...state.folder, open: true, loading: true } }
    case 'folderClosed':
      return { ...state, folder: { ...state.folder, open: false } }
    case 'folderChosen':
      // The previous folder's images go with it. Keeping them on screen while the
      // new listing loads would show one folder's contents under another's name.
      return {
        ...state,
        folder: { ...state.folder, dir: action.dir, images: [], truncated: false, open: true, loading: true, error: null },
        chooser: { ...state.chooser, open: false },
      }
    case 'saveFolderChosen':
      return {
        ...state,
        chooser: { ...state.chooser, open: false },
        save: { ...state.save, dir: action.dir, name: action.name, open: true, error: null, savedPath: null },
      }
    case 'saveOpened':
      return { ...state, save: { ...state.save, open: true, name: action.name, error: null, savedPath: null } }
    case 'saveClosed':
      return { ...state, save: { ...state.save, open: false } }
    case 'saveNameEdited':
      // Clearing the error as soon as the name changes: the old complaint was
      // about the old name, and leaving it up reads as though it still applies.
      return { ...state, save: { ...state.save, name: action.name, error: null } }
    case 'saveStarted':
      return { ...state, save: { ...state.save, saving: true, error: null, savedPath: null } }
    case 'saveFailed':
      return { ...state, save: { ...state.save, saving: false, error: action.message } }
    case 'saveDone':
      return {
        ...state,
        history: markSaved(state.history, state.history.currentId),
        save: { ...state.save, saving: false, open: false, savedPath: action.path },
      }
    case 'chooserOpened':
      return {
        ...state,
        folder: { ...state.folder, open: false },
        // The save dialog steps aside while its folder is being chosen, and is
        // brought back by saveFolderChosen.
        save: { ...state.save, open: false },
        chooser: {
          open: true,
          target: action.target,
          listing: null,
          path: action.path,
          pathDirty: false,
          loading: true,
          error: null,
        },
      }
    case 'chooserRequested':
      // The field and the browse now agree again, so the listing about to land is
      // allowed to write the canonical path back into it.
      return { ...state, chooser: { ...state.chooser, pathDirty: false, loading: true } }
    case 'chooserClosed':
      return { ...state, chooser: { ...state.chooser, open: false } }
    case 'chooserListed':
      return {
        ...state,
        chooser: {
          ...state.chooser,
          listing: action.listing,
          // Snapped to what the server resolved, so the field shows a real,
          // canonical path rather than whatever was typed to get there — unless
          // the user has since typed something else, which must not be clobbered
          // by a listing they did not ask for. That mistake is how the chooser
          // ends up adopting the folder it happened to open on.
          path: state.chooser.pathDirty ? state.chooser.path : action.listing.path,
          loading: false,
          error: null,
        },
      }
    case 'chooserError':
      return { ...state, chooser: { ...state.chooser, loading: false, error: action.message } }
    case 'chooserPathEdited':
      return { ...state, chooser: { ...state.chooser, path: action.path, pathDirty: true } }
  }
}

/**
 * What drawing and opening do during a run: nothing happens, and this says so. A
 * run belongs to the image it started on, so there is no second image or mark for
 * its result to land on or wipe out.
 */
const DRAW_DURING_RUN = 'Drawing is paused while a run is in progress. Cancel the run to draw now.'
const OPEN_DURING_RUN = 'A run is in progress on this image. Cancel it first to open another.'
const SELECT_DURING_RUN = 'A run is in progress on this image. Cancel it first to switch images.'
const CANCELLED = 'Run cancelled. The image and history are as they were.'
const INTERRUPT_FAILED =
  'Run cancelled here, but ComfyUI could not be told to stop. It may still be using the GPU.'

const RUN_TIMEOUT_MS = Number(import.meta.env.VITE_RUN_TIMEOUT_MS) || DEFAULT_RUN_TIMEOUT_MS

export type TransformOutcome = {
  imageId: string
  workflowId: string
  prompt: string
  seed: number
  promptId: string
  loras: AppliedLora[]
}

export function useEditor() {
  const [state, dispatch] = useReducer(reducer, INITIAL, withStoredDir)

  // Validate every workflow before a run is possible, so misconfiguration is
  // reported at startup rather than after a failed transformation.
  useEffect(() => {
    let cancelled = false
    loadConfig()
      .then(({ workflows, loras }) => {
        if (!cancelled) dispatch({ type: 'workflowsLoaded', workflows, loras })
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

  const message = (e: unknown, fallback: string): string =>
    e instanceof LocalFolderError || e instanceof Error ? e.message : fallback

  /**
   * Both of these can be in flight more than once at a time — opening the chooser
   * starts a listing, and the user can ask for another before it lands. Responses
   * are not guaranteed to arrive in the order they were asked for, so each one
   * carries a ticket and a stale answer is dropped. Without this a slow first
   * listing overwrites a fast second one, which also clears the error banner the
   * second one had just set.
   */
  const folderSeq = useRef(0)
  const chooserSeq = useRef(0)

  const refreshFolder = useCallback(async (dir: string): Promise<void> => {
    const seq = ++folderSeq.current
    try {
      const folder = await listLocalImages(dir)
      if (seq === folderSeq.current) dispatch({ type: 'folderListed', folder })
    } catch (e) {
      if (seq === folderSeq.current) {
        dispatch({ type: 'folderError', message: message(e, 'Could not list the image folder.') })
      }
    }
  }, [])

  /** Move the chooser to a directory. No path means the server's home directory. */
  const browseTo = useCallback(async (path?: string | null): Promise<void> => {
    const seq = ++chooserSeq.current
    dispatch({ type: 'chooserRequested' })
    try {
      const listing = await browseDirs(path)
      if (seq === chooserSeq.current) dispatch({ type: 'chooserListed', listing })
    } catch (e) {
      if (seq === chooserSeq.current) {
        dispatch({ type: 'chooserError', message: message(e, 'Could not open that folder.') })
      }
    }
  }, [])

  // ImageBitmaps are not state — they are handles the canvas draws from. Keyed by
  // the same id the history entry uses, so selecting an entry finds its bitmap.
  const bitmaps = useRef(new Map<string, ImageBitmap>())

  /** Held from the click on Run to the end of the batch; aborting it cancels the run. */
  const runLock = useRef<AbortController | null>(null)

  const adoptImage = useCallback(
    async (
      blob: Blob,
      origin: EntryOrigin,
      rebased: boolean,
      parentId?: string | null,
      signal?: AbortSignal,
    ): Promise<BaseImage | null> => {
      const bitmap = await createImageBitmap(blob)
      // Both can become true while the bitmap decodes. An open that started before
      // the run must not swap the image out from under it; a cancelled run's result
      // must not land after the user was told the run had stopped.
      if (signal?.aborted || (origin.kind === 'upload' && runLock.current)) {
        bitmap.close()
        if (origin.kind === 'upload') dispatch({ type: 'notice', message: OPEN_DURING_RUN })
        return null
      }
      const base: BaseImage = {
        id: `img-${crypto.randomUUID()}`,
        bitmap,
        width: bitmap.width,
        height: bitmap.height,
      }
      // An upload empties the history, so the bitmaps behind the discarded entries
      // are unreachable — dropping them here keeps the map from growing for the
      // life of the session. Done after createImageBitmap, so a file that turns
      // out not to be an image leaves the existing session alone.
      if (origin.kind === 'upload') bitmaps.current.clear()
      bitmaps.current.set(base.id, bitmap)

      dispatch({
        type: 'imageAdded',
        rebased,
        image: { base, src: URL.createObjectURL(blob), createdAt: Date.now(), origin, parentId },
      })
      return base
    },
    [],
  )

  const unsaved = unsavedResultCount(state.history)

  /** Reload has only the browser's own prompt. A run in flight is unsaved work too. */
  const guardUnload = unsaved > 0 || state.runLocked
  useEffect(() => {
    if (!guardUnload) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [guardUnload])

  /**
   * Every way of bringing an image in comes through here, because each one empties
   * the history: refused during a run, and asked first over unsaved results.
   */
  const pendingOpen = useRef<(() => void) | null>(null)
  const requestOpen = useCallback(
    (open: () => void) => {
      if (runLock.current) {
        dispatch({ type: 'notice', message: OPEN_DURING_RUN })
      } else if (unsaved > 0) {
        pendingOpen.current = open
        dispatch({ type: 'openWarning', open: true })
      } else {
        open()
      }
    },
    [unsaved],
  )
  const answerOpenWarning = (discard: boolean) => {
    const open = pendingOpen.current
    pendingOpen.current = null
    dispatch({ type: 'openWarning', open: false })
    if (discard) open?.()
  }

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

  /**
   * Adopt an image out of the server folder. It arrives as an upload, not a
   * generation: it is a new starting point, so it resets the history exactly as
   * opening a local file does.
   */
  const openLocalImage = useCallback(
    async (path: string): Promise<BaseImage | null> => {
      const dir = state.folder.dir
      if (!dir) return null
      const version = state.folder.images.find((i) => i.path === path)?.mtime
      try {
        const blob = await fetchLocalImage(dir, path, version)
        const base = await adoptImage(blob, { kind: 'upload' }, false)
        if (base) dispatch({ type: 'folderClosed' })
        return base
      } catch {
        // The picker stays open — the user's next move is almost always to pick a
        // different file, not to start over.
        dispatch({ type: 'loadError', message: `Could not open "${path}" from the image folder.` })
        return null
      }
    },
    [adoptImage, state.folder.dir, state.folder.images],
  )

  /** Browse from the folder already chosen for this purpose, otherwise from home. */
  const openChooser = useCallback(
    (target: 'images' | 'save' = 'images') => {
      const from = target === 'save' ? state.save.dir : state.folder.dir
      dispatch({ type: 'chooserOpened', target, path: from ?? '' })
      void browseTo(from)
    },
    [browseTo, state.folder.dir, state.save.dir],
  )

  /**
   * "Open from folder…" goes straight to the chooser until a folder has been
   * chosen — with nothing chosen there is no grid to show, and making the user
   * dismiss an empty one first would be a step for nothing.
   */
  const openFolderPicker = useCallback(() => {
    const dir = state.folder.dir
    if (!dir) {
      openChooser()
      return
    }
    dispatch({ type: 'folderOpened' })
    // Re-listed on every open: the folder is live, and the whole point of pointing
    // at one is that things appear in it while the app is running.
    void refreshFolder(dir)
  }, [openChooser, refreshFolder, state.folder.dir])

  /** The current image's history entry, which is what a default filename describes. */
  const currentEntry = state.history.entries.find((e) => e.id === state.history.currentId)

  const chooseFolder = useCallback(
    (dir: string) => {
      if (state.chooser.target === 'save') {
        localStorage.setItem(SAVE_FOLDER_STORAGE_KEY, dir)
        // Straight back to the filename prompt, which is where the user was going.
        dispatch({
          type: 'saveFolderChosen',
          dir,
          name: currentEntry ? defaultSaveName(currentEntry.origin) : 'image.png',
        })
        return
      }
      localStorage.setItem(FOLDER_STORAGE_KEY, dir)
      dispatch({ type: 'folderChosen', dir })
      void refreshFolder(dir)
    },
    [currentEntry, refreshFolder, state.chooser.target],
  )

  /**
   * Ask for a filename, choosing a folder first if there is not one yet. The image
   * saved is the canvas as it stands — a generated result with nothing drawn on it
   * yet is exactly the generated result, and once something has been drawn, what
   * is on screen is what the user means by "this image".
   */
  const openSaveDialog = useCallback(() => {
    if (!state.base || !currentEntry) return
    if (!state.save.dir) {
      openChooser('save')
      return
    }
    dispatch({ type: 'saveOpened', name: defaultSaveName(currentEntry.origin) })
  }, [currentEntry, openChooser, state.base, state.save.dir])

  const saveImage = useCallback(
    async (getBlob: () => Promise<Blob>): Promise<string | null> => {
      const dir = state.save.dir
      if (!dir) return null

      const prepared = prepareSaveName(state.save.name)
      if (!prepared.ok) {
        dispatch({ type: 'saveFailed', message: prepared.reason })
        return null
      }

      dispatch({ type: 'saveStarted' })
      try {
        const path = await saveLocalImage(dir, prepared.name, await getBlob())
        dispatch({ type: 'saveDone', path })
        return path
      } catch (e) {
        // The dialog stays open carrying the reason — "already exists" is a
        // prompt to pick another name, not a dead end.
        dispatch({ type: 'saveFailed', message: message(e, 'Could not save the image.') })
        return null
      }
    },
    [state.save.dir, state.save.name],
  )

  const selectHistoryEntry = useCallback((id: string) => {
    if (runLock.current) {
      dispatch({ type: 'notice', message: SELECT_DURING_RUN })
      return
    }
    const bitmap = bitmaps.current.get(id)
    if (!bitmap) return
    dispatch({
      type: 'historySelected',
      base: { id, bitmap, width: bitmap.width, height: bitmap.height },
    })
  }, [])

  const selected = state.workflows.find((w) => w.meta.id === state.selectedWorkflowId)

  /** Slots this workflow declares, and the LoRAs it can actually load. */
  const loraSlots = selected?.meta.loraNodes?.length ?? 0
  const availableLoras = lorasFor(state.loraCatalog, state.selectedWorkflowId)

  const canRun =
    !!state.base &&
    !!selected &&
    !state.workflowError &&
    // A batch briefly reads "done" between runs; without this the button would
    // flicker back to enabled mid-batch and a second batch could be started.
    state.batch === null &&
    !state.runLocked &&
    state.run.phase !== 'uploading' &&
    state.run.phase !== 'queued' &&
    state.run.phase !== 'running'

  /**
   * Composite the canvas and run it through the chosen workflow `batchCount` times,
   * adopting each result. The workspace is left untouched on any failure.
   *
   * The two modes differ only in what the next run consumes and where its result
   * hangs in the history:
   *
   * - `variations` — every run is handed the same composite and parented to the
   *   image the batch started from, so the results are siblings to choose between.
   * - `serial` — each result becomes the next run's input and its parent, so the
   *   results form a refinement chain.
   *
   * A serial pass never re-composites the canvas. Adopting a result rebases the
   * document, which clears the marks, so the composite would be the result blob
   * anyway — and reading it back would mean waiting on a canvas repaint mid-batch.
   *
   * A failure stops the batch where it is. Runs that already finished keep their
   * history entries: they are real images that cost real GPU time, and discarding
   * them because a later run failed would be the more surprising behaviour.
   */
  const runBatch = useCallback(
    async (getBlob: () => Promise<Blob>): Promise<TransformOutcome[]> => {
      if (!selected || !state.base) return []
      // Taken synchronously, in the click itself: state would not flip canRun until
      // the next render, by which time a double-click has already started a second run.
      if (runLock.current) return []
      const controller = new AbortController()
      runLock.current = controller
      const { signal } = controller
      dispatch({ type: 'runLocked' })

      const total = clampBatchCount(state.batchCount)
      const seeds = batchSeeds(total, state.seed, state.seedLocked)
      const applied = state.loras.filter((l): l is NonNullable<LoraSelection> => l !== null)
      // Captured before anything is adopted, so every variation parents to the
      // image the user actually started from.
      const originId = state.history.currentId
      const outcomes: TransformOutcome[] = []

      try {
        let input = await getBlob()

        for (let i = 0; i < total; i++) {
          signal.throwIfAborted()
          const seed = seeds[i]!
          dispatch({ type: 'runStarted', seed, batchIndex: i + 1, batchTotal: total })

          const result = await runWorkflow(
            {
              canvasBlob: input,
              meta: selected.meta,
              graph: selected.graph,
              prompt: state.prompt,
              seed,
              loras: state.loras,
              timeoutMs: RUN_TIMEOUT_MS,
              signal,
              onInterruptFailed: () => dispatch({ type: 'notice', message: INTERRUPT_FAILED }),
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
              loras: applied,
            },
            true,
            state.batchMode === 'variations' ? originId : undefined,
            signal,
          )
          if (!base) break

          outcomes.push({
            imageId: base.id,
            workflowId: selected.meta.id,
            prompt: state.prompt,
            seed,
            promptId: result.promptId,
            loras: applied,
          })

          if (state.batchMode === 'serial') input = result.blob
        }
      } catch {
        // runWorkflow has already pushed an error RunState carrying the reason,
        // except for a cancel, which is not an error.
      } finally {
        runLock.current = null
        if (signal.aborted) dispatch({ type: 'runState', run: initialRunState() })
        dispatch({ type: 'batchEnded', notice: signal.aborted ? CANCELLED : null })
      }

      return outcomes
    },
    [
      selected,
      state.base,
      state.prompt,
      state.seed,
      state.seedLocked,
      state.loras,
      state.batchCount,
      state.batchMode,
      state.history.currentId,
      adoptImage,
    ],
  )

  return {
    state,
    selected,
    canRun,
    loraSlots,
    availableLoras,
    // Disabled during a run: the result rebases the document when it lands.
    canUndo: !state.runLocked && canUndo(state.doc),
    canRedo: !state.runLocked && canRedo(state.doc),
    hasShapes: !state.runLocked && state.doc.shapes.length > 0,
    cancelRun: useCallback(() => runLock.current?.abort(), []),
    noteDrawBlocked: useCallback(() => dispatch({ type: 'notice', message: DRAW_DURING_RUN }), []),
    loadImageFile: (file: File) => requestOpen(() => void loadImageFile(file)),
    openLocalImage: (path: string) => requestOpen(() => void openLocalImage(path)),
    unsavedResults: unsaved,
    keepResults: useCallback(() => answerOpenWarning(false), []),
    discardResults: useCallback(() => answerOpenWarning(true), []),
    openFolderPicker,
    openChooser,
    chooseFolder,
    browseTo,
    openSaveDialog,
    saveImage,
    canSave: !!state.base,
    changeSaveFolder: useCallback(() => openChooser('save'), [openChooser]),
    closeSaveDialog: useCallback(() => dispatch({ type: 'saveClosed' }), []),
    editSaveName: useCallback((name: string) => dispatch({ type: 'saveNameEdited', name }), []),
    closeFolderPicker: useCallback(() => dispatch({ type: 'folderClosed' }), []),
    closeChooser: useCallback(() => dispatch({ type: 'chooserClosed' }), []),
    editChooserPath: useCallback((path: string) => dispatch({ type: 'chooserPathEdited', path }), []),
    selectHistoryEntry,
    runBatch,
    commit: useCallback((shape: Shape) => {
      // A stroke begun before Run and finished after it: refused out loud, never
      // committed only to be wiped by the result.
      if (runLock.current) dispatch({ type: 'notice', message: DRAW_DURING_RUN })
      else dispatch({ type: 'commit', shape })
    }, []),
    undo: useCallback(() => dispatch({ type: 'undo' }), []),
    redo: useCallback(() => dispatch({ type: 'redo' }), []),
    clear: useCallback(() => dispatch({ type: 'clear' }), []),
    setTool: useCallback((tool: ToolId) => dispatch({ type: 'setTool', tool }), []),
    setColor: useCallback((color: string) => dispatch({ type: 'setColor', color }), []),
    pickColor: useCallback((color: string) => dispatch({ type: 'colorPicked', color }), []),
    setWidth: useCallback((width: number) => dispatch({ type: 'setWidth', width }), []),
    selectWorkflow: useCallback((id: string) => dispatch({ type: 'selectWorkflow', id }), []),
    setPrompt: useCallback((prompt: string) => dispatch({ type: 'setPrompt', prompt }), []),
    setSeed: useCallback((seed: number) => dispatch({ type: 'setSeed', seed }), []),
    setSeedLock: useCallback((locked: boolean) => dispatch({ type: 'setSeedLock', locked }), []),
    setLora: useCallback(
      (slot: number, selection: LoraSelection) => dispatch({ type: 'setLora', slot, selection }),
      [],
    ),
    setBatchCount: useCallback((count: number) => dispatch({ type: 'setBatchCount', count }), []),
    setBatchMode: useCallback((mode: BatchMode) => dispatch({ type: 'setBatchMode', mode }), []),
  }
}

export type Editor = ReturnType<typeof useEditor>

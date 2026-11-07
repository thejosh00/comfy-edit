import {
  applyHistory,
  applyWsMessage,
  initialRunState,
  isTerminal,
  selectOutputImage,
  type OutputImageRef,
  type RunState,
} from '../core/comfyEvents'
import { patchWorkflow, type ApiGraph, type WorkflowMeta } from '../core/workflow'
import type { LoraSelection } from '../core/loras'
import {
  ComfyApiError,
  comfyWsUrl,
  fetchImageBlob,
  getHistory,
  interruptRun,
  queuePrompt,
  uploadImage,
} from './client'

export const DEFAULT_RUN_TIMEOUT_MS = 300_000
const POLL_INTERVAL_MS = 1500
/**
 * One stalled poll must not use up the whole deadline: polling is the authority
 * on completion, so a dropped request is retried rather than waited out.
 */
const POLL_FETCH_TIMEOUT_MS = 15_000

export type RunArgs = {
  canvasBlob: Blob
  meta: WorkflowMeta
  graph: ApiGraph
  prompt: string
  seed: number
  /** One entry per declared LoRA slot, in slot order. */
  loras?: LoraSelection[]
  timeoutMs?: number
  /** Cancels the run: aborts its fetches and asks ComfyUI to stop it. */
  signal?: AbortSignal
  /** ComfyUI could not be told to stop a cancelled run, so it may still be working. */
  onInterruptFailed?: () => void
}

export type RunResult = { blob: Blob; promptId: string; seed: number }

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })

/**
 * Run one transformation.
 *
 * The WebSocket is cosmetic — node name and progress percentage only. Polling
 * /history is the authority on completion. If the socket never opens, drops
 * mid-run, or speaks a dialect we did not anticipate, the run still completes and
 * only the progress bar is lost. That is both more robust and less code than a
 * reconnect state machine.
 */
export async function runWorkflow(
  args: RunArgs,
  onState: (state: RunState) => void,
): Promise<RunResult> {
  const timeoutMs = args.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS
  const clientId = crypto.randomUUID()
  // Every fetch of the run carries this, so a connection that never answers ends
  // at the deadline instead of hanging the run forever.
  const deadline = AbortSignal.timeout(timeoutMs)
  const signal = args.signal ? AbortSignal.any([args.signal, deadline]) : deadline

  let state: RunState = { ...initialRunState(), phase: 'uploading' }
  const push = (next: RunState) => {
    state = next
    onState(state)
  }
  push(state)

  // Open the socket before queueing so no early events are missed. Best effort:
  // every failure here is swallowed.
  let socket: WebSocket | null = null
  try {
    socket = new WebSocket(comfyWsUrl(clientId))
  } catch {
    socket = null
  }

  let queueing = false
  let queuedId: string | null = null

  const cleanup = () => {
    try {
      // A frame still in transit must not repaint a run that has ended.
      if (socket) socket.onmessage = null
      socket?.close()
    } catch {
      /* already gone */
    }
  }

  try {
    const filename = `comfy-edit-${Date.now()}-${clientId.slice(0, 8)}.png`
    const uploaded = await uploadImage(args.canvasBlob, filename, signal)

    const graph = patchWorkflow(args.graph, args.meta, {
      imageFilename: uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name,
      prompt: args.prompt,
      seed: args.seed,
      loras: args.loras,
    })

    push({ ...state, phase: 'queued' })
    queueing = true
    const { prompt_id: promptId } = await queuePrompt(graph, clientId, signal)
    queuedId = promptId
    push({ ...state, phase: 'running', promptId })

    if (socket) {
      socket.onmessage = (ev) => {
        // Binary frames (sampler previews) are out of scope for v1.
        if (typeof ev.data !== 'string') return
        const next = applyWsMessage(state, ev.data, promptId)
        // The socket may not report a terminal phase reliably; let the poll decide.
        if (next !== state) push(next.phase === 'done' ? { ...next, phase: 'running' } : next)
      }
      socket.onerror = () => {
        /* cosmetic channel; the poll carries on */
      }
    }

    const image = await pollUntilDone(promptId, signal, () => state, push)
    const blob = await fetchImageBlob(image, signal)
    signal.throwIfAborted()

    push({ ...state, phase: 'done', progress: 100, images: [image] })
    return { blob, promptId, seed: args.seed }
  } catch (e) {
    if (args.signal?.aborted) {
      // Nothing to stop until the prompt has at least been sent. The caller resets
      // the run state; an error here would read as a failure the user did not have.
      if (queueing) void interruptRun(queuedId).catch(() => args.onInterruptFailed?.())
      throw e
    }
    const message = deadline.aborted
      ? `The transformation timed out after ${Math.round(timeoutMs / 1000)}s.`
      : e instanceof ComfyApiError || e instanceof Error
        ? e.message
        : 'The transformation failed for an unknown reason.'
    push({ ...state, phase: 'error', error: message })
    throw e
  } finally {
    cleanup()
  }
}

/** Poll /history until the run reaches a terminal state or `signal` fires. */
async function pollUntilDone(
  promptId: string,
  signal: AbortSignal,
  read: () => RunState,
  push: (s: RunState) => void,
): Promise<OutputImageRef> {
  for (;;) {
    signal.throwIfAborted()

    const poll = AbortSignal.any([signal, AbortSignal.timeout(POLL_FETCH_TIMEOUT_MS)])
    const json = await getHistory(promptId, poll).catch(() => null)
    signal.throwIfAborted()
    if (json) {
      const next = applyHistory(read(), json, promptId)
      if (isTerminal(next)) {
        if (next.phase === 'error') {
          const reason = read().error ?? next.error ?? 'The workflow failed.'
          push({ ...read(), phase: 'error', error: reason })
          throw new ComfyApiError(reason)
        }
        const entry = (json as Record<string, unknown>)[promptId]
        const image = selectOutputImage(entry) ?? next.images[0]
        if (!image) throw new ComfyApiError('The workflow finished but produced no output image.')
        return image
      }
    }

    // A websocket-reported failure is terminal even if history has not caught up.
    const current = read()
    if (current.phase === 'error') throw new ComfyApiError(current.error ?? 'The workflow failed.')

    await sleep(POLL_INTERVAL_MS, signal)
  }
}

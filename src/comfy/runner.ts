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
  queuePrompt,
  uploadImage,
} from './client'

export const DEFAULT_RUN_TIMEOUT_MS = 300_000
const POLL_INTERVAL_MS = 1500

export type RunArgs = {
  canvasBlob: Blob
  meta: WorkflowMeta
  graph: ApiGraph
  prompt: string
  seed: number
  /** One entry per declared LoRA slot, in slot order. */
  loras?: LoraSelection[]
  timeoutMs?: number
  signal?: AbortSignal
}

export type RunResult = { blob: Blob; promptId: string; seed: number }

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

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

  const cleanup = () => {
    try {
      socket?.close()
    } catch {
      /* already gone */
    }
  }

  try {
    const filename = `comfy-edit-${Date.now()}-${clientId.slice(0, 8)}.png`
    const uploaded = await uploadImage(args.canvasBlob, filename)

    const graph = patchWorkflow(args.graph, args.meta, {
      imageFilename: uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name,
      prompt: args.prompt,
      seed: args.seed,
      loras: args.loras,
    })

    push({ ...state, phase: 'queued' })
    const { prompt_id: promptId } = await queuePrompt(graph, clientId)
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

    const image = await pollUntilDone(promptId, timeoutMs, args.signal, () => state, push)
    const blob = await fetchImageBlob(image)

    push({ ...state, phase: 'done', progress: 100, images: [image] })
    return { blob, promptId, seed: args.seed }
  } catch (e) {
    const message =
      e instanceof ComfyApiError || e instanceof Error
        ? e.message
        : 'The transformation failed for an unknown reason.'
    push({ ...state, phase: 'error', error: message })
    throw e
  } finally {
    cleanup()
  }
}

/** Poll /history until the run reaches a terminal state or the deadline passes. */
async function pollUntilDone(
  promptId: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  read: () => RunState,
  push: (s: RunState) => void,
): Promise<OutputImageRef> {
  const deadline = Date.now() + timeoutMs

  for (;;) {
    if (signal?.aborted) throw new Error('The transformation was cancelled.')

    const json = await getHistory(promptId).catch(() => null)
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

    if (Date.now() >= deadline) {
      push({ ...current, phase: 'error', error: `The transformation timed out after ${Math.round(timeoutMs / 1000)}s.` })
      throw new ComfyApiError(`The transformation timed out after ${Math.round(timeoutMs / 1000)}s.`)
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

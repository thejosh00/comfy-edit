export type RunPhase = 'idle' | 'uploading' | 'queued' | 'running' | 'done' | 'error'

export type OutputImageRef = { filename: string; subfolder: string; type: string }

export type RunState = {
  phase: RunPhase
  promptId: string | null
  node: string | null
  progress: number | null
  queueRemaining: number | null
  error: string | null
  images: OutputImageRef[]
}

export function initialRunState(): RunState {
  return {
    phase: 'idle',
    promptId: null,
    node: null,
    progress: null,
    queueRemaining: null,
    error: null,
    images: [],
  }
}

export function isTerminal(state: RunState): boolean {
  return state.phase === 'done' || state.phase === 'error'
}

type Envelope = { type: string; data?: Record<string, unknown> }

function parse(raw: string): Envelope | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const env = parsed as Envelope
    return typeof env.type === 'string' ? env : null
  } catch {
    return null
  }
}

/**
 * Reduce one WebSocket text frame into run state.
 *
 * Handles both ComfyUI dialects — `progress` vs `progress_state`, and
 * `execution_success` vs the legacy `executing` with a null node — because the
 * remote instance's version is unknown and a client that handles only one works
 * locally but hangs against the real box.
 */
export function applyWsMessage(state: RunState, raw: string, promptId: string): RunState {
  const env = parse(raw)
  if (!env) return state

  const data = env.data ?? {}

  // `status` carries no prompt_id, so it must be handled before the filter below.
  if (env.type === 'status') {
    const remaining = (data['status'] as { exec_info?: { queue_remaining?: number } } | undefined)
      ?.exec_info?.queue_remaining
    return typeof remaining === 'number' ? { ...state, queueRemaining: remaining } : state
  }

  // Another tab sharing this client id would otherwise leak its events in.
  if (typeof data['prompt_id'] === 'string' && data['prompt_id'] !== promptId) return state

  switch (env.type) {
    case 'execution_start':
      return { ...state, phase: 'running', promptId }

    case 'executing': {
      // A null node is older ComfyUI's only completion signal.
      if (data['node'] === null) return { ...state, phase: 'done', node: null }
      const node = data['display_node'] ?? data['node']
      return { ...state, phase: 'running', node: typeof node === 'string' ? node : state.node }
    }

    case 'progress': {
      const value = Number(data['value'])
      const max = Number(data['max'])
      if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return state
      return { ...state, progress: Math.round((value / max) * 100) }
    }

    case 'progress_state': {
      const nodes = data['nodes'] as
        | Record<string, { value?: number; max?: number; state?: string }>
        | undefined
      if (!nodes) return state
      let value = 0
      let max = 0
      for (const n of Object.values(nodes)) {
        if (n?.state !== 'running') continue
        value += Number(n.value ?? 0)
        max += Number(n.max ?? 0)
      }
      if (max <= 0) return state
      return { ...state, progress: Math.round((value / max) * 100) }
    }

    case 'executed': {
      const images = (data['output'] as { images?: OutputImageRef[] } | undefined)?.images
      return Array.isArray(images) ? { ...state, images } : state
    }

    case 'execution_success':
      return { ...state, phase: 'done' }

    case 'execution_error':
      return {
        ...state,
        phase: 'error',
        error: String(data['exception_message'] ?? 'The workflow failed.'),
      }

    case 'execution_interrupted':
      return { ...state, phase: 'error', error: 'The run was interrupted.' }

    default:
      return state
  }
}

type HistoryEntry = {
  outputs?: Record<string, { images?: OutputImageRef[] }>
  status?: {
    status_str?: string
    completed?: boolean
    /** ComfyUI records events as [name, payload] pairs. */
    messages?: Array<[string, Record<string, unknown>]>
  }
}

/**
 * History can arrive before the websocket's execution_error, so the reason has to
 * be recoverable from history alone — otherwise the user sees a generic failure
 * instead of the actual cause.
 */
function errorFromHistory(entry: HistoryEntry): string | null {
  const messages = entry.status?.messages
  if (!Array.isArray(messages)) return null

  for (const [name, payload] of messages) {
    if (name === 'execution_error' && payload && typeof payload['exception_message'] === 'string') {
      return payload['exception_message']
    }
  }
  return null
}

/**
 * Reduce a /history response. This — not the WebSocket — is the authority on
 * whether a run finished.
 */
export function applyHistory(state: RunState, json: unknown, promptId: string): RunState {
  if (!json || typeof json !== 'object') return state

  const entry = (json as Record<string, HistoryEntry>)[promptId]
  // While queued or running, /history returns {} with HTTP 200 — not a 404.
  if (!entry) return state

  if (entry.status?.completed === false || entry.status?.status_str === 'error') {
    return {
      ...state,
      phase: 'error',
      error: state.error ?? errorFromHistory(entry) ?? 'The workflow failed.',
    }
  }

  const image = selectOutputImage(entry)
  return { ...state, phase: 'done', images: image ? [image] : state.images }
}

/**
 * Pick the real result. `outputs` also contains PreviewImage entries typed "temp";
 * returning one of those shows a low-resolution preview in place of the result.
 */
export function selectOutputImage(entry: unknown): OutputImageRef | null {
  if (!entry || typeof entry !== 'object') return null
  const outputs = (entry as HistoryEntry).outputs
  if (!outputs) return null

  const images = Object.values(outputs)
    .flatMap((o) => o?.images ?? [])
    .filter((img) => img?.type === 'output')

  return images.length > 0 ? images[images.length - 1]! : null
}

import {
  parseManifest,
  validateWorkflow,
  WorkflowConfigError,
  type ApiGraph,
  type WorkflowMeta,
} from '../core/workflow'
import type { OutputImageRef } from '../core/comfyEvents'

/**
 * Everything goes through this same-origin prefix. Besides avoiding CORS on the
 * remote instance, it keeps generated images same-origin so the canvas is never
 * tainted — without which getImageData and toBlob both throw.
 */
export const COMFY_BASE = '/comfy'

export const WORKFLOWS_BASE = '/workflows'

export class ComfyApiError extends Error {
  constructor(
    message: string,
    readonly nodeErrors?: unknown,
  ) {
    super(message)
    this.name = 'ComfyApiError'
  }
}

export type UploadResult = { name: string; subfolder: string; type: string }

export async function uploadImage(blob: Blob, filename: string): Promise<UploadResult> {
  const form = new FormData()
  // Field must be named "image"; never set Content-Type by hand — the browser has
  // to generate the multipart boundary.
  form.append('image', blob, filename)
  form.append('type', 'input')

  const res = await fetch(`${COMFY_BASE}/upload/image`, { method: 'POST', body: form })
  if (!res.ok) {
    throw new ComfyApiError(`Upload failed (${res.status}): ${await res.text()}`)
  }
  return (await res.json()) as UploadResult
}

export async function queuePrompt(graph: ApiGraph, clientId: string): Promise<{ prompt_id: string }> {
  const res = await fetch(`${COMFY_BASE}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // snake_case here; the websocket query parameter is camelCase clientId.
    body: JSON.stringify({ prompt: graph, client_id: clientId }),
  })

  if (!res.ok) {
    // Surfaced verbatim: this is where "value not in list: <model>.safetensors"
    // appears, which is the most useful diagnostic the app can show.
    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string; details?: string }; node_errors?: unknown }
      | null
    const detail =
      body?.error?.message ??
      (body ? JSON.stringify(body) : `${res.status} ${res.statusText}`)
    throw new ComfyApiError(detail, body?.node_errors)
  }

  return (await res.json()) as { prompt_id: string }
}

export async function getHistory(promptId: string): Promise<unknown> {
  const res = await fetch(`${COMFY_BASE}/history/${promptId}`)
  if (!res.ok) throw new ComfyApiError(`History request failed (${res.status})`)
  return res.json()
}

export function viewUrl(ref: OutputImageRef): string {
  const params = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder ?? '',
    type: ref.type ?? 'output',
  })
  return `${COMFY_BASE}/view?${params}`
}

export async function fetchImageBlob(ref: OutputImageRef): Promise<Blob> {
  const res = await fetch(viewUrl(ref))
  if (!res.ok) throw new ComfyApiError(`Could not fetch the result image (${res.status}).`)
  return res.blob()
}

export function comfyWsUrl(clientId: string): string {
  const origin = location.origin.replace(/^http/, 'ws')
  return `${origin}${COMFY_BASE}/ws?clientId=${encodeURIComponent(clientId)}`
}

export type LoadedWorkflow = { meta: WorkflowMeta; graph: ApiGraph }

/**
 * Load and validate every configured workflow. Throws WorkflowConfigError on the
 * first problem, so misconfiguration surfaces at startup rather than after a run.
 */
export async function loadWorkflows(): Promise<LoadedWorkflow[]> {
  const manifestUrl = `${WORKFLOWS_BASE}/manifest.json`

  const res = await fetch(manifestUrl)
  if (!res.ok) {
    throw new WorkflowConfigError(`Could not read ${manifestUrl} (${res.status}).`)
  }

  let manifestJson: unknown
  try {
    manifestJson = await res.json()
  } catch (e) {
    throw new WorkflowConfigError(
      `${manifestUrl} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    )
  }

  const metas = parseManifest(manifestJson)

  return Promise.all(
    metas.map(async (meta) => {
      const graphUrl = `${WORKFLOWS_BASE}/${meta.file}`
      const graphRes = await fetch(graphUrl)
      if (!graphRes.ok) {
        throw new WorkflowConfigError(
          `workflow '${meta.id}': could not read '${graphUrl}' (${graphRes.status}).`,
        )
      }

      let graph: ApiGraph
      try {
        graph = (await graphRes.json()) as ApiGraph
      } catch (e) {
        throw new WorkflowConfigError(
          `workflow '${meta.id}': '${meta.file}' is not valid JSON: ${
            e instanceof Error ? e.message : String(e)
          }`,
        )
      }

      validateWorkflow(meta, graph)
      return { meta, graph }
    }),
  )
}

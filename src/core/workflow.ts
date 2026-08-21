// Type-only, and therefore erased: loras.ts imports WorkflowConfigError from
// here, so a value import in this direction would close a runtime cycle.
import type { LoraSelection } from './loras'

/** How many LoRA slots a workflow may declare, and the most the UI will show. */
export const MAX_LORA_SLOTS = 3

export type WorkflowMeta = {
  id: string
  label: string
  file: string
  imageNode: string
  imageInput?: string
  promptNode: string
  promptInput?: string
  seedNode: string
  seedInput?: string
  /**
   * Node ids of the user-controllable LoRA slots, in slot order. Optional, at
   * most MAX_LORA_SLOTS. Declared explicitly rather than discovered by scanning
   * for LoraLoader nodes, because a graph may also carry a LoRA that must stay
   * on — qwen-2511's Lightning 4-step loader is exactly that.
   */
  loraNodes?: string[]
  loraNameInput?: string
  loraStrengthInput?: string
}

export type ApiNode = {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: { title?: string }
}

/** ComfyUI API format: a flat object keyed by node id. */
export type ApiGraph = Record<string, ApiNode>

export class WorkflowConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WorkflowConfigError'
  }
}

const REQUIRED_FIELDS = ['id', 'label', 'file', 'imageNode', 'promptNode', 'seedNode'] as const

/** Default input names, tried in order, when the manifest does not override them. */
const DEFAULT_INPUTS = {
  image: ['image'],
  prompt: ['prompt', 'text'],
  seed: ['seed', 'noise_seed'],
  loraName: ['lora_name'],
  loraStrength: ['strength_model', 'strength'],
} as const

type Role = keyof typeof DEFAULT_INPUTS

/**
 * The manifest fields an error message should name for each role. Image, prompt
 * and seed follow the `<role>Node` / `<role>Input` convention; the LoRA roles do
 * not, since one `loraNodes` array feeds two inputs per node.
 */
const MANIFEST_FIELDS: Record<Role, { node: string; input: string }> = {
  image: { node: 'imageNode', input: 'imageInput' },
  prompt: { node: 'promptNode', input: 'promptInput' },
  seed: { node: 'seedNode', input: 'seedInput' },
  loraName: { node: 'loraNodes', input: 'loraNameInput' },
  loraStrength: { node: 'loraNodes', input: 'loraStrengthInput' },
}

export function parseManifest(json: unknown): WorkflowMeta[] {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { workflows?: unknown }).workflows)) {
    throw new WorkflowConfigError(
      'workflows/manifest.json must be an object with a "workflows" array.',
    )
  }

  const entries = (json as { workflows: unknown[] }).workflows
  return entries.map((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new WorkflowConfigError(`workflows/manifest.json: entry ${i} is not an object.`)
    }
    const entry = raw as Record<string, unknown>
    const id = typeof entry['id'] === 'string' ? entry['id'] : `entry ${i}`

    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new WorkflowConfigError(
          `workflow '${id}': manifest entry is missing the required field "${field}".`,
        )
      }
    }

    const loraNodes = entry['loraNodes']
    if (loraNodes !== undefined) {
      const bad =
        !Array.isArray(loraNodes) ||
        loraNodes.length === 0 ||
        loraNodes.length > MAX_LORA_SLOTS ||
        loraNodes.some((n) => typeof n !== 'string' || n === '')
      if (bad) {
        throw new WorkflowConfigError(
          `workflow '${id}': "loraNodes" must be an array of 1 to ${MAX_LORA_SLOTS} node ids, ` +
            `in slot order. Omit it entirely for a workflow with no user-selectable LoRAs.`,
        )
      }
    }

    return entry as unknown as WorkflowMeta
  })
}

function describeGraph(graph: ApiGraph): string {
  return Object.entries(graph)
    .map(([id, node]) => `${id} (${node?.class_type ?? 'unknown'})`)
    .join(', ')
}

type Target = { node: string; input: string }

/**
 * Resolve which input key a value should be written to, and validate that it is
 * writable. Only ever returns a key that already exists — see the note on
 * patchWorkflow for why that matters.
 */
function resolveTarget(
  meta: WorkflowMeta,
  graph: ApiGraph,
  role: Role,
  nodeId: string,
  override: string | undefined,
): Target {
  const fields = MANIFEST_FIELDS[role]
  const node = graph[nodeId]
  if (!node || typeof node !== 'object' || typeof node.inputs !== 'object') {
    throw new WorkflowConfigError(
      `workflow '${meta.id}': declares ${fields.node} '${nodeId}' but the graph has no node '${nodeId}'. ` +
        `Available nodes: ${describeGraph(graph)}.`,
    )
  }

  const candidates = override ? [override] : DEFAULT_INPUTS[role]
  const input = candidates.find((c) => c in node.inputs)
  if (!input) {
    throw new WorkflowConfigError(
      `workflow '${meta.id}': node '${nodeId}' (${node.class_type}) has no ${role} input. ` +
        `Looked for ${candidates.map((c) => `'${c}'`).join(' or ')}; ` +
        `it has: ${Object.keys(node.inputs).join(', ')}. ` +
        `Set "${fields.input}" in the manifest to pick one.`,
    )
  }

  // In API format a linked input is ["<nodeId>", <slot>]. Writing a scalar over
  // that silently breaks the graph, so refuse and say where to point instead.
  const current = node.inputs[input]
  if (Array.isArray(current)) {
    throw new WorkflowConfigError(
      `workflow '${meta.id}': node '${nodeId}' input '${input}' is driven by a link from node ` +
        `'${String(current[0])}'. Point ${fields.node} at node '${String(current[0])}' instead.`,
    )
  }

  return { node: nodeId, input }
}

/** The two targets one LoRA slot writes to. */
function resolveLoraTargets(meta: WorkflowMeta, graph: ApiGraph, nodeId: string) {
  return {
    name: resolveTarget(meta, graph, 'loraName', nodeId, meta.loraNameInput),
    strength: resolveTarget(meta, graph, 'loraStrength', nodeId, meta.loraStrengthInput),
  }
}

export function validateWorkflow(meta: WorkflowMeta, graph: ApiGraph): void {
  // The mistake everyone makes: a plain save instead of Export (API).
  if (graph && Array.isArray((graph as unknown as { nodes?: unknown }).nodes)) {
    throw new WorkflowConfigError(
      `workflow '${meta.id}': '${meta.file}' looks like a UI-format workflow export ` +
        `(it has a top-level "nodes" array), not an API-format one. ` +
        `In ComfyUI use Workflow -> Export (API).`,
    )
  }
  if (!graph || typeof graph !== 'object') {
    throw new WorkflowConfigError(`workflow '${meta.id}': '${meta.file}' is not a workflow graph.`)
  }

  resolveTarget(meta, graph, 'image', meta.imageNode, meta.imageInput)
  resolveTarget(meta, graph, 'prompt', meta.promptNode, meta.promptInput)
  resolveTarget(meta, graph, 'seed', meta.seedNode, meta.seedInput)

  // Checked at startup so a mistyped slot id is a banner, not a run that silently
  // applies no LoRA and looks like the model ignoring it.
  for (const nodeId of meta.loraNodes ?? []) resolveLoraTargets(meta, graph, nodeId)
}

export type PatchArgs = {
  imageFilename: string
  prompt: string
  seed: number
  /** One entry per declared slot, in slot order. Missing or null means empty. */
  loras?: LoraSelection[]
}

/**
 * Return a copy of the graph with the image, prompt, seed and LoRA slots injected.
 *
 * Only ever overwrites an input key that already exists. That guarantees we never
 * invent a field ComfyUI rejects, and — more importantly — turns a wrong node id in
 * the manifest into a loud error instead of a silent no-op that returns an
 * unedited image while appearing to succeed.
 */
export function patchWorkflow(graph: ApiGraph, meta: WorkflowMeta, args: PatchArgs): ApiGraph {
  const out: ApiGraph = structuredClone(graph)

  const image = resolveTarget(meta, out, 'image', meta.imageNode, meta.imageInput)
  const prompt = resolveTarget(meta, out, 'prompt', meta.promptNode, meta.promptInput)
  const seed = resolveTarget(meta, out, 'seed', meta.seedNode, meta.seedInput)

  out[image.node]!.inputs[image.input] = args.imageFilename
  out[prompt.node]!.inputs[prompt.input] = args.prompt
  out[seed.node]!.inputs[seed.input] = args.seed

  // Every declared slot is written every run — the manifest's node list is what
  // counts, not how many selections the caller happened to pass. An empty slot is
  // turned off with strength 0 rather than unlinked, so the model chain is never
  // rewired; its lora_name is left as authored, because ComfyUI validates that
  // name against the files on disk even when the strength is 0.
  meta.loraNodes?.forEach((nodeId, slot) => {
    const target = resolveLoraTargets(meta, out, nodeId)
    const selection = args.loras?.[slot] ?? null
    if (selection) out[nodeId]!.inputs[target.name.input] = selection.file
    out[nodeId]!.inputs[target.strength.input] = selection ? selection.strength : 0
  })

  return out
}

/**
 * ComfyUI caches by graph content, so an identical re-run returns the cached image
 * instantly and reads as a broken app. The rng is injectable to keep tests deterministic.
 */
export function randomSeed(rng: () => number = Math.random): number {
  return Math.floor(rng() * 0xffffffff)
}

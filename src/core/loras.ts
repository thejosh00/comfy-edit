import { WorkflowConfigError } from './workflow'

export type LoraMeta = {
  id: string
  label: string
  /** The .safetensors name as ComfyUI knows it; written to lora_name verbatim. */
  file: string
  /** Workflow ids this LoRA is offered for. Omitted means every workflow. */
  workflows?: string[]
  /** Initial slider value when selected. Defaults to DEFAULT_LORA_STRENGTH. */
  strength?: number
}

/** One UI slot. `null` means empty — which still writes strength_model: 0. */
export type LoraSelection = { file: string; strength: number } | null

export const DEFAULT_LORA_STRENGTH = 1

const REQUIRED_FIELDS = ['id', 'label', 'file'] as const

export function parseLoraManifest(json: unknown): LoraMeta[] {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { loras?: unknown }).loras)) {
    throw new WorkflowConfigError('workflows/loras.json must be an object with a "loras" array.')
  }

  const seen = new Set<string>()
  return (json as { loras: unknown[] }).loras.map((raw, i) => {
    if (!raw || typeof raw !== 'object') {
      throw new WorkflowConfigError(`workflows/loras.json: entry ${i} is not an object.`)
    }
    const entry = raw as Record<string, unknown>
    const id = typeof entry['id'] === 'string' ? entry['id'] : `entry ${i}`

    for (const field of REQUIRED_FIELDS) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new WorkflowConfigError(
          `lora '${id}': loras.json entry is missing the required field "${field}".`,
        )
      }
    }

    if (seen.has(id)) {
      throw new WorkflowConfigError(
        `lora '${id}': duplicate id in loras.json. Ids must be unique — two entries sharing one ` +
          `would make the slot dropdown ambiguous.`,
      )
    }
    seen.add(id)

    const workflows = entry['workflows']
    if (
      workflows !== undefined &&
      (!Array.isArray(workflows) || workflows.some((w) => typeof w !== 'string' || w === ''))
    ) {
      throw new WorkflowConfigError(
        `lora '${id}': "workflows" must be an array of workflow ids. Omit it to offer this LoRA ` +
          `for every workflow.`,
      )
    }

    const strength = entry['strength']
    if (strength !== undefined && (typeof strength !== 'number' || !Number.isFinite(strength))) {
      throw new WorkflowConfigError(`lora '${id}': "strength" must be a number.`)
    }

    return entry as unknown as LoraMeta
  })
}

/**
 * The LoRAs offered for one workflow, in catalog order. A LoRA trained for one
 * base model does nothing useful on another, so an entry naming its workflows is
 * hidden everywhere else rather than being offered and failing at run time.
 */
export function lorasFor(catalog: LoraMeta[], workflowId: string): LoraMeta[] {
  return catalog.filter((l) => !l.workflows || l.workflows.includes(workflowId))
}

/** An all-empty slot array, sized to the workflow's declared slots. */
export function emptySelections(count: number): LoraSelection[] {
  return Array.from({ length: count }, () => null)
}

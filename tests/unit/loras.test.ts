import { describe, it, expect } from 'vitest'
import {
  parseLoraManifest,
  lorasFor,
  DEFAULT_LORA_STRENGTH,
  type LoraMeta,
} from '../../src/core/loras'
import { WorkflowConfigError } from '../../src/core/workflow'

const CATALOG: LoraMeta[] = [
  { id: 'darkbrush', label: 'Dark Brush', file: 'krea2_darkbrush.safetensors', workflows: ['krea2-refine'], strength: 0.8 },
  { id: 'female', label: 'Female', file: 'female.safetensors', workflows: ['qwen-2511'] },
  { id: 'universal', label: 'Universal', file: 'universal.safetensors' },
]

describe('parseLoraManifest', () => {
  it('reads a well-formed catalog in order', () => {
    const loras = parseLoraManifest({ loras: CATALOG })
    expect(loras.map((l) => l.id)).toEqual(['darkbrush', 'female', 'universal'])
    expect(loras[0]!.file).toBe('krea2_darkbrush.safetensors')
  })

  it('accepts an empty catalog — offering no LoRAs is a valid configuration', () => {
    expect(parseLoraManifest({ loras: [] })).toEqual([])
  })

  it('rejects a manifest that is not an object with a loras array', () => {
    expect(() => parseLoraManifest(null)).toThrow(WorkflowConfigError)
    expect(() => parseLoraManifest({})).toThrow(/loras/)
    expect(() => parseLoraManifest({ loras: 'nope' })).toThrow(/loras/)
  })

  it.each(['id', 'label', 'file'] as const)(
    'names the LoRA and the missing field when %s is absent',
    (field) => {
      const bad: Record<string, unknown> = { ...CATALOG[0] }
      delete bad[field]
      try {
        parseLoraManifest({ loras: [bad] })
        throw new Error('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(WorkflowConfigError)
        expect((e as Error).message).toContain(field)
        if (field !== 'id') expect((e as Error).message).toContain('darkbrush')
      }
    },
  )

  it('rejects a duplicate id, which would make the dropdown ambiguous', () => {
    try {
      parseLoraManifest({ loras: [CATALOG[0], { ...CATALOG[1], id: 'darkbrush' }] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowConfigError)
      expect((e as Error).message).toContain('darkbrush')
      expect((e as Error).message).toMatch(/duplicate/i)
    }
  })

  it('rejects a non-numeric strength', () => {
    try {
      parseLoraManifest({ loras: [{ ...CATALOG[0], strength: 'strong' }] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowConfigError)
      expect((e as Error).message).toContain('strength')
      expect((e as Error).message).toContain('darkbrush')
    }
  })

  it('rejects a workflows field that is not an array of strings', () => {
    expect(() => parseLoraManifest({ loras: [{ ...CATALOG[0], workflows: 'krea2-refine' }] })).toThrow(
      WorkflowConfigError,
    )
    expect(() => parseLoraManifest({ loras: [{ ...CATALOG[0], workflows: [1] }] })).toThrow(
      WorkflowConfigError,
    )
  })
})

describe('lorasFor', () => {
  it('offers only LoRAs whose allowlist names the workflow', () => {
    expect(lorasFor(CATALOG, 'krea2-refine').map((l) => l.id)).toEqual(['darkbrush', 'universal'])
    expect(lorasFor(CATALOG, 'qwen-2511').map((l) => l.id)).toEqual(['female', 'universal'])
  })

  it('treats an omitted allowlist as "every workflow"', () => {
    expect(lorasFor(CATALOG, 'passthrough').map((l) => l.id)).toEqual(['universal'])
  })

  it('preserves catalog order', () => {
    const reordered = [CATALOG[2]!, CATALOG[0]!]
    expect(lorasFor(reordered, 'krea2-refine').map((l) => l.id)).toEqual(['universal', 'darkbrush'])
  })

  it('returns nothing for an empty catalog', () => {
    expect(lorasFor([], 'krea2-refine')).toEqual([])
  })
})

describe('DEFAULT_LORA_STRENGTH', () => {
  it('is full strength, so a LoRA selected without a catalog default does something', () => {
    expect(DEFAULT_LORA_STRENGTH).toBe(1)
  })
})

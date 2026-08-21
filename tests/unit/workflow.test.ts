import { describe, it, expect } from 'vitest'
import {
  parseManifest,
  validateWorkflow,
  patchWorkflow,
  randomSeed,
  WorkflowConfigError,
  type ApiGraph,
  type WorkflowMeta,
} from '../../src/core/workflow'
import type { LoraSelection } from '../../src/core/loras'

const META: WorkflowMeta = {
  id: 'passthrough',
  label: 'Passthrough',
  file: 'passthrough.api.json',
  imageNode: '1',
  promptNode: '2',
  seedNode: '3',
}

const graph = (): ApiGraph => ({
  '1': { class_type: 'LoadImage', inputs: { image: 'PLACEHOLDER.png', upload: 'image' } },
  '2': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['4', 0] } },
  '3': { class_type: 'KSampler', inputs: { seed: 0, steps: 4, latent_image: ['1', 0] } },
  '4': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
})

/** META plus three chained LoRA slots, mirroring the real qwen-2511/krea2 graphs. */
const LORA_META: WorkflowMeta = { ...META, loraNodes: ['5', '6', '7'] }

const loraGraph = (): ApiGraph => {
  const g = graph()
  for (const [id, from] of [
    ['5', '4'],
    ['6', '5'],
    ['7', '6'],
  ] as const) {
    g[id] = {
      class_type: 'LoraLoaderModelOnly',
      inputs: { lora_name: 'baked-in.safetensors', strength_model: 0, model: [from, 0] },
    }
  }
  return g
}

describe('parseManifest', () => {
  it('reads a well-formed manifest in order', () => {
    const metas = parseManifest({
      workflows: [
        { ...META },
        { ...META, id: 'other', label: 'Other', file: 'other.api.json' },
      ],
    })
    expect(metas.map((m) => m.id)).toEqual(['passthrough', 'other'])
  })

  it('rejects a manifest that is not an object with a workflows array', () => {
    expect(() => parseManifest(null)).toThrow(WorkflowConfigError)
    expect(() => parseManifest({})).toThrow(/workflows/)
    expect(() => parseManifest({ workflows: 'nope' })).toThrow(/workflows/)
  })

  it.each(['id', 'label', 'file', 'imageNode', 'promptNode', 'seedNode'] as const)(
    'names the workflow and the missing field when %s is absent',
    (field) => {
      const bad: Record<string, unknown> = { ...META }
      delete bad[field]
      try {
        parseManifest({ workflows: [bad] })
        throw new Error('should have thrown')
      } catch (e) {
        expect(e).toBeInstanceOf(WorkflowConfigError)
        expect((e as Error).message).toContain(field)
        if (field !== 'id') expect((e as Error).message).toContain('passthrough')
      }
    },
  )

  it('accepts an entry with no loraNodes — LoRA support is opt-in per workflow', () => {
    const [meta] = parseManifest({ workflows: [{ ...META }] })
    expect(meta!.loraNodes).toBeUndefined()
  })

  it('reads loraNodes in slot order', () => {
    const [meta] = parseManifest({ workflows: [{ ...LORA_META }] })
    expect(meta!.loraNodes).toEqual(['5', '6', '7'])
  })

  it.each([
    ['not an array', 'nope'],
    ['a non-string entry', ['5', 6]],
    ['an empty-string entry', ['5', '']],
    ['more than three slots', ['5', '6', '7', '8']],
  ])('rejects loraNodes that is %s', (_label, loraNodes) => {
    try {
      parseManifest({ workflows: [{ ...META, loraNodes }] })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(WorkflowConfigError)
      expect((e as Error).message).toContain('loraNodes')
      expect((e as Error).message).toContain('passthrough')
    }
  })
})

describe('validateWorkflow', () => {
  it('accepts a graph whose declared nodes and inputs all exist', () => {
    expect(() => validateWorkflow(META, graph())).not.toThrow()
  })

  it('names the missing node and lists the ids that do exist', () => {
    const meta = { ...META, imageNode: '78' }
    try {
      validateWorkflow(meta, graph())
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(e).toBeInstanceOf(WorkflowConfigError)
      expect(msg).toContain('passthrough')
      expect(msg).toContain('78')
      // The available ids, with their class types, so the fix is obvious.
      expect(msg).toContain('1')
      expect(msg).toContain('LoadImage')
      expect(msg).toContain('KSampler')
    }
  })

  it('lists the available input names when the node lacks the target input', () => {
    const g = graph()
    g['3'] = { class_type: 'KSampler', inputs: { steps: 4 } }
    try {
      validateWorkflow(META, g)
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('seed')
      expect(msg).toContain('steps')
    }
  })

  it('rejects an input driven by a link, naming the node to point at instead', () => {
    // Writing a scalar over ["10", 0] would silently break the graph.
    const g = graph()
    g['3']!.inputs['seed'] = ['10', 0]
    try {
      validateWorkflow(META, g)
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toMatch(/link/i)
      expect(msg).toContain('10')
      expect(msg).toContain('seedNode')
    }
  })

  it('detects a UI-format export and names the right menu item', () => {
    const ui = { nodes: [{ id: 1, type: 'LoadImage' }], links: [] } as unknown as ApiGraph
    try {
      validateWorkflow(META, ui)
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toMatch(/UI-format|UI format/)
      expect(msg).toContain('Export (API)')
    }
  })

  it('accepts a graph whose declared LoRA slots all exist', () => {
    expect(() => validateWorkflow(LORA_META, loraGraph())).not.toThrow()
  })

  it('names a missing LoRA node and points at loraNodes', () => {
    try {
      validateWorkflow({ ...LORA_META, loraNodes: ['5', '99'] }, loraGraph())
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(e).toBeInstanceOf(WorkflowConfigError)
      expect(msg).toContain('99')
      expect(msg).toContain('loraNodes')
      // Never the field name that does not exist in the manifest.
      expect(msg).not.toContain('loraNameNode')
    }
  })

  it('rejects a LoRA node that has no strength input, listing what it does have', () => {
    const g = loraGraph()
    g['5'] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'x.safetensors' } }
    try {
      validateWorkflow(LORA_META, g)
      throw new Error('should have thrown')
    } catch (e) {
      const msg = (e as Error).message
      expect(msg).toContain('strength_model')
      expect(msg).toContain('lora_name')
      expect(msg).toContain('loraStrengthInput')
    }
  })
})

describe('patchWorkflow', () => {
  const args = { imageFilename: 'upload-1.png', prompt: 'make it magenta', seed: 4242 }

  it('injects the image, prompt and seed at the declared nodes', () => {
    const out = patchWorkflow(graph(), META, args)
    expect(out['1']!.inputs['image']).toBe('upload-1.png')
    expect(out['2']!.inputs['text']).toBe('make it magenta')
    expect(out['3']!.inputs['seed']).toBe(4242)
  })

  it('does not mutate the input graph, so consecutive runs cannot accumulate state', () => {
    const original = graph()
    patchWorkflow(original, META, args)
    expect(original['1']!.inputs['image']).toBe('PLACEHOLDER.png')
    expect(original['2']!.inputs['text']).toBe('')
    expect(original['3']!.inputs['seed']).toBe(0)
  })

  it('leaves every other input untouched', () => {
    const out = patchWorkflow(graph(), META, args)
    expect(out['3']!.inputs['steps']).toBe(4)
    expect(out['4']!.inputs['ckpt_name']).toBe('x.safetensors')
    expect(out['2']!.inputs['clip']).toEqual(['4', 0])
  })

  it('resolves the default input name for prompt via text', () => {
    const g = graph()
    g['2'] = { class_type: 'TextEncodeQwenImageEditPlus', inputs: { prompt: '' } }
    const out = patchWorkflow(g, META, args)
    expect(out['2']!.inputs['prompt']).toBe('make it magenta')
  })

  it('resolves the default input name for seed via noise_seed', () => {
    const g = graph()
    g['3'] = { class_type: 'SamplerCustom', inputs: { noise_seed: 0 } }
    const out = patchWorkflow(g, META, args)
    expect(out['3']!.inputs['noise_seed']).toBe(4242)
  })

  it('honours explicit input overrides from the manifest', () => {
    const g = graph()
    g['3']!.inputs['custom_seed'] = 0
    const out = patchWorkflow(g, { ...META, seedInput: 'custom_seed' }, args)
    expect(out['3']!.inputs['custom_seed']).toBe(4242)
    expect(out['3']!.inputs['seed']).toBe(0)
  })

  it('refuses to create an input key that does not already exist', () => {
    // The rule that turns a wrong node id into a loud error rather than a silent
    // no-op that returns an unedited image.
    const g = graph()
    g['3'] = { class_type: 'KSampler', inputs: { steps: 4 } }
    expect(() => patchWorkflow(g, META, args)).toThrow(WorkflowConfigError)
  })

  it('refuses to overwrite a linked input', () => {
    const g = graph()
    g['3']!.inputs['seed'] = ['10', 0]
    expect(() => patchWorkflow(g, META, args)).toThrow(WorkflowConfigError)
  })

  describe('LoRA slots', () => {
    const sel = (file: string, strength: number): LoraSelection => ({ file, strength })

    it('writes the file and strength of a selected slot', () => {
      const out = patchWorkflow(loraGraph(), LORA_META, {
        ...args,
        loras: [sel('darkbrush.safetensors', 0.8), null, null],
      })
      expect(out['5']!.inputs['lora_name']).toBe('darkbrush.safetensors')
      expect(out['5']!.inputs['strength_model']).toBe(0.8)
    })

    it('disables an empty slot with strength 0 but leaves lora_name alone', () => {
      // The baked-in name is known to exist on the server; ComfyUI rejects an
      // unknown lora_name with "value not in list" even at strength 0.
      const out = patchWorkflow(loraGraph(), LORA_META, { ...args, loras: [null, null, null] })
      for (const id of ['5', '6', '7']) {
        expect(out[id]!.inputs['strength_model']).toBe(0)
        expect(out[id]!.inputs['lora_name']).toBe('baked-in.safetensors')
      }
    })

    it('fills each declared slot by index, independently', () => {
      const out = patchWorkflow(loraGraph(), LORA_META, {
        ...args,
        loras: [null, sel('b.safetensors', 1), sel('c.safetensors', 0.25)],
      })
      expect(out['5']!.inputs['strength_model']).toBe(0)
      expect(out['6']!.inputs['lora_name']).toBe('b.safetensors')
      expect(out['7']!.inputs['strength_model']).toBe(0.25)
    })

    it('disables every declared slot when no selections are passed at all', () => {
      const out = patchWorkflow(loraGraph(), LORA_META, args)
      expect(out['5']!.inputs['strength_model']).toBe(0)
      expect(out['7']!.inputs['strength_model']).toBe(0)
    })

    it('ignores selections beyond the declared slots', () => {
      const out = patchWorkflow(loraGraph(), { ...LORA_META, loraNodes: ['5'] }, {
        ...args,
        loras: [sel('a.safetensors', 1), sel('b.safetensors', 1), sel('c.safetensors', 1)],
      })
      expect(out['5']!.inputs['lora_name']).toBe('a.safetensors')
      // Nodes the manifest never declared are left exactly as authored.
      expect(out['6']!.inputs['lora_name']).toBe('baked-in.safetensors')
      expect(out['6']!.inputs['strength_model']).toBe(0)
    })

    it('leaves the chain links untouched, so the graph still runs', () => {
      const out = patchWorkflow(loraGraph(), LORA_META, {
        ...args,
        loras: [sel('a.safetensors', 1), null, null],
      })
      expect(out['5']!.inputs['model']).toEqual(['4', 0])
      expect(out['6']!.inputs['model']).toEqual(['5', 0])
      expect(out['7']!.inputs['model']).toEqual(['6', 0])
    })

    it('does not mutate the input graph', () => {
      const original = loraGraph()
      patchWorkflow(original, LORA_META, { ...args, loras: [sel('a.safetensors', 1), null, null] })
      expect(original['5']!.inputs['lora_name']).toBe('baked-in.safetensors')
      expect(original['5']!.inputs['strength_model']).toBe(0)
    })

    it('patches a workflow with no loraNodes exactly as it did before', () => {
      const out = patchWorkflow(graph(), META, { ...args, loras: [sel('a.safetensors', 1)] })
      expect(out['1']!.inputs['image']).toBe('upload-1.png')
      expect(out['2']!.inputs['text']).toBe('make it magenta')
      expect(out['3']!.inputs['seed']).toBe(4242)
      expect(Object.keys(out)).toEqual(['1', '2', '3', '4'])
    })
  })
})

describe('randomSeed', () => {
  it('uses the injected generator, so tests are deterministic', () => {
    expect(randomSeed(() => 0)).toBe(0)
    expect(randomSeed(() => 0.5)).toBeGreaterThan(0)
  })

  it('stays within a safe integer range', () => {
    for (const r of [0, 0.25, 0.5, 0.999999]) {
      const s = randomSeed(() => r)
      expect(Number.isSafeInteger(s)).toBe(true)
      expect(s).toBeGreaterThanOrEqual(0)
    }
  })
})

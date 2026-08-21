import { test, expect } from '@playwright/test'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { T } from '../../src/testids'
import { loadFixture, queuedGraphs, resetFake, runTransformFlow } from './helpers'

/**
 * Optional LoRA slots, end to end: the selection the user makes must arrive in the
 * graph ComfyUI is actually handed. Asserting the queued graph rather than the
 * pixels is the point — a LoRA that silently fails to apply produces a perfectly
 * plausible image, which is exactly the failure mode this has to rule out.
 *
 * The shipped graphs (qwen-2511, krea2-refine) carry real LoRA slots but need a
 * GPU. So this builds a throwaway workflow out of passthrough plus three
 * LoraLoaderModelOnly nodes, the same configuration-only pattern
 * workflow-config.spec.ts uses, and restores every file afterwards.
 */

const WORKFLOWS = fileURLToPath(new URL('../../public/workflows/', import.meta.url))
const MANIFEST = `${WORKFLOWS}manifest.json`
const LORAS = `${WORKFLOWS}loras.json`
const ADDED_GRAPH = `${WORKFLOWS}lora-test.api.json`

const SLOT_NODES = ['60', '61', '62']
const BAKED_IN = 'baked-in.safetensors'

test.describe('LoRA slots', () => {
  let originalManifest: string
  let originalLoras: string

  test.beforeAll(() => {
    originalManifest = readFileSync(MANIFEST, 'utf8')
    originalLoras = readFileSync(LORAS, 'utf8')

    // passthrough, plus three LoRA loaders chained off the checkpoint. Disabled
    // at strength 0, exactly as the real graphs ship them.
    const graph = JSON.parse(readFileSync(`${WORKFLOWS}passthrough.api.json`, 'utf8'))
    SLOT_NODES.forEach((id, i) => {
      graph[id] = {
        class_type: 'LoraLoaderModelOnly',
        inputs: {
          lora_name: BAKED_IN,
          strength_model: 0,
          model: [i === 0 ? '4' : SLOT_NODES[i - 1], 0],
        },
        _meta: { title: `Test LoRA ${i + 1}` },
      }
    })
    graph['3'].inputs.model = ['62', 0]
    writeFileSync(ADDED_GRAPH, `${JSON.stringify(graph, null, 2)}\n`)

    const manifest = JSON.parse(originalManifest)
    manifest.workflows.push({
      id: 'lora-test',
      label: 'LoRA Test',
      file: 'lora-test.api.json',
      imageNode: '1',
      promptNode: '2',
      seedNode: '3',
      loraNodes: SLOT_NODES,
    })
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)

    writeFileSync(
      LORAS,
      `${JSON.stringify(
        {
          loras: [
            { id: 'alpha', label: 'Alpha', file: 'alpha.safetensors', workflows: ['lora-test'] },
            {
              id: 'beta',
              label: 'Beta',
              file: 'beta.safetensors',
              workflows: ['lora-test'],
              strength: 0.4,
            },
            { id: 'everywhere', label: 'Everywhere', file: 'everywhere.safetensors' },
            { id: 'elsewhere', label: 'Elsewhere', file: 'elsewhere.safetensors', workflows: ['qwen-2511'] },
          ],
        },
        null,
        2,
      )}\n`,
    )
  })

  test.afterAll(() => {
    writeFileSync(MANIFEST, originalManifest)
    writeFileSync(LORAS, originalLoras)
    rmSync(ADDED_GRAPH, { force: true })
  })

  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)
  })

  test('a workflow with no declared slots shows no LoRA controls', async ({ page }) => {
    await page.getByTestId(T.workflowSelect).selectOption('passthrough')
    await expect(page.getByTestId(T.loraSlot)).toHaveCount(0)
  })

  test('a workflow declaring slots shows one control per slot, empty by default', async ({
    page,
  }) => {
    await page.getByTestId(T.workflowSelect).selectOption('lora-test')
    await expect(page.getByTestId(T.loraSlot)).toHaveCount(3)

    for (let slot = 0; slot < 3; slot++) {
      await expect(page.getByTestId(T.loraSelect).nth(slot)).toHaveValue('')
      // Strength is inert until a LoRA is chosen; nothing can be dialled up by accident.
      await expect(page.getByTestId(T.loraStrength).nth(slot)).toBeDisabled()
    }
  })

  test('slots offer only the LoRAs allowed for this workflow', async ({ page }) => {
    await page.getByTestId(T.workflowSelect).selectOption('lora-test')

    const options = await page.getByTestId(T.loraSelect).first().locator('option').allTextContents()
    // "Everywhere" declares no allowlist, so it is offered here too; "Elsewhere"
    // is scoped to another workflow and must not appear.
    expect(options).toEqual(['None', 'Alpha', 'Beta', 'Everywhere'])
  })

  test('selecting a LoRA seeds its strength from the catalog', async ({ page }) => {
    await page.getByTestId(T.workflowSelect).selectOption('lora-test')

    // "alpha" declares no strength, so it starts at full.
    await page.getByTestId(T.loraSelect).first().selectOption('alpha')
    await expect(page.getByTestId(T.loraStrength).first()).toHaveAttribute('data-value', '1')
    await expect(page.getByTestId(T.loraStrength).first()).toBeEnabled()

    // "beta" declares 0.4.
    await page.getByTestId(T.loraSelect).first().selectOption('beta')
    await expect(page.getByTestId(T.loraStrength).first()).toHaveAttribute('data-value', '0.4')
  })

  test('the chosen LoRA and strength reach the queued graph', async ({ page, request }) => {
    await page.getByTestId(T.workflowSelect).selectOption('lora-test')
    await page.getByTestId(T.loraSelect).first().selectOption('alpha')
    await page.getByTestId(T.loraStrength).first().fill('0.65')
    await page.getByTestId(T.loraSelect).nth(2).selectOption('everywhere')

    await runTransformFlow(page, { workflow: 'lora-test', prompt: 'with a lora' })

    const [queued] = await queuedGraphs(request)
    const graph = queued!.graph

    expect(graph['60']!.inputs['lora_name']).toBe('alpha.safetensors')
    expect(graph['60']!.inputs['strength_model']).toBe(0.65)

    expect(graph['62']!.inputs['lora_name']).toBe('everywhere.safetensors')
    expect(graph['62']!.inputs['strength_model']).toBe(1)

    // The untouched slot is switched off by strength, not by unlinking — and its
    // authored lora_name survives, because ComfyUI validates that name against
    // the files on disk even at strength 0.
    expect(graph['61']!.inputs['strength_model']).toBe(0)
    expect(graph['61']!.inputs['lora_name']).toBe(BAKED_IN)

    // The model chain is intact, so the graph still runs.
    expect(graph['61']!.inputs['model']).toEqual(['60', 0])
  })

  test('every slot is disabled when the user picks nothing', async ({ page, request }) => {
    await runTransformFlow(page, { workflow: 'lora-test', prompt: 'no loras' })

    const [queued] = await queuedGraphs(request)
    for (const id of SLOT_NODES) {
      expect(queued!.graph[id]!.inputs['strength_model']).toBe(0)
      expect(queued!.graph[id]!.inputs['lora_name']).toBe(BAKED_IN)
    }
  })

  test('switching workflow clears the slots, so no incompatible LoRA carries over', async ({
    page,
  }) => {
    await page.getByTestId(T.workflowSelect).selectOption('lora-test')
    await page.getByTestId(T.loraSelect).first().selectOption('alpha')
    await expect(page.getByTestId(T.loraSelect).first()).toHaveValue('alpha')

    await page.getByTestId(T.workflowSelect).selectOption('passthrough')
    await page.getByTestId(T.workflowSelect).selectOption('lora-test')

    await expect(page.getByTestId(T.loraSelect).first()).toHaveValue('')
  })
})

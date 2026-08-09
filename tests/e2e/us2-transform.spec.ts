import { test, expect } from '@playwright/test'
import { T } from '../../src/testids'
import {
  advanceFake,
  canvasHash,
  centerPixel,
  configureFake,
  drawDrag,
  loadFixture,
  MAGENTA,
  queuedGraphs,
  resetFake,
  runTransformFlow,
  TEAL,
} from './helpers'

test.describe('US2: transform the marked-up image', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)
  })

  test('AS1: the dropdown offers every configured workflow', async ({ page }) => {
    const options = await page.getByTestId(T.workflowSelect).locator('option').allTextContents()
    expect(options).toContain('Passthrough (test)')
  })

  test('AS2: running replaces the workspace image with the result', async ({ page }) => {
    expect(await centerPixel(page)).toEqual(TEAL)

    await runTransformFlow(page)

    expect(await centerPixel(page)).toEqual(MAGENTA)
  })

  test('AS2: the marked-up image is what gets sent', async ({ page, request }) => {
    await page.getByTestId(T.toolRect).click()
    await page.getByTestId(T.colorPicker).fill('#ff0000')
    await drawDrag(page, { x: 40, y: 40 }, { x: 200, y: 200 })

    await runTransformFlow(page, { prompt: 'first run' })

    // The fake rejects a graph referencing an image it never received, so a
    // successful run already proves the composite was uploaded and patched in.
    const graphs = await queuedGraphs(request)
    expect(graphs).toHaveLength(1)
    expect(graphs[0]!.graph['2']!.inputs['text']).toBe('first run')
  })

  test('AS3: a second run starts from the first result', async ({ page, request }) => {
    await runTransformFlow(page, { prompt: 'first' })
    expect(await centerPixel(page)).toEqual(MAGENTA)

    // Marks are cleared by the rebase, so undo is unavailable on the result.
    await expect(page.getByTestId(T.btnUndo)).toBeDisabled()

    await page.getByTestId(T.toolRect).click()
    await drawDrag(page, { x: 40, y: 40 }, { x: 200, y: 200 })
    await runTransformFlow(page, { prompt: 'second' })

    const graphs = await queuedGraphs(request)
    expect(graphs).toHaveLength(2)
    expect(graphs[1]!.graph['2']!.inputs['text']).toBe('second')
    expect(await centerPixel(page)).toEqual(MAGENTA)
  })

  test('AS4: a second run cannot be started while one is in progress', async ({ page, request }) => {
    await configureFake(request, { mode: 'stepped', steps: 3 })

    await page.getByTestId(T.promptInput).fill('slow one')
    await page.getByTestId(T.btnRun).click()

    // Wait until the prompt is actually queued before advancing the fake —
    // "running" is only set once POST /prompt has returned.
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'running')
    await expect(page.getByTestId(T.btnRun)).toBeDisabled()

    for (let i = 0; i < 3; i++) await advanceFake(request)
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'done')
    await expect(page.getByTestId(T.btnRun)).toBeEnabled()
  })

  test('AS5: a rejected run shows the service reason and leaves the image alone', async ({
    page,
    request,
  }) => {
    await configureFake(request, {
      rejectWith: 'value not in list: qwen_image_edit_2511_bf16.safetensors',
    })

    await page.getByTestId(T.promptInput).fill('will fail')
    await page.getByTestId(T.btnRun).click()

    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'error')
    await expect(page.getByTestId(T.runError)).toContainText('qwen_image_edit_2511_bf16.safetensors')
    expect(await centerPixel(page)).toEqual(TEAL)
  })

  test('AS5: a mid-run execution error surfaces its exception message', async ({
    page,
    request,
  }) => {
    await configureFake(request, { failWith: 'CUDA out of memory' })

    await page.getByTestId(T.promptInput).fill('will fail')
    await page.getByTestId(T.btnRun).click()

    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'error')
    await expect(page.getByTestId(T.runError)).toContainText('CUDA out of memory')
    expect(await centerPixel(page)).toEqual(TEAL)
  })

  test('AS6: an unreachable service is reported, not silently ignored', async ({ page }) => {
    await page.route('**/comfy/**', (route) => route.abort('connectionrefused'))

    await page.getByTestId(T.promptInput).fill('no service')
    await page.getByTestId(T.btnRun).click()

    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'error')
    await expect(page.getByTestId(T.runError)).toBeVisible()
    expect(await centerPixel(page)).toEqual(TEAL)
  })

  test('the legacy protocol dialect reaches the same result', async ({ page, request }) => {
    // Older ComfyUI emits `progress` and signals completion with executing{node:null}.
    await configureFake(request, { protocol: 'progress', completion: 'legacy_null' })

    await runTransformFlow(page)

    expect(await centerPixel(page)).toEqual(MAGENTA)
  })

  test('progress is reported while running', async ({ page, request }) => {
    // Stepped mode emits nothing until asked, so this assertion cannot race.
    await configureFake(request, { mode: 'stepped', steps: 4 })

    await page.getByTestId(T.promptInput).fill('watch progress')
    await page.getByTestId(T.btnRun).click()
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'running')

    await advanceFake(request)
    await expect(page.getByTestId(T.runProgress)).toHaveAttribute('data-value', '25')

    await advanceFake(request)
    await expect(page.getByTestId(T.runProgress)).toHaveAttribute('data-value', '50')

    await advanceFake(request)
    await advanceFake(request)
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'done')
  })

  test('AS7: a malformed manifest is reported at startup and blocks running', async ({ page }) => {
    // Injected over the network, so no test-only code path exists in the app.
    await page.route('**/workflows/manifest.json', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          workflows: [{ id: 'broken', label: 'Broken', file: 'passthrough.api.json', imageNode: '999', promptNode: '2', seedNode: '3' }],
        }),
      }),
    )
    await page.reload()

    await expect(page.getByTestId(T.workflowError)).toBeVisible()
    await expect(page.getByTestId(T.workflowError)).toContainText('broken')
    await expect(page.getByTestId(T.workflowError)).toContainText('999')
    await expect(page.getByTestId(T.btnRun)).toBeDisabled()
  })

  test('AS7: unparseable manifest JSON is reported at startup', async ({ page }) => {
    await page.route('**/workflows/manifest.json', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '{ not json' }),
    )
    await page.reload()

    await expect(page.getByTestId(T.workflowError)).toBeVisible()
    await expect(page.getByTestId(T.btnRun)).toBeDisabled()
  })

  test('FR-026: a run that never completes times out and leaves the image alone', async ({
    page,
    request,
  }) => {
    await configureFake(request, { mode: 'stepped', neverComplete: true })

    await page.getByTestId(T.promptInput).fill('never finishes')
    await page.getByTestId(T.btnRun).click()

    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'error', {
      timeout: 20_000,
    })
    await expect(page.getByTestId(T.runError)).toContainText(/timed out/i)
    expect(await centerPixel(page)).toEqual(TEAL)
  })

  test('FR-027: the run still completes when the progress channel drops', async ({
    page,
    request,
  }) => {
    // The direct proof that /history polling is the authority and the socket is
    // cosmetic — the whole reason the runner races them instead of trusting the WS.
    await configureFake(request, { dropWsAfter: 2 })

    await runTransformFlow(page, { prompt: 'socket dies mid-run' })

    expect(await centerPixel(page)).toEqual(MAGENTA)
  })

  test('FR-028: seeds vary between runs, and are held when locked', async ({ page, request }) => {
    await runTransformFlow(page, { prompt: 'a' })
    await runTransformFlow(page, { prompt: 'b' })

    const unlocked = (await queuedGraphs(request)).map((g) => g.graph['3']!.inputs['seed'])
    expect(unlocked).toHaveLength(2)
    expect(unlocked[0]).not.toEqual(unlocked[1])

    await page.getByTestId(T.seedLock).check()
    await runTransformFlow(page, { prompt: 'c' })
    await runTransformFlow(page, { prompt: 'd' })

    const all = (await queuedGraphs(request)).map((g) => g.graph['3']!.inputs['seed'])
    expect(all).toHaveLength(4)
    expect(all[2]).toEqual(all[3])
  })

  test('@live transforms against a real ComfyUI', async ({ page }) => {
    test.skip(!process.env.COMFY_LIVE, 'set COMFY_LIVE=1 with a tunnel open')
    test.setTimeout(240_000)

    const before = await canvasHash(page)
    await runTransformFlow(page, {
      workflow: process.env.COMFY_LIVE_WORKFLOW ?? 'qwen-2511',
      prompt: 'make the sky purple',
      timeout: 180_000,
    })
    // No exact color: a real model's output is not deterministic.
    expect(await canvasHash(page)).not.toEqual(before)
  })
})

import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { T } from '../../src/testids'

export const FAKE = 'http://127.0.0.1:8199'

export const FIXTURE = fileURLToPath(new URL('../fixtures/base.png', import.meta.url))
export const NOT_AN_IMAGE = fileURLToPath(new URL('../fixtures/not-an-image.txt', import.meta.url))

export const TEAL: [number, number, number] = [0, 128, 128]
export const MAGENTA: [number, number, number] = [255, 0, 255]

/** In @live runs the fake is not started at all, so its control plane is absent. */
export const LIVE = !!process.env.COMFY_LIVE

export async function resetFake(request: APIRequestContext): Promise<void> {
  if (LIVE) return
  await request.post(`${FAKE}/__test/reset`)
}

export async function configureFake(
  request: APIRequestContext,
  cfg: Record<string, unknown>,
): Promise<void> {
  if (LIVE) return
  await request.post(`${FAKE}/__test/config`, { data: cfg })
}

export async function advanceFake(request: APIRequestContext): Promise<void> {
  await request.post(`${FAKE}/__test/advance`)
}

export async function queuedGraphs(
  request: APIRequestContext,
): Promise<Array<{ promptId: string; graph: Record<string, { inputs: Record<string, unknown> }> }>> {
  const res = await request.get(`${FAKE}/__test/queued`)
  return (await res.json()).queued
}

export async function loadFixture(page: Page, file = FIXTURE): Promise<void> {
  await page.getByTestId(T.fileInput).setInputFiles(file)
}

/** Read one pixel out of the canvas backing store. Requires same-origin images. */
export async function pixelAt(page: Page, x: number, y: number): Promise<number[]> {
  return page.evaluate(
    ([px, py, id]) => {
      const c = document.querySelector(`[data-testid="${id}"]`) as HTMLCanvasElement
      const d = c.getContext('2d')!.getImageData(px as number, py as number, 1, 1).data
      return [d[0]!, d[1]!, d[2]!]
    },
    [x, y, T.editorCanvas] as const,
  )
}

export async function centerPixel(page: Page): Promise<number[]> {
  return page.evaluate((id) => {
    const c = document.querySelector(`[data-testid="${id}"]`) as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data
    return [d[0]!, d[1]!, d[2]!]
  }, T.editorCanvas)
}

/** A cheap content hash, for asserting "the image changed" without asserting a color. */
export async function canvasHash(page: Page): Promise<string> {
  return page.evaluate((id) => {
    const c = document.querySelector(`[data-testid="${id}"]`) as HTMLCanvasElement
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let h = 2166136261
    for (let i = 0; i < d.length; i += 997) {
      h ^= d[i]!
      h = Math.imul(h, 16777619)
    }
    return `${c.width}x${c.height}:${h >>> 0}`
  }, T.editorCanvas)
}

/** Drag on the canvas in canvas-pixel coordinates. */
export async function drawDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const canvas = page.getByTestId(T.editorCanvas)
  const box = (await canvas.boundingBox())!
  const scale = await page.evaluate((id) => {
    const c = document.querySelector(`[data-testid="${id}"]`) as HTMLCanvasElement
    return c.getBoundingClientRect().width / c.width
  }, T.editorCanvas)

  await page.mouse.move(box.x + from.x * scale, box.y + from.y * scale)
  await page.mouse.down()
  // Two intermediate moves so freehand strokes get more than one point.
  await page.mouse.move(box.x + ((from.x + to.x) / 2) * scale, box.y + ((from.y + to.y) / 2) * scale)
  await page.mouse.move(box.x + to.x * scale, box.y + to.y * scale)
  await page.mouse.up()
}

/** Click one canvas pixel, in canvas-pixel coordinates. */
export async function clickCanvasAt(page: Page, at: { x: number; y: number }): Promise<void> {
  const canvas = page.getByTestId(T.editorCanvas)
  const box = (await canvas.boundingBox())!
  const scale = await page.evaluate((id) => {
    const c = document.querySelector(`[data-testid="${id}"]`) as HTMLCanvasElement
    return c.getBoundingClientRect().width / c.width
  }, T.editorCanvas)

  await page.mouse.click(box.x + at.x * scale, box.y + at.y * scale)
}

export type TransformOpts = {
  workflow?: string
  prompt?: string
  timeout?: number
  /** Leave unset for a single run, which is the default the control starts on. */
  count?: number
  mode?: 'variations' | 'serial'
}

/**
 * The shared transformation flow. Used by both the offline specs and the @live
 * variant, so the two can never drift apart.
 */
export async function runTransformFlow(page: Page, opts: TransformOpts = {}): Promise<void> {
  const { workflow = 'passthrough', prompt = 'make it magenta', timeout = 15_000, count, mode } = opts
  const runs = count ?? 1
  const status = page.getByTestId(T.runStatus)

  // Waiting on data-phase alone is not enough: after a previous run it already
  // reads "done", so the wait would return before this run had even queued.
  // data-run-seq increments when a run starts, which distinguishes the two.
  const before = Number((await status.getAttribute('data-run-seq')) ?? '0')

  await page.getByTestId(T.workflowSelect).selectOption(workflow)
  await page.getByTestId(T.promptInput).fill(prompt)
  if (count !== undefined) await page.getByTestId(T.runCount).selectOption(String(count))
  if (mode) await page.getByTestId(T.runMode).selectOption(mode)
  await page.getByTestId(T.btnRun).click()

  // Every run in the batch bumps the sequence, so this waits for the last one to
  // have started; data-batch-total returning to 0 is what says the batch is over.
  await expect(status).toHaveAttribute('data-run-seq', String(before + runs), {
    timeout: timeout * runs,
  })
  await expect(status).toHaveAttribute('data-batch-total', '0', { timeout })
  await expect(status).toHaveAttribute('data-phase', 'done', { timeout })
}

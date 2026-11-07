import { test, expect, type Page } from '@playwright/test'
import { T } from '../../src/testids'
import {
  advanceFake,
  configureFake,
  loadFixture,
  queuedGraphs,
  resetFake,
  runTransformFlow,
  TEAL,
  MAGENTA,
  centerPixel,
} from './helpers'

/**
 * R9: a run belongs to the image it started on. The rest of the editor must not be
 * able to lose paid GPU output or newer work while a run is in flight.
 */

const STEPS = 4

async function historyCount(page: Page): Promise<number> {
  return page.getByTestId(T.historyEntry).count()
}

/** Finish the job the fake is holding, and wait for the batch to be over. */
async function finishRun(page: Page, request: Parameters<typeof advanceFake>[0]): Promise<void> {
  for (let i = 0; i < STEPS; i++) await advanceFake(request)
  await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-batch-total', '0', {
    timeout: 15_000,
  })
}

test.describe('R9: lock and deadline', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)
    await expect(page.getByTestId(T.editorCanvas)).toBeVisible()
  })

  test('double-clicking Run queues one job and adds one history entry', async ({
    page,
    request,
  }) => {
    await configureFake(request, { mode: 'stepped' })

    await page.getByTestId(T.promptInput).fill('once')
    await page.getByTestId(T.btnRun).dblclick()

    await expect.poll(async () => (await queuedGraphs(request)).length).toBeGreaterThan(0)
    // Long enough for a second run's upload and queue to reach the fake.
    await page.waitForTimeout(500)
    const queuedMidRun = (await queuedGraphs(request)).length

    // Two jobs on base, so finish both before reading the history it left behind.
    for (let job = 0; job < queuedMidRun; job++) await finishRun(page, request)
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'done', {
      timeout: 15_000,
    })

    expect(queuedMidRun).toBe(1)
    expect(await historyCount(page)).toBe(2)
  })

  for (const stall of ['/history', '/upload/image', '/view']) {
    test(`a connection stalled on ${stall} ends past the deadline in a visible error, with Run enabled and no reload`, async ({
      page,
      request,
    }) => {
      await configureFake(request, { stall })
      await page.evaluate(() => {
        ;(window as unknown as { notReloaded: boolean }).notReloaded = true
      })

      await page.getByTestId(T.promptInput).fill('stalls')
      await page.getByTestId(T.btnRun).click()

      // VITE_RUN_TIMEOUT_MS is 8s in playwright.config.ts.
      await expect(page.getByTestId(T.runError)).toContainText(/timed out/i, { timeout: 20_000 })
      await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'error')
      await expect(page.getByTestId(T.btnRun)).toBeEnabled()
      expect(await centerPixel(page)).toEqual(TEAL)
      expect(
        await page.evaluate(() => (window as unknown as { notReloaded?: boolean }).notReloaded),
      ).toBe(true)

      // Recovered, not just unstuck: the next run works without a reload.
      await configureFake(request, { stall: null })
      await runTransformFlow(page)
      expect(await centerPixel(page)).toEqual(MAGENTA)
    })
  }
})


import { test, expect, type Page } from '@playwright/test'
import { T } from '../../src/testids'
import {
  advanceFake,
  configureFake,
  loadFixture,
  queuedGraphs,
  resetFake,
  runTransformFlow,
} from './helpers'

/**
 * Running the workflow more than once, in the two modes that differ in what each
 * repeat consumes:
 *
 * - variations — every run is handed the same image; the results are siblings
 * - serial     — each result feeds the next; the results are a chain
 *
 * The fake returns the same magenta image for every run, so the pixels cannot tell
 * the modes apart. The parent links in the history strip and the seeds in the
 * queued graphs can, and those are what the modes actually change.
 */

const entries = (page: Page) => page.getByTestId(T.historyEntry)

const parentIds = async (page: Page): Promise<(string | null)[]> =>
  entries(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-parent-id')))

const entryIds = async (page: Page): Promise<(string | null)[]> =>
  entries(page).evaluateAll((els) => els.map((e) => e.getAttribute('data-entry-id')))

test.describe('running a workflow several times', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)
  })

  test('defaults to a single run, with no repeat mode to choose', async ({ page }) => {
    await expect(page.getByTestId(T.runCount)).toHaveValue('1')
    // Asking how to repeat something that happens once would be noise.
    await expect(page.getByTestId(T.runMode)).toHaveCount(0)

    await page.getByTestId(T.runCount).selectOption('3')
    await expect(page.getByTestId(T.runMode)).toBeVisible()
  })

  test('a count of 4 queues four runs and produces four images', async ({ page, request }) => {
    await runTransformFlow(page, { prompt: 'four of them', count: 4 })

    expect(await queuedGraphs(request)).toHaveLength(4)
    // The uploaded original plus one entry per run.
    await expect(entries(page)).toHaveCount(5)
  })

  test('every run gets its own seed, so none of them is a cache hit', async ({ page, request }) => {
    await runTransformFlow(page, { prompt: 'distinct seeds', count: 4 })

    const seeds = (await queuedGraphs(request)).map((q) => q.graph['3']!.inputs['seed'])
    expect(seeds).toHaveLength(4)
    expect(new Set(seeds).size).toBe(4)
  })

  test('a locked seed walks upward, so the batch is reproducible but not repetitive', async ({
    page,
    request,
  }) => {
    await page.getByTestId(T.seedInput).fill('5000')
    await page.getByTestId(T.seedLock).check()

    await runTransformFlow(page, { prompt: 'locked batch', count: 3 })

    const seeds = (await queuedGraphs(request)).map((q) => q.graph['3']!.inputs['seed'])
    expect(seeds).toEqual([5000, 5001, 5002])
  })

  test('variations all hang off the image the batch started from', async ({ page }) => {
    const [originalId] = await entryIds(page)

    await runTransformFlow(page, { prompt: 'siblings', count: 3, mode: 'variations' })

    await expect(entries(page)).toHaveCount(4)
    const parents = await parentIds(page)
    // Entry 0 is the upload; the three results are siblings of it.
    expect(parents.slice(1)).toEqual([originalId, originalId, originalId])
  })

  test('a serial run chains each result to the one before it', async ({ page }) => {
    const [originalId] = await entryIds(page)

    await runTransformFlow(page, { prompt: 'a chain', count: 3, mode: 'serial' })

    const ids = await entryIds(page)
    const parents = await parentIds(page)
    expect(parents.slice(1)).toEqual([originalId, ids[1], ids[2]])
  })

  test('the last result is the one left in the workspace', async ({ page }) => {
    await runTransformFlow(page, { prompt: 'last wins', count: 3 })

    await expect(entries(page).nth(3)).toHaveAttribute('data-selected', 'true')
    await expect(entries(page).nth(2)).toHaveAttribute('data-selected', 'false')
  })

  test('the batch position is reported while it runs', async ({ page, request }) => {
    // Stepped, so each run is held open and the counter can actually be observed;
    // against the instant fake the whole batch can finish between assertions.
    await configureFake(request, { mode: 'stepped', steps: 2 })
    const status = page.getByTestId(T.runStatus)
    await expect(status).toHaveAttribute('data-batch-total', '0')

    await page.getByTestId(T.promptInput).fill('watch the counter')
    await page.getByTestId(T.runCount).selectOption('3')
    await page.getByTestId(T.btnRun).click()

    for (let run = 1; run <= 3; run++) {
      // The index moves first, at runStarted; the phase follows once queued.
      await expect(status).toHaveAttribute('data-batch-index', String(run), { timeout: 15_000 })
      await expect(status).toHaveAttribute('data-batch-total', '3')
      await expect(status).toHaveAttribute('data-phase', 'running', { timeout: 15_000 })
      // Run stays unavailable for the whole batch, not just the run in flight.
      await expect(page.getByTestId(T.btnRun)).toBeDisabled()

      for (let step = 0; step < 2; step++) await advanceFake(request)
    }

    await expect(status).toHaveAttribute('data-batch-total', '0', { timeout: 15_000 })
    await expect(status).toHaveAttribute('data-batch-index', '0')
    await expect(page.getByTestId(T.btnRun)).toBeEnabled()
  })

  test('a failure stops the batch but keeps the runs that already succeeded', async ({
    page,
    request,
  }) => {
    // Two clean runs, then the service rejects — the third and fourth never queue.
    await runTransformFlow(page, { prompt: 'first batch', count: 2 })
    await expect(entries(page)).toHaveCount(3)

    await configureFake(request, { rejectWith: 'value not in list: missing.safetensors' })

    await page.getByTestId(T.runCount).selectOption('4')
    await page.getByTestId(T.btnRun).click()

    await expect(page.getByTestId(T.runError)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-batch-total', '0')
    // Nothing new was adopted, and the two earlier results were not discarded.
    await expect(entries(page)).toHaveCount(3)
    await expect(page.getByTestId(T.btnRun)).toBeEnabled()
  })
})

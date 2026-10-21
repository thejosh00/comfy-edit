import { test, expect } from '@playwright/test'
import { T } from '../../src/testids'
import { advanceFake, configureFake, loadFixture, resetFake } from './helpers'

/**
 * The browser tab carries the run's progress, the way ComfyUI's own tab does, so a
 * run can be watched from another tab. Stepped mode holds each step until asked,
 * so every intermediate title can be asserted without racing.
 */
test.describe('tab title', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)
  })

  test('shows progress while a run is in flight and is restored after', async ({
    page,
    request,
  }) => {
    await configureFake(request, { mode: 'stepped', steps: 4 })
    await expect(page).toHaveTitle('comfy-edit')

    await page.getByTestId(T.promptInput).fill('watch the tab')
    await page.getByTestId(T.btnRun).click()
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'running')
    await expect(page).toHaveTitle('[0%] comfy-edit')

    await advanceFake(request)
    await expect(page).toHaveTitle('[25%] comfy-edit')

    await advanceFake(request)
    await expect(page).toHaveTitle('[50%] comfy-edit')

    await advanceFake(request)
    await advanceFake(request)
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'done')
    await expect(page).toHaveTitle('comfy-edit')
  })

  test('is restored when the run fails', async ({ page, request }) => {
    await configureFake(request, { mode: 'stepped', steps: 4, failWith: 'CUDA out of memory' })

    await page.getByTestId(T.promptInput).fill('will fail')
    await page.getByTestId(T.btnRun).click()
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'running')
    await expect(page).toHaveTitle('[0%] comfy-edit')

    await advanceFake(request)
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'error')
    await expect(page).toHaveTitle('comfy-edit')
  })

  test('carries the batch position when Run repeats', async ({ page, request }) => {
    await configureFake(request, { mode: 'stepped', steps: 2 })
    const status = page.getByTestId(T.runStatus)

    await page.getByTestId(T.promptInput).fill('watch the counter')
    await page.getByTestId(T.runCount).selectOption('2')
    await page.getByTestId(T.btnRun).click()

    for (let run = 1; run <= 2; run++) {
      await expect(status).toHaveAttribute('data-batch-index', String(run), { timeout: 15_000 })
      await expect(status).toHaveAttribute('data-phase', 'running', { timeout: 15_000 })
      await advanceFake(request)
      await expect(page).toHaveTitle(`[50%][${run}/2] comfy-edit`)
      await advanceFake(request)
    }

    await expect(status).toHaveAttribute('data-batch-total', '0', { timeout: 15_000 })
    await expect(page).toHaveTitle('comfy-edit')
  })
})

import { test, expect, type Page } from '@playwright/test'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { T } from '../../src/testids'
import {
  advanceFake,
  canvasHash,
  configureFake,
  drawDrag,
  interruptsSeen,
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
const OTHER_IMAGE = fileURLToPath(new URL('../fixtures/gallery/blue.png', import.meta.url))

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


/** Dispatch a real paste event carrying a small image, as AS2 in us1-drawing does. */
async function pasteImage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 64
    canvas.height = 64
    canvas.getContext('2d')!.fillRect(0, 0, 64, 64)
    const blob = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'))
    const dt = new DataTransfer()
    dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }))
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
  })
}

async function parentsMissing(page: Page): Promise<string[]> {
  return page.getByTestId(T.historyEntry).evaluateAll((els) => {
    const ids = new Set(els.map((e) => e.getAttribute('data-entry-id')))
    return els
      .map((e) => e.getAttribute('data-parent-id') ?? '')
      .filter((p) => p !== '' && !ids.has(p))
  })
}

test.describe('R9: a run belongs to its image', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)
    await expect(page.getByTestId(T.editorCanvas)).toBeVisible()
    await configureFake(request, { mode: 'stepped' })
  })

  async function startRun(page: Page): Promise<void> {
    await page.getByTestId(T.promptInput).fill('owned')
    await page.getByTestId(T.btnRun).click()
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'running', {
      timeout: 15_000,
    })
  }

  const openers: Array<[string, (page: Page) => Promise<void>]> = [
    ['opening a file', (page) => loadFixture(page, OTHER_IMAGE)],
    ['pasting', pasteImage],
  ]
  for (const [name, open] of openers) {
    test(`${name} mid-run: the old result never replaces a new image`, async ({
      page,
      request,
    }) => {
      const before = await canvasHash(page)
      await startRun(page)

      await open(page)
      // Read now but asserted last, so that on base this fails on the harm itself.
      const refusedOutLoud = await page
        .getByTestId(T.runNotice)
        .waitFor({ timeout: 1000 })
        .then(() => true)
        .catch(() => false)
      const during = await canvasHash(page)

      await finishRun(page, request)

      // On base the result lands on the new image, parented to an entry that was
      // dropped from the history.
      expect(await parentsMissing(page)).toEqual([])
      expect(during).toBe(before)
      expect(await historyCount(page)).toBe(2)
      expect(await centerPixel(page)).toEqual(MAGENTA)
      expect(refusedOutLoud).toBe(true)
    })
  }

  test('selecting a history entry mid-run: the result does not land on the other image', async ({
    page,
    request,
  }) => {
    await configureFake(request, { mode: 'instant' })
    await runTransformFlow(page)
    const before = await canvasHash(page)
    await configureFake(request, { mode: 'stepped' })
    await startRun(page)

    await page.getByTestId(T.historyEntry).first().click()

    expect(await canvasHash(page)).toBe(before)
    await expect(page.getByTestId(T.runNotice)).toBeVisible()
    await finishRun(page, request)
    expect(await historyCount(page)).toBe(3)
  })

  test('drawing mid-run: no mark is silently lost', async ({ page, request }) => {
    // Through the centre of the image, so that centerPixel reads the mark itself.
    const stroke = () => drawDrag(page, { x: 100, y: 100 }, { x: 156, y: 156 })
    await startRun(page)

    await stroke()

    // A mark accepted here would be wiped when the result lands, and undo would not
    // bring it back. So it is refused, and the refusal is visible.
    expect(await centerPixel(page)).toEqual(TEAL)
    await expect(page.getByTestId(T.runNotice)).toContainText(/drawing is paused/i)
    await expect(page.getByTestId(T.btnUndo)).toBeDisabled()

    await finishRun(page, request)
    await expect(page.getByTestId(T.runNotice)).toBeHidden()
    expect(await centerPixel(page)).toEqual(MAGENTA)

    // Drawing is back as soon as the run is over.
    await stroke()
    await expect.poll(() => centerPixel(page)).toEqual([255, 0, 0])
    await expect(page.getByTestId(T.btnUndo)).toBeEnabled()
  })

  test('Cancel aborts the fetches, records /interrupt, and leaves image and history as they were', async ({
    page,
    request,
  }) => {
    const before = await canvasHash(page)
    await startRun(page)

    // Hold the next poll open, so there is a fetch in flight for Cancel to abort.
    await configureFake(request, { stall: '/history' })
    const polled = await page.waitForRequest(/\/comfy\/history\//, { timeout: 5000 })
    const aborted = page.waitForEvent('requestfailed', {
      predicate: (r) => r === polled,
      timeout: 5000,
    })

    await page.getByTestId(T.btnCancelRun).click({ timeout: 3000 })

    expect((await aborted).failure()?.errorText).toBe('net::ERR_ABORTED')
    await expect.poll(() => interruptsSeen(request)).toEqual([{ promptId: 'p1' }])
    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-phase', 'idle')
    await expect(page.getByTestId(T.runNotice)).toContainText(/cancelled/i)
    await expect(page.getByTestId(T.runError)).toBeHidden()
    await expect(page.getByTestId(T.btnRun)).toBeEnabled()
    await expect(page.getByTestId(T.btnCancelRun)).toBeHidden()
    expect(await canvasHash(page)).toBe(before)
    expect(await historyCount(page)).toBe(1)

    // And the next run works, with no reload.
    await configureFake(request, { stall: null, mode: 'instant' })
    await runTransformFlow(page)
    expect(await centerPixel(page)).toEqual(MAGENTA)
  })

  test('Cancel during a batch stops the runs still to come', async ({ page, request }) => {
    await page.getByTestId(T.runCount).selectOption('3')
    await startRun(page)

    await page.getByTestId(T.btnCancelRun).click({ timeout: 3000 })

    await expect(page.getByTestId(T.runStatus)).toHaveAttribute('data-batch-total', '0')
    await page.waitForTimeout(500)
    expect((await queuedGraphs(request)).length).toBe(1)
    expect(await historyCount(page)).toBe(1)
  })
})

test.describe('R9: warning before unsaved results are dropped', () => {
  const GALLERY = fileURLToPath(new URL('../fixtures/gallery', import.meta.url))

  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.addInitScript((dir) => localStorage.setItem('comfy-edit.imagesDir', dir), GALLERY)
    await page.goto('/')
    await loadFixture(page)
    await expect(page.getByTestId(T.editorCanvas)).toBeVisible()
  })

  const pickFromFolder = async (page: Page) => {
    // Declining the warning leaves the picker open, for picking something else.
    if (!(await page.getByTestId(T.folderPicker).isVisible())) {
      await page.getByTestId(T.btnOpenFolder).click()
    }
    await page.locator(`[data-testid="${T.folderPickerItem}"][data-path="blue.png"]`).click()
  }
  const openers: Array<[string, (page: Page) => Promise<void>]> = [
    ['pasting', pasteImage],
    ['opening a file', (page) => loadFixture(page, OTHER_IMAGE)],
    ['opening from the folder', pickFromFolder],
  ]

  for (const [name, open] of openers) {
    test(`${name} over an unsaved result warns first; declining keeps it, accepting proceeds`, async ({
      page,
    }) => {
      await runTransformFlow(page)
      const before = await canvasHash(page)

      await open(page)
      await expect(page.getByTestId(T.unsavedWarning)).toBeVisible({ timeout: 3000 })
      await expect(page.getByTestId(T.unsavedWarning)).toContainText('1 result has not been saved')
      await page.getByTestId(T.unsavedKeep).click()
      await expect(page.getByTestId(T.unsavedWarning)).toBeHidden()
      expect(await canvasHash(page)).toBe(before)
      expect(await historyCount(page)).toBe(2)

      await open(page)
      await page.getByTestId(T.unsavedDiscard).click()
      await expect(page.getByTestId(T.unsavedWarning)).toBeHidden()
      await expect.poll(() => historyCount(page)).toBe(1)
      expect(await canvasHash(page)).not.toBe(before)
    })
  }

  test('reloading over an unsaved result warns first; declining keeps it', async ({ page }) => {
    await runTransformFlow(page)

    const asked = page.waitForEvent('dialog', { timeout: 5000 })
    // Does not settle while the prompt is up, and is refused once it is declined.
    const reload = page.reload({ timeout: 5000 }).catch(() => null)
    const dialog = await asked
    expect(dialog.type()).toBe('beforeunload')
    await dialog.dismiss()
    await reload

    expect(await historyCount(page)).toBe(2)
    expect(await centerPixel(page)).toEqual(MAGENTA)
  })

  test('with nothing to lose there is no warning, so ordinary use is not slowed', async ({
    page,
  }) => {
    let dialogs = 0
    page.on('dialog', (d) => {
      dialogs += 1
      void d.accept()
    })

    // Replacing an image that has no results: straight through, each way.
    for (const [, open] of openers) {
      await open(page)
      await expect(page.getByTestId(T.unsavedWarning)).toBeHidden()
      await expect(page.getByTestId(T.historyEntry)).toHaveCount(1)
    }
    await page.reload()
    await expect(page.getByTestId(T.imageDropZone)).toBeVisible()
    expect(dialogs).toBe(0)

    // A result that has been saved is nothing to lose either.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'r9-saved-')))
    await loadFixture(page)
    await runTransformFlow(page)
    await page.getByTestId(T.btnSaveImage).click()
    await page.getByTestId(T.dirChooserPath).fill(dir)
    await page.getByTestId(T.dirChooserPath).press('Enter')
    await expect(page.getByTestId(T.dirChooserUse)).toBeEnabled()
    await page.getByTestId(T.dirChooserUse).click()
    await page.getByTestId(T.saveDialogSave).click()
    await expect(page.getByTestId(T.saveConfirmation)).toBeVisible()

    await loadFixture(page, OTHER_IMAGE)
    await expect(page.getByTestId(T.historyEntry)).toHaveCount(1)
    await expect(page.getByTestId(T.unsavedWarning)).toBeHidden()
    await page.reload()
    expect(dialogs).toBe(0)
  })
})

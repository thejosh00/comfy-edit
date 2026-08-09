import { test, expect } from '@playwright/test'
import { T } from '../../src/testids'
import {
  centerPixel,
  drawDrag,
  loadFixture,
  MAGENTA,
  resetFake,
  runTransformFlow,
  TEAL,
} from './helpers'

test.describe('US3: return to an earlier image', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)
  })

  const entries = (page: import('@playwright/test').Page) => page.getByTestId(T.historyEntry)

  test('AS1: the image brought in is the first entry, and is current', async ({ page }) => {
    await expect(entries(page)).toHaveCount(1)
    await expect(entries(page).first()).toHaveAttribute('data-selected', 'true')
  })

  test('AS2: two runs produce three entries, newest current', async ({ page }) => {
    await runTransformFlow(page, { prompt: 'one' })
    await runTransformFlow(page, { prompt: 'two' })

    await expect(entries(page)).toHaveCount(3)
    await expect(entries(page).nth(2)).toHaveAttribute('data-selected', 'true')
    await expect(entries(page).nth(0)).toHaveAttribute('data-selected', 'false')
  })

  test('AS3: a generated entry records its workflow, instruction and seed', async ({ page }) => {
    await runTransformFlow(page, { prompt: 'turn the sky purple' })

    const seed = await page.getByTestId(T.seedInput).inputValue()
    const entry = entries(page).nth(1)

    await expect(entry).toContainText('passthrough')
    const text = (await entry.getAttribute('title')) ?? ''
    expect(text).toContain('turn the sky purple')
    expect(text).toContain(seed)
  })

  test('AS4: selecting the first entry restores that image, keeping all entries', async ({
    page,
  }) => {
    await runTransformFlow(page, { prompt: 'one' })
    await runTransformFlow(page, { prompt: 'two' })
    expect(await centerPixel(page)).toEqual(MAGENTA)

    await entries(page).nth(0).click()

    expect(await centerPixel(page)).toEqual(TEAL)
    await expect(page.getByTestId(T.canvasSize)).toHaveText('256x256')
    await expect(entries(page)).toHaveCount(3)
    await expect(entries(page).nth(0)).toHaveAttribute('data-selected', 'true')
  })

  test('AS5: branching from an earlier entry appends without removing anything', async ({
    page,
  }) => {
    await runTransformFlow(page, { prompt: 'one' })
    await runTransformFlow(page, { prompt: 'two' })

    await entries(page).nth(0).click()
    await page.getByTestId(T.toolRect).click()
    await drawDrag(page, { x: 40, y: 40 }, { x: 200, y: 200 })
    await runTransformFlow(page, { prompt: 'branched' })

    await expect(entries(page)).toHaveCount(4)
    await expect(entries(page).nth(3)).toHaveAttribute('data-selected', 'true')
    expect(await centerPixel(page)).toEqual(MAGENTA)
  })

  test('AS6: selecting an entry discards uncommitted marks and resets undo', async ({ page }) => {
    await runTransformFlow(page, { prompt: 'one' })

    await page.getByTestId(T.toolRect).click()
    await page.getByTestId(T.colorPicker).fill('#ff0000')
    await drawDrag(page, { x: 40, y: 40 }, { x: 200, y: 200 })
    await expect(page.getByTestId(T.btnUndo)).toBeEnabled()

    await entries(page).nth(0).click()

    await expect(page.getByTestId(T.btnUndo)).toBeDisabled()
    await expect(page.getByTestId(T.btnRedo)).toBeDisabled()
    expect(await centerPixel(page)).toEqual(TEAL)
  })

  test('a result of different dimensions is adopted by the workspace', async ({ page }) => {
    // The fake echoes the input size, so load a differently sized image and
    // confirm the readout follows the entry rather than sticking at 256x256.
    await runTransformFlow(page, { prompt: 'one' })
    await expect(page.getByTestId(T.canvasSize)).toHaveText('256x256')
    await expect(entries(page)).toHaveCount(2)
  })
})

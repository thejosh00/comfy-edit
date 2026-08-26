import { test, expect } from '@playwright/test'
import { T } from '../../src/testids'
import { clickCanvasAt, drawDrag, loadFixture, pixelAt } from './helpers'

/**
 * The eyedropper: take a colour out of the image so a mark can match something
 * already in the picture. The fixture is 256x256 solid teal (#008080).
 */

const TEAL_HEX = '#008080'
const MAGENTA_HEX = '#ff00ff'

test.describe('eyedropper', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await loadFixture(page)
  })

  test('samples a colour from the image', async ({ page }) => {
    await expect(page.getByTestId(T.colorPicker)).not.toHaveValue(TEAL_HEX)

    await page.getByTestId(T.toolEyedropper).click()
    await clickCanvasAt(page, { x: 128, y: 128 })

    await expect(page.getByTestId(T.colorPicker)).toHaveValue(TEAL_HEX)
  })

  test('samples a mark that has been drawn, not just the image beneath it', async ({ page }) => {
    // What the user sees is the composite, so that is what the eyedropper reads.
    await page.getByTestId(T.colorPicker).fill(MAGENTA_HEX)
    await page.getByTestId(T.brushSize).fill('30')
    await drawDrag(page, { x: 40, y: 128 }, { x: 210, y: 128 })

    await page.getByTestId(T.colorPicker).fill('#123456')
    await page.getByTestId(T.toolEyedropper).click()
    await clickCanvasAt(page, { x: 128, y: 128 })

    await expect(page.getByTestId(T.colorPicker)).toHaveValue(MAGENTA_HEX)
  })

  test('hands back to the tool that was in use', async ({ page }) => {
    // Picking a colour is something you do in order to draw with it, so the user
    // should not have to reselect the tool they were already holding.
    await page.getByTestId(T.toolRect).click()
    await page.getByTestId(T.toolEyedropper).click()
    await expect(page.getByTestId(T.toolEyedropper)).toHaveAttribute('data-selected', 'true')

    await clickCanvasAt(page, { x: 128, y: 128 })

    await expect(page.getByTestId(T.toolRect)).toHaveAttribute('data-selected', 'true')
    await expect(page.getByTestId(T.toolEyedropper)).toHaveAttribute('data-selected', 'false')
  })

  test('leaves no mark on the image', async ({ page }) => {
    await expect(page.getByTestId(T.btnUndo)).toBeDisabled()

    await page.getByTestId(T.toolEyedropper).click()
    await clickCanvasAt(page, { x: 100, y: 100 })

    // Nothing to undo, and nothing to clear: a sample is not an edit.
    await expect(page.getByTestId(T.btnUndo)).toBeDisabled()
    await expect(page.getByTestId(T.btnClear)).toBeDisabled()
  })

  test('the sampled colour is what the next mark is drawn in', async ({ page }) => {
    // The whole point, end to end: sample the image, then draw with what came back.
    await page.getByTestId(T.colorPicker).fill(MAGENTA_HEX)
    await page.getByTestId(T.brushSize).fill('30')
    await drawDrag(page, { x: 40, y: 60 }, { x: 210, y: 60 })

    await page.getByTestId(T.toolEyedropper).click()
    await clickCanvasAt(page, { x: 128, y: 60 })
    await expect(page.getByTestId(T.colorPicker)).toHaveValue(MAGENTA_HEX)

    await drawDrag(page, { x: 40, y: 200 }, { x: 210, y: 200 })
    expect(await pixelAt(page, 128, 200)).toEqual([255, 0, 255])
  })

  test('a drag with the eyedropper still only samples', async ({ page }) => {
    // Pointer capture is deliberately not taken, so a slipped click cannot turn
    // into a stray shape.
    await page.getByTestId(T.toolEyedropper).click()
    await drawDrag(page, { x: 40, y: 40 }, { x: 200, y: 200 })

    await expect(page.getByTestId(T.colorPicker)).toHaveValue(TEAL_HEX)
    await expect(page.getByTestId(T.btnUndo)).toBeDisabled()
  })
})

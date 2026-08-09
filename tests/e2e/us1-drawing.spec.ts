import { test, expect } from '@playwright/test'
import { T } from '../../src/testids'
import {
  loadFixture,
  centerPixel,
  pixelAt,
  drawDrag,
  TEAL,
  NOT_AN_IMAGE,
} from './helpers'

/**
 * US1 acceptance. Touches no ComfyUI code — see T027, which runs this same spec
 * with the proxy pointed at a dead port to prove SC-008.
 */
test.describe('US1: mark up an image', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('AS1: a chosen image appears at its natural size', async ({ page }) => {
    await expect(page.getByTestId(T.imageDropZone)).toBeVisible()

    await loadFixture(page)

    await expect(page.getByTestId(T.canvasSize)).toHaveText('256x256')
    expect(await centerPixel(page)).toEqual(TEAL)
  })

  test('AS2: a pasted image replaces the workspace image', async ({ page }) => {
    await loadFixture(page)

    // Build a distinct 64x64 image in the page and dispatch it as a paste.
    await page.evaluate(async () => {
      const c = document.createElement('canvas')
      c.width = 64
      c.height = 64
      const ctx = c.getContext('2d')!
      ctx.fillStyle = 'rgb(10, 20, 200)'
      ctx.fillRect(0, 0, 64, 64)
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))

      const dt = new DataTransfer()
      dt.items.add(new File([blob], 'pasted.png', { type: 'image/png' }))
      document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }))
    })

    await expect(page.getByTestId(T.canvasSize)).toHaveText('64x64')
    expect(await centerPixel(page)).toEqual([10, 20, 200])
  })

  test('AS3: dragging with the rectangle tool draws in the chosen color', async ({ page }) => {
    await loadFixture(page)

    await page.getByTestId(T.toolRect).click()
    await expect(page.getByTestId(T.toolRect)).toHaveAttribute('data-selected', 'true')
    await page.getByTestId(T.colorPicker).fill('#ff0000')
    await page.getByTestId(T.brushSize).fill('6')

    await drawDrag(page, { x: 60, y: 60 }, { x: 200, y: 200 })

    // A point on the top edge of the rectangle is red; the middle is untouched.
    expect(await pixelAt(page, 130, 60)).toEqual([255, 0, 0])
    expect(await centerPixel(page)).toEqual(TEAL)
  })

  test.describe('undo, redo and clear', () => {
    test.beforeEach(async ({ page }) => {
      await loadFixture(page)
      await page.getByTestId(T.toolRect).click()
      await page.getByTestId(T.colorPicker).fill('#ff0000')
      await page.getByTestId(T.brushSize).fill('6')
    })

    test('AS4/AS5: undo removes the last mark, redo restores it', async ({ page }) => {
      await expect(page.getByTestId(T.btnUndo)).toBeDisabled()

      await drawDrag(page, { x: 60, y: 60 }, { x: 200, y: 200 })
      expect(await pixelAt(page, 130, 60)).toEqual([255, 0, 0])
      await expect(page.getByTestId(T.btnUndo)).toBeEnabled()

      await page.getByTestId(T.btnUndo).click()
      expect(await pixelAt(page, 130, 60)).toEqual(TEAL)
      await expect(page.getByTestId(T.btnRedo)).toBeEnabled()

      await page.getByTestId(T.btnRedo).click()
      expect(await pixelAt(page, 130, 60)).toEqual([255, 0, 0])
    })

    test('AS4: undoing twice leaves only the first of three marks', async ({ page }) => {
      await drawDrag(page, { x: 20, y: 20 }, { x: 60, y: 60 })
      await drawDrag(page, { x: 90, y: 20 }, { x: 130, y: 60 })
      await drawDrag(page, { x: 160, y: 20 }, { x: 200, y: 60 })

      await page.getByTestId(T.btnUndo).click()
      await page.getByTestId(T.btnUndo).click()

      expect(await pixelAt(page, 40, 20)).toEqual([255, 0, 0])
      expect(await pixelAt(page, 110, 20)).toEqual(TEAL)
      expect(await pixelAt(page, 180, 20)).toEqual(TEAL)
    })

    test('AS6: drawing after undoing discards the redo trail', async ({ page }) => {
      await drawDrag(page, { x: 20, y: 20 }, { x: 60, y: 60 })
      await page.getByTestId(T.btnUndo).click()
      await expect(page.getByTestId(T.btnRedo)).toBeEnabled()

      await drawDrag(page, { x: 160, y: 20 }, { x: 200, y: 60 })
      await expect(page.getByTestId(T.btnRedo)).toBeDisabled()
    })

    test('AS7: clear removes every mark and disables undo', async ({ page }) => {
      await drawDrag(page, { x: 20, y: 20 }, { x: 60, y: 60 })
      await drawDrag(page, { x: 90, y: 20 }, { x: 130, y: 60 })

      await page.getByTestId(T.btnClear).click()

      expect(await pixelAt(page, 40, 20)).toEqual(TEAL)
      expect(await pixelAt(page, 110, 20)).toEqual(TEAL)
      await expect(page.getByTestId(T.btnUndo)).toBeDisabled()
    })

    test('AS8: a click with no drag adds nothing', async ({ page }) => {
      await drawDrag(page, { x: 100, y: 100 }, { x: 100, y: 100 })
      await expect(page.getByTestId(T.btnUndo)).toBeDisabled()
      expect(await centerPixel(page)).toEqual(TEAL)
    })
  })

  test('every tool draws something', async ({ page }) => {
    await loadFixture(page)
    await page.getByTestId(T.colorPicker).fill('#ff0000')
    await page.getByTestId(T.brushSize).fill('8')

    for (const tool of [T.toolFreehand, T.toolLine, T.toolRect, T.toolEllipse]) {
      await page.getByTestId(tool).click()
      await drawDrag(page, { x: 40, y: 40 }, { x: 210, y: 210 })
      await expect(page.getByTestId(T.btnUndo)).toBeEnabled()
      await page.getByTestId(T.btnUndo).click()
    }
  })

  test('FR-005: a file that is not an image reports an error and changes nothing', async ({
    page,
  }) => {
    await loadFixture(page)
    expect(await centerPixel(page)).toEqual(TEAL)

    await page.getByTestId(T.fileInput).setInputFiles(NOT_AN_IMAGE)

    await expect(page.getByTestId(T.loadError)).toBeVisible()
    await expect(page.getByTestId(T.canvasSize)).toHaveText('256x256')
    expect(await centerPixel(page)).toEqual(TEAL)
  })
})

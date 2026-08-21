import { test, expect, type Page } from '@playwright/test'
import { T } from '../../src/testids'
import { canvasHash, centerPixel, resetFake, runTransformFlow } from './helpers'

/**
 * Opening an image out of a folder on the machine running the dev server, listed
 * by our own middleware rather than by ComfyUI. playwright.config.ts points
 * IMAGES_DIR at tests/fixtures/gallery, which holds:
 *
 *   blue.png            solid blue, top level
 *   nested/green.png    solid green, one folder down
 *   notes.txt           not an image
 *   .hidden/red.png     inside a dot-directory
 */

const BLUE: [number, number, number] = [0, 0, 255]
const GREEN: [number, number, number] = [0, 255, 0]

async function openPicker(page: Page) {
  await page.getByTestId(T.btnOpenFolder).click()
  await expect(page.getByTestId(T.folderPicker)).toBeVisible()
}

/**
 * Choose one image and wait for it to be in. The picker dismissing itself is the
 * signal: `openLocalImage` closes it only after the bitmap has been adopted, so
 * anything asserted afterwards is looking at the new image rather than the old
 * one. Waiting on the canvas alone would not do — after a previous pick it is
 * already there, at the same size.
 */
async function pickImage(page: Page, path: string) {
  await page.locator(`[data-testid="${T.folderPickerItem}"][data-path="${path}"]`).click()
  await expect(page.getByTestId(T.folderPicker)).toHaveCount(0)
  await expect(page.getByTestId(T.canvasSize)).not.toHaveText('')
}

test.describe('open from a server folder', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
  })

  test('lists the images in the folder, and only the images', async ({ page }) => {
    await openPicker(page)

    const items = page.getByTestId(T.folderPickerItem)
    await expect(items).toHaveCount(2)

    const paths = await items.evaluateAll((els) =>
      els.map((e) => e.getAttribute('data-path')).sort(),
    )
    expect(paths).toEqual(['blue.png', 'nested/green.png'])

    // Each entry is labelled with its path — with a folder of generated images,
    // the name is usually the only thing distinguishing two similar thumbnails.
    await expect(items.locator('img[alt="nested/green.png"]')).toHaveCount(1)
  })

  test('choosing an image loads it onto the canvas', async ({ page }) => {
    await openPicker(page)
    await pickImage(page, 'blue.png')

    await expect(page.getByTestId(T.canvasSize)).toHaveText('64x64')
    expect(await centerPixel(page)).toEqual(BLUE)
  })

  test('reaches an image in a subfolder', async ({ page }) => {
    await openPicker(page)
    await pickImage(page, 'nested/green.png')

    await expect(page.getByTestId(T.canvasSize)).toHaveText('64x64')
    expect(await centerPixel(page)).toEqual(GREEN)
  })

  test('a folder image starts a fresh session, exactly as opening a local file does', async ({
    page,
  }) => {
    await openPicker(page)
    await pickImage(page, 'blue.png')
    await expect(page.getByTestId(T.historyEntry)).toHaveCount(1)
    await expect(page.getByTestId(T.historyEntry)).toHaveText(/Original/)

    // A second pick replaces the session rather than appending to it.
    await openPicker(page)
    await pickImage(page, 'nested/green.png')
    await expect(page.getByTestId(T.historyEntry)).toHaveCount(1)
    expect(await centerPixel(page)).toEqual(GREEN)
  })

  /**
   * The reason the middleware exists at all rather than a plain file:// or a
   * cross-origin fetch: a tainted canvas makes both getImageData and toBlob throw,
   * so a folder image that could not be transformed would be useless here.
   */
  test('an image opened from the folder can still be transformed', async ({ page }) => {
    await openPicker(page)
    await pickImage(page, 'blue.png')
    const before = await canvasHash(page)

    await runTransformFlow(page, { workflow: 'passthrough' })

    await expect(page.getByTestId(T.historyEntry)).toHaveCount(2)
    expect(await canvasHash(page)).not.toBe(before)
  })

  test('the picker can be dismissed without choosing anything', async ({ page }) => {
    await openPicker(page)
    await page.getByTestId(T.folderPickerClose).click()
    await expect(page.getByTestId(T.folderPicker)).toHaveCount(0)
    await expect(page.getByTestId(T.canvasSize)).toHaveText('')
  })
})

test.describe('the folder route is not a fileserver', () => {
  test('refuses to escape the configured root', async ({ request }) => {
    for (const path of ['../base.png', 'nested/../../base.png', '/etc/passwd']) {
      const res = await request.get(`/local/file?path=${encodeURIComponent(path)}`)
      expect(res.status(), `escaped the root via ${path}`).toBe(404)
    }
  })

  test('refuses a non-image inside the root', async ({ request }) => {
    const res = await request.get('/local/file?path=notes.txt')
    expect(res.status()).toBe(404)
  })

  test('serves a listed image', async ({ request }) => {
    const res = await request.get('/local/file?path=blue.png')
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/png')
  })
})

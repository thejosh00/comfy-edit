import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { T } from '../../src/testids'
import { solidPng } from '../fake-comfy/png.mjs'
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

    const paths = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-path')))
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

/**
 * Density. A folder of renders is routinely a hundred files, and a picker that
 * needs scrolling to show them is a picker you hunt through rather than scan.
 *
 * Declared last on purpose: it adds files to the same gallery the specs above
 * count, and Playwright runs describes in declaration order under `workers: 1`.
 */
test.describe('a hundred images fit on a 1080p screen', () => {
  const DENSITY = fileURLToPath(new URL('../fixtures/gallery/density', import.meta.url))
  const COUNT = 100

  test.use({ viewport: { width: 1920, height: 1080 } })

  test.beforeAll(() => {
    mkdirSync(DENSITY, { recursive: true })
    // Tiny, because this is a layout test — the tile size is set by CSS, not by
    // the pixels behind it, and 100 real renders would only slow the run down.
    for (let i = 0; i < COUNT; i++) {
      writeFileSync(`${DENSITY}/render-${String(i).padStart(3, '0')}.png`, solidPng(16, 16, [i, 64, 128]))
    }
  })

  test.afterAll(() => {
    rmSync(DENSITY, { recursive: true, force: true })
  })

  test('shows every image without scrolling', async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await openPicker(page)

    await expect(page.getByTestId(T.folderPickerItem)).toHaveCount(COUNT + 2)

    // The grid is the scroll container, so this is the whole claim: nothing is
    // parked below the fold.
    const overflow = await page.getByTestId(T.folderPickerGrid).evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }))
    expect(overflow.scrollHeight, 'the grid needs scrolling').toBeLessThanOrEqual(
      overflow.clientHeight + 1,
    )
  })

  test('lists in alphabetical order', async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await openPicker(page)

    // Written out rather than derived from the same comparator the app uses, so
    // this asserts the order a person would expect and not merely self-consistency.
    const expected = [
      'blue.png',
      ...Array.from({ length: COUNT }, (_, i) => `density/render-${String(i).padStart(3, '0')}.png`),
      'nested/green.png',
    ]
    const paths = await page
      .getByTestId(T.folderPickerItem)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-path')))
    expect(paths).toEqual(expected)
  })

  test('captions a tile with its filename, not its folder', async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await openPicker(page)

    const nested = page.locator(`[data-testid="${T.folderPickerItem}"][data-path="nested/green.png"]`)
    // The full path stays reachable — as the tooltip, and as the alt text a test
    // or a screen reader reads.
    await expect(nested).toHaveText('green.png')
    await expect(nested).toHaveAttribute('title', 'nested/green.png')
    await expect(nested.locator('img')).toHaveAttribute('alt', 'nested/green.png')
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

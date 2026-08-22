import { test, expect, type Page } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { T } from '../../src/testids'
import { solidPng } from '../fake-comfy/png.mjs'
import { canvasHash, centerPixel, resetFake, runTransformFlow } from './helpers'

/**
 * Choosing a folder on the machine running the dev server, and opening images out
 * of it. Nothing is configured at startup — the folder is picked in the app — so
 * every test here starts by choosing one.
 *
 * tests/fixtures/gallery holds:
 *
 *   blue.png            solid blue, top level
 *   nested/green.png    solid green, one folder down
 *   notes.txt           not an image
 *   .hidden/red.png     inside a dot-directory
 */

const GALLERY = fileURLToPath(new URL('../fixtures/gallery', import.meta.url))
const FIXTURES = fileURLToPath(new URL('../fixtures', import.meta.url))

const BLUE: [number, number, number] = [0, 0, 255]
const GREEN: [number, number, number] = [0, 255, 0]

/** Open the chooser. With no folder chosen yet, this is what the button gives you. */
async function openChooser(page: Page) {
  await page.getByTestId(T.btnOpenFolder).click()
  await expect(page.getByTestId(T.dirChooser)).toBeVisible()
}

/** Type a path, confirm the server resolved it, and adopt it. */
async function chooseFolder(page: Page, dir = GALLERY) {
  await openChooser(page)
  await page.getByTestId(T.dirChooserPath).fill(dir)
  await page.getByTestId(T.dirChooserPath).press('Enter')
  // Asserted explicitly: "Use" being enabled for some *other* folder is exactly
  // the bug this guards, and adopting it silently would send the rest of the test
  // somewhere nobody asked for.
  await expect(page.getByTestId(T.dirChooserPath)).toHaveValue(dir)
  await expect(page.getByTestId(T.dirChooserUse)).toBeEnabled()
  await page.getByTestId(T.dirChooserUse).click()
  await expect(page.getByTestId(T.folderPicker)).toBeVisible()
}

/** Reopen the grid once a folder is already chosen. */
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

test.describe('choosing a folder', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
  })

  test('opens straight to the chooser when no folder has been chosen', async ({ page }) => {
    // There is no grid to show yet, so making the user dismiss an empty one first
    // would be a step for nothing.
    await page.getByTestId(T.btnOpenFolder).click()
    await expect(page.getByTestId(T.dirChooser)).toBeVisible()
    await expect(page.getByTestId(T.folderPicker)).toHaveCount(0)
  })

  test('starts somewhere real, so browsing can begin without typing', async ({ page }) => {
    await openChooser(page)
    // The server answers a pathless request with the home directory.
    await expect(page.getByTestId(T.dirChooserPath)).not.toHaveValue('')
  })

  test('navigates into a subfolder by clicking it', async ({ page }) => {
    await openChooser(page)
    await page.getByTestId(T.dirChooserPath).fill(FIXTURES)
    await page.getByTestId(T.dirChooserPath).press('Enter')

    await page.locator(`[data-testid="${T.dirChooserEntry}"][data-name="gallery"]`).click()
    await expect(page.getByTestId(T.dirChooserPath)).toHaveValue(GALLERY)
    // Dot-directories are not offered, matching what the image listing walks.
    await expect(page.locator(`[data-testid="${T.dirChooserEntry}"][data-name=".hidden"]`))
      .toHaveCount(0)
    await expect(page.locator(`[data-testid="${T.dirChooserEntry}"][data-name="nested"]`))
      .toHaveCount(1)
  })

  test('goes back up', async ({ page }) => {
    await openChooser(page)
    await page.getByTestId(T.dirChooserPath).fill(GALLERY)
    await page.getByTestId(T.dirChooserPath).press('Enter')
    await expect(page.getByTestId(T.dirChooserUp)).toBeVisible()

    await page.getByTestId(T.dirChooserUp).click()
    await expect(page.getByTestId(T.dirChooserPath)).toHaveValue(FIXTURES)
  })

  test('says so when a path is not a folder, rather than choosing nothing silently', async ({
    page,
  }) => {
    await openChooser(page)
    await page.getByTestId(T.dirChooserPath).fill(`${GALLERY}/nowhere`)
    await page.getByTestId(T.dirChooserPath).press('Enter')

    await expect(page.getByTestId(T.dirChooserError)).toBeVisible()
    // And the folder cannot be adopted, because the server never confirmed it.
    await expect(page.getByTestId(T.dirChooserUse)).toBeDisabled()
  })

  /**
   * The chooser opens on a folder and lists it. If that listing lands after the
   * user has started typing somewhere else, it must not write itself back into
   * the field — otherwise "Use this folder" adopts the folder the chooser
   * happened to open on, which is the user's home directory, and the picker then
   * walks all of it.
   */
  test('a listing that lands late does not overwrite what is being typed', async ({ page }) => {
    // Held back so the initial listing is guaranteed to arrive after the typing.
    await page.route('**/local/dirs*', async (route) => {
      await new Promise((r) => setTimeout(r, 800))
      await route.continue()
    })

    await page.getByTestId(T.btnOpenFolder).click()
    await page.getByTestId(T.dirChooserPath).fill(GALLERY)

    // Let the held-back listing land.
    await expect(page.getByTestId(T.dirChooserEntry).first()).toBeVisible()

    await expect(page.getByTestId(T.dirChooserPath)).toHaveValue(GALLERY)
    // And it still cannot be adopted, because the server has not resolved it yet.
    await expect(page.getByTestId(T.dirChooserUse)).toBeDisabled()
  })

  test('will not adopt a path the server has not resolved', async ({ page }) => {
    await openChooser(page)
    await page.getByTestId(T.dirChooserPath).fill(GALLERY)
    // Typed but not submitted: a half-typed path is not yet a place.
    await expect(page.getByTestId(T.dirChooserUse)).toBeDisabled()
  })

  test('remembers the folder across a reload', async ({ page }) => {
    await chooseFolder(page)
    await page.reload()

    // Straight to the grid — the choice survived, so the chooser is not shown again.
    await page.getByTestId(T.btnOpenFolder).click()
    await expect(page.getByTestId(T.folderPicker)).toBeVisible()
    await expect(page.getByTestId(T.folderPickerStatus)).toContainText(GALLERY)
  })

  test('can be changed from the grid', async ({ page }) => {
    await chooseFolder(page)
    await page.getByTestId(T.btnChangeFolder).click()

    await expect(page.getByTestId(T.dirChooser)).toBeVisible()
    // Reopened where the current folder is, not back at home.
    await expect(page.getByTestId(T.dirChooserPath)).toHaveValue(GALLERY)

    await page.getByTestId(T.dirChooserUp).click()
    await page.getByTestId(T.dirChooserUse).click()
    await expect(page.getByTestId(T.folderPickerStatus)).toContainText(FIXTURES)
  })
})

test.describe('open from a server folder', () => {
  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await chooseFolder(page)
  })

  test('lists the images in the folder, and only the images', async ({ page }) => {
    const items = page.getByTestId(T.folderPickerItem)
    await expect(items).toHaveCount(2)

    const paths = await items.evaluateAll((els) => els.map((e) => e.getAttribute('data-path')))
    expect(paths).toEqual(['blue.png', 'nested/green.png'])

    // Each entry is labelled with its path — with a folder of generated images,
    // the name is usually the only thing distinguishing two similar thumbnails.
    await expect(items.locator('img[alt="nested/green.png"]')).toHaveCount(1)
  })

  test('choosing an image loads it onto the canvas', async ({ page }) => {
    await pickImage(page, 'blue.png')

    await expect(page.getByTestId(T.canvasSize)).toHaveText('64x64')
    expect(await centerPixel(page)).toEqual(BLUE)
  })

  test('reaches an image in a subfolder', async ({ page }) => {
    await pickImage(page, 'nested/green.png')

    await expect(page.getByTestId(T.canvasSize)).toHaveText('64x64')
    expect(await centerPixel(page)).toEqual(GREEN)
  })

  test('a folder image starts a fresh session, exactly as opening a local file does', async ({
    page,
  }) => {
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
    await pickImage(page, 'blue.png')
    const before = await canvasHash(page)

    await runTransformFlow(page, { workflow: 'passthrough' })

    await expect(page.getByTestId(T.historyEntry)).toHaveCount(2)
    expect(await canvasHash(page)).not.toBe(before)
  })

  test('the picker can be dismissed without choosing anything', async ({ page }) => {
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
      writeFileSync(
        `${DENSITY}/render-${String(i).padStart(3, '0')}.png`,
        solidPng(16, 16, [i, 64, 128]),
      )
    }
  })

  test.afterAll(() => {
    rmSync(DENSITY, { recursive: true, force: true })
  })

  test.beforeEach(async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await chooseFolder(page)
    // Settle before measuring: the picker opens on an empty grid and fills in when
    // the listing lands, so anything read before this sees nothing.
    await expect(page.getByTestId(T.folderPickerItem)).toHaveCount(COUNT + 2)
  })

  test('shows every image without scrolling', async ({ page }) => {
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

  test('lists in alphabetical order', async ({ page }) => {
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

  test('captions a tile with its filename, not its folder', async ({ page }) => {
    const nested = page.locator(
      `[data-testid="${T.folderPickerItem}"][data-path="nested/green.png"]`,
    )
    // The full path stays reachable — as the tooltip, and as the alt text a test
    // or a screen reader reads.
    await expect(nested).toHaveText('green.png')
    await expect(nested).toHaveAttribute('title', 'nested/green.png')
    await expect(nested.locator('img')).toHaveAttribute('alt', 'nested/green.png')
  })
})

test.describe('the folder route is not a fileserver', () => {
  const q = (path: string) =>
    `/local/file?dir=${encodeURIComponent(GALLERY)}&path=${encodeURIComponent(path)}`

  test('refuses to escape the chosen folder', async ({ request }) => {
    for (const path of ['../base.png', 'nested/../../base.png', '/etc/passwd']) {
      const res = await request.get(q(path))
      expect(res.status(), `escaped the folder via ${path}`).toBe(404)
    }
  })

  test('refuses a non-image inside the folder', async ({ request }) => {
    expect((await request.get(q('notes.txt'))).status()).toBe(404)
  })

  test('refuses a relative directory, which would resolve against the server cwd', async ({
    request,
  }) => {
    const res = await request.get('/local/file?dir=tests/fixtures/gallery&path=blue.png')
    expect(res.status()).toBe(404)
  })

  test('serves an image from the chosen folder', async ({ request }) => {
    const res = await request.get(q('blue.png'))
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toBe('image/png')
  })
})

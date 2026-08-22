import { test, expect, type Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { T } from '../../src/testids'
import { pngSize } from '../fake-comfy/png.mjs'
import { loadFixture, resetFake, runTransformFlow } from './helpers'

/**
 * Saving an image back out to a folder on this machine: choose the folder, pick
 * the image, name the file. The folder is chosen in the app and remembered, the
 * same as the one images are opened from — and separately from it, since the two
 * are rarely the same place.
 */

const SAVE_DIR = fileURLToPath(new URL('../fixtures/saved', import.meta.url))
const GALLERY = fileURLToPath(new URL('../fixtures/gallery', import.meta.url))

/** Load an image and transform it, so there is a generated image to save. */
async function generate(page: Page) {
  await loadFixture(page)
  await runTransformFlow(page, { workflow: 'passthrough' })
}

/** Walk the chooser to the save folder. Only needed the first time. */
async function chooseSaveFolder(page: Page, dir = SAVE_DIR) {
  await page.getByTestId(T.btnSaveImage).click()
  await expect(page.getByTestId(T.dirChooser)).toBeVisible()
  await page.getByTestId(T.dirChooserPath).fill(dir)
  await page.getByTestId(T.dirChooserPath).press('Enter')
  // Never adopt a folder other than the one asked for — see the same assertion in
  // local-folder.spec.ts.
  await expect(page.getByTestId(T.dirChooserPath)).toHaveValue(dir)
  await expect(page.getByTestId(T.dirChooserUse)).toBeEnabled()
  await page.getByTestId(T.dirChooserUse).click()
  await expect(page.getByTestId(T.saveDialog)).toBeVisible()
}

async function saveAs(page: Page, name: string) {
  await page.getByTestId(T.saveDialogName).fill(name)
  await page.getByTestId(T.saveDialogSave).click()
}

test.describe('saving an image to a folder', () => {
  test.beforeEach(async ({ page, request }) => {
    // A clean folder per test: these assertions are about what is on disk, and a
    // leftover file from the previous test would collide with this one's name.
    rmSync(SAVE_DIR, { recursive: true, force: true })
    mkdirSync(SAVE_DIR, { recursive: true })
    await resetFake(request)
    await page.goto('/')
  })

  test.afterAll(() => {
    rmSync(SAVE_DIR, { recursive: true, force: true })
  })

  test('cannot save before there is an image to save', async ({ page }) => {
    await expect(page.getByTestId(T.btnSaveImage)).toBeDisabled()
  })

  test('asks for a folder, then a filename, then writes the file', async ({ page }) => {
    await generate(page)
    await chooseSaveFolder(page)
    await saveAs(page, 'sunset.png')

    await expect(page.getByTestId(T.saveDialog)).toHaveCount(0)
    await expect(page.getByTestId(T.saveConfirmation)).toContainText(`${SAVE_DIR}/sunset.png`)

    // The claim is about the disk, so this reads the disk.
    const written = readFileSync(`${SAVE_DIR}/sunset.png`)
    expect(pngSize(written), 'not a readable PNG').not.toBeNull()
  })

  test('offers the workflow and seed as the filename', async ({ page }) => {
    await generate(page)
    const seed = await page.getByTestId(T.seedInput).inputValue()

    await chooseSaveFolder(page)
    // Meaningful and near-unique, which keeps "that name is taken" off the path
    // a user walks every time.
    await expect(page.getByTestId(T.saveDialogName)).toHaveValue(`passthrough-${seed}.png`)
  })

  test('adds .png when the name has no extension', async ({ page }) => {
    await generate(page)
    await chooseSaveFolder(page)
    await saveAs(page, 'sunset')

    await expect(page.getByTestId(T.saveConfirmation)).toContainText('sunset.png')
    expect(existsSync(`${SAVE_DIR}/sunset.png`)).toBe(true)
  })

  test('refuses to overwrite, and says which name is taken', async ({ page }) => {
    await generate(page)
    await chooseSaveFolder(page)
    await saveAs(page, 'sunset.png')
    await expect(page.getByTestId(T.saveConfirmation)).toBeVisible()

    const first = readFileSync(`${SAVE_DIR}/sunset.png`)

    await page.getByTestId(T.btnSaveImage).click()
    await saveAs(page, 'sunset.png')

    // Still open, carrying the reason — a taken name is a prompt to pick another
    // one, not a dead end.
    await expect(page.getByTestId(T.saveDialog)).toBeVisible()
    await expect(page.getByTestId(T.saveDialogError)).toContainText('sunset.png')
    expect(readFileSync(`${SAVE_DIR}/sunset.png`).equals(first), 'the file was overwritten').toBe(
      true,
    )

    // And a different name still works from the same dialog.
    await saveAs(page, 'dusk.png')
    await expect(page.getByTestId(T.saveDialog)).toHaveCount(0)
    expect(existsSync(`${SAVE_DIR}/dusk.png`)).toBe(true)
  })

  test('refuses a filename that is really a path', async ({ page }) => {
    await generate(page)
    await chooseSaveFolder(page)
    await saveAs(page, '../escaped.png')

    await expect(page.getByTestId(T.saveDialogError)).toBeVisible()
    expect(existsSync(fileURLToPath(new URL('../fixtures/escaped.png', import.meta.url)))).toBe(
      false,
    )
    expect(readdirSync(SAVE_DIR)).toEqual([])
  })

  test('refuses a non-png name, because the bytes written are always PNG', async ({ page }) => {
    await generate(page)
    await chooseSaveFolder(page)
    await saveAs(page, 'sunset.jpg')

    await expect(page.getByTestId(T.saveDialogError)).toContainText(/png/i)
    expect(readdirSync(SAVE_DIR)).toEqual([])
  })

  test('remembers the save folder across a reload', async ({ page }) => {
    await generate(page)
    await chooseSaveFolder(page)
    await page.getByTestId(T.saveDialogClose).click()

    await page.reload()
    await generate(page)

    // Straight to the filename prompt — the folder was already chosen.
    await page.getByTestId(T.btnSaveImage).click()
    await expect(page.getByTestId(T.saveDialog)).toBeVisible()
    await expect(page.getByTestId(T.saveDialogFolder)).toHaveText(SAVE_DIR)
  })

  test('the save folder can be changed from the dialog', async ({ page }) => {
    await generate(page)
    await chooseSaveFolder(page)

    await page.getByTestId(T.saveDialogChangeFolder).click()
    await expect(page.getByTestId(T.dirChooser)).toBeVisible()
    // Reopened where the save folder is, not at home.
    await expect(page.getByTestId(T.dirChooserPath)).toHaveValue(SAVE_DIR)
  })

  test('the save folder is independent of the folder images are opened from', async ({ page }) => {
    // Choosing where images come from must not quietly become where they go.
    await page.getByTestId(T.btnOpenFolder).click()
    await page.getByTestId(T.dirChooserPath).fill(GALLERY)
    await page.getByTestId(T.dirChooserPath).press('Enter')
    await page.getByTestId(T.dirChooserUse).click()
    await expect(page.getByTestId(T.folderPicker)).toBeVisible()

    await page
      .locator(`[data-testid="${T.folderPickerItem}"][data-path="blue.png"]`)
      .click()
    await expect(page.getByTestId(T.folderPicker)).toHaveCount(0)

    // No save folder chosen yet, so this is still the chooser and not the prompt.
    await page.getByTestId(T.btnSaveImage).click()
    await expect(page.getByTestId(T.dirChooser)).toBeVisible()
    await expect(page.getByTestId(T.saveDialog)).toHaveCount(0)
  })
})

test.describe('the save route is not a fileserver', () => {
  const post = (dir: string, name: string) =>
    `/local/save?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}`

  test.beforeEach(() => {
    rmSync(SAVE_DIR, { recursive: true, force: true })
    mkdirSync(SAVE_DIR, { recursive: true })
  })

  test.afterAll(() => {
    rmSync(SAVE_DIR, { recursive: true, force: true })
  })

  test('refuses to write outside the chosen folder', async ({ request }) => {
    for (const name of ['../escaped.png', 'nested/escaped.png', '/tmp/escaped.png']) {
      const res = await request.post(post(SAVE_DIR, name), { data: 'not really a png' })
      expect(res.status(), `wrote outside the folder via ${name}`).toBe(400)
    }
    expect(readdirSync(SAVE_DIR)).toEqual([])
  })

  test('refuses a relative folder, which would resolve against the server cwd', async ({
    request,
  }) => {
    const res = await request.post(post('tests/fixtures/saved', 'a.png'), { data: 'bytes' })
    expect(res.status()).toBe(400)
  })

  test('refuses an empty body rather than writing a zero-byte file', async ({ request }) => {
    const res = await request.post(post(SAVE_DIR, 'empty.png'), { data: '' })
    expect(res.status()).toBe(400)
    expect(readdirSync(SAVE_DIR)).toEqual([])
  })
})

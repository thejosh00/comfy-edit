import { test, expect } from '@playwright/test'
import { T } from '../../src/testids'

/**
 * The logo is the one piece of chrome that is present before an image is, so it
 * is asserted on a cold load with nothing else set up.
 */
test.describe('brand mark', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('the toolbar carries the logo and the wordmark', async ({ page }) => {
    const brand = page.getByTestId(T.brandMark)
    await expect(brand).toBeVisible()
    await expect(brand).toContainText('comfy-edit')

    // Same file as the favicon, so the two can never drift apart.
    await expect(brand.locator('img')).toHaveAttribute('src', '/logo.svg')
  })

  test('the page declares an SVG favicon that actually resolves', async ({ page }) => {
    const href = await page.locator('link[rel="icon"]').getAttribute('href')
    expect(href).toBe('/logo.svg')

    const res = await page.request.get(href!)
    expect(res.status()).toBe(200)
    expect(res.headers()['content-type']).toContain('svg')
  })
})

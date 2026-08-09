import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { T } from '../../src/testids'
import { loadFixture, MAGENTA, centerPixel, resetFake, runTransformFlow } from './helpers'

/**
 * SC-007: "Adding a new workflow requires only adding configuration files: zero
 * lines of code change, verified by adding one."
 *
 * Verified by exercising it, not describing it — this is the claim most likely to
 * rot silently, since the whole manifest design exists to make it true.
 */

const WORKFLOWS = fileURLToPath(new URL('../../public/workflows/', import.meta.url))
const MANIFEST = `${WORKFLOWS}manifest.json`
const ADDED_GRAPH = `${WORKFLOWS}second.api.json`

test.describe('adding a workflow needs no code change', () => {
  let originalManifest: string

  test.beforeAll(() => {
    originalManifest = readFileSync(MANIFEST, 'utf8')

    // Only configuration is touched: one new graph file, one new manifest entry.
    copyFileSync(`${WORKFLOWS}passthrough.api.json`, ADDED_GRAPH)
    const manifest = JSON.parse(originalManifest)
    manifest.workflows.push({
      id: 'second',
      label: 'Second Workflow',
      file: 'second.api.json',
      imageNode: '1',
      promptNode: '2',
      seedNode: '3',
    })
    writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`)
  })

  test.afterAll(() => {
    writeFileSync(MANIFEST, originalManifest)
    rmSync(ADDED_GRAPH, { force: true })
  })

  test('the new workflow appears and runs, with src/ untouched', async ({ page, request }) => {
    await resetFake(request)
    await page.goto('/')
    await loadFixture(page)

    // Assert the added workflow appeared alongside whatever was already
    // configured — never the exact list, which would break the moment a real
    // workflow is added to the manifest, which is the very thing being verified.
    const before: string[] = JSON.parse(originalManifest).workflows.map(
      (w: { label: string }) => w.label,
    )
    const labels = await page.getByTestId(T.workflowSelect).locator('option').allTextContents()
    expect(labels).toEqual([...before, 'Second Workflow'])

    await runTransformFlow(page, { workflow: 'second', prompt: 'via the added workflow' })
    expect(await centerPixel(page)).toEqual(MAGENTA)

    // The actual claim: no application code changed to make any of that work.
    const changed = execFileSync('git', ['status', '--porcelain', '--', 'src/'], {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      encoding: 'utf8',
    }).trim()
    expect(changed).toBe('')
  })
})

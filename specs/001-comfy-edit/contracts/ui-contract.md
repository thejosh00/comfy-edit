# Contract: UI Test IDs and Observable States

**Direction**: the application exposes this surface; the E2E specs consume it. This is the concrete
form of constitution Principle III — "stable selectors" and "machine-readable output".

Every id below is a key in `src/testids.ts`, a single exported const object imported by **both** the
components and the specs. That is the point: renaming a selector becomes a TypeScript compile error
rather than a silently-skipped test.

```ts
// src/testids.ts
export const T = {
  appRoot: 'app-root',
  fileInput: 'file-input',
  // …
} as const
```

Specs select with `page.getByTestId(T.editorCanvas)`, never with a string literal.

---

## Workspace

| Test id | Element | Observable state |
|---|---|---|
| `app-root` | page container | — |
| `image-drop-zone` | empty-state target | visible only when no image is loaded |
| `file-input` | hidden `<input type="file">` | driven by Playwright's `setInputFiles` — no OS dialog involved |
| `editor-canvas` | the single `<canvas>` | backing store matches the base image's natural size; pixels readable via `getImageData` |
| `canvas-size` | text | `"<width>x<height>"`, e.g. `256x256` (FR-004) |
| `load-error` | banner | present only when a chosen file could not be read (FR-005) |

**One canvas, not two.** The whole scene — base image plus every mark — is redrawn into a single
element, so a spec has one element to find, one `toBlob`, and one `getImageData`.

---

## Toolbar

| Test id | Element | Observable state |
|---|---|---|
| `tool-freehand` `tool-line` `tool-rect` `tool-ellipse` | tool buttons | `data-selected="true"` on exactly one |
| `color-picker` | color input | current mark color |
| `brush-size` | number/range input | current stroke thickness |
| `btn-undo` | button | `disabled` when there is nothing to undo (FR-015) |
| `btn-redo` | button | `disabled` when there is nothing to redo (FR-015) |
| `btn-clear` | button | `disabled` when there are no marks |

---

## Transform panel

| Test id | Element | Observable state |
|---|---|---|
| `workflow-select` | dropdown | one option per configured workflow, in manifest order, `value` = workflow id |
| `workflow-error` | banner | present when any workflow is misconfigured or none are configured; names the workflow and the problem (FR-032) |
| `prompt-input` | textarea | the instruction (FR-018) |
| `lora-slot` | container | one per node id in the workflow's `loraNodes`; none at all when it declares none |
| `lora-select` | dropdown | `data-slot="0..2"`; a `None` option plus one per catalog LoRA allowed for this workflow, `value` = lora id |
| `lora-strength` | range input | `data-slot`, **`data-value`** = the strength that will be sent; `disabled` while the slot is empty |
| `seed-input` | number input | current seed |
| `seed-lock` | checkbox | when checked, the seed is reused rather than randomised (FR-028) |
| `run-count` | dropdown | how many times Run executes the workflow; defaults to `1` |
| `run-mode` | dropdown | `variations` or `serial`; **absent entirely while `run-count` is 1** |
| `btn-run` | button | `disabled` while a run is in progress (FR-022), while no image is loaded, and whenever `workflow-error` is present |
| `run-status` | status text | `data-phase` ∈ `idle` `uploading` `queued` `running` `done` `error`; **`data-batch-index`** (1-based) and **`data-batch-total`**, both `0` when no batch is in flight |
| `run-progress` | progress element | **`data-value="0".."100"`** |
| `run-error` | banner | the service's own reason, verbatim (FR-025) |

**`run-progress` carries its value as an attribute, and specs assert the attribute — never a rendered
pixel width.** Reading a computed style would make the assertion depend on layout and CSS transition
timing; an attribute cannot flake.

**`run-status` carries `data-phase` rather than requiring a text match**, so assertions do not break
when the human-readable wording changes.

---

## History strip

| Test id | Element | Observable state |
|---|---|---|
| `history-strip` | container | ordered oldest-first (FR-034) |
| `history-entry` | one per entry | `data-entry-id`, `data-parent-id` (empty for the first), `data-selected="true"` on exactly one (FR-036) |

Each entry exposes its origin — workflow, instruction, and seed — as accessible text so FR-035 is
checkable without reaching into application internals.

---

## Machine-readable output

`playwright.config.ts` runs a `json` reporter by default, writing `test-results/results.json`. An
agent can parse pass/fail without a different invocation, satisfying Principle III's
"machine-readable output" alongside the human-readable `list` reporter.

---

## Determinism rules the specs follow

1. **Reset the fake in `beforeEach`** via `POST /__test/reset`. Per-test isolation with no process
   restart.
2. **Never `waitForTimeout`.** Wait on `data-phase`, on `data-value`, or on element presence. For
   progress specifically, put the fake in `stepped` mode so it emits nothing until asked — an
   assertion on an intermediate progress value then cannot race.
3. **Assert pixels, not screenshots.** The teal fixture and the fake's magenta output make a
   centre-pixel read an unambiguous proof that the pipeline ran end to end:

   ```ts
   const px = await page.evaluate(() => {
     const c = document.querySelector('[data-testid="editor-canvas"]') as HTMLCanvasElement
     const d = c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data
     return [d[0], d[1], d[2]]
   })
   expect(px).toEqual([255, 0, 255])
   ```

   This works only because the proxy keeps `/comfy/view` same-origin (see `comfyui-api.md` §5).
   Screenshot comparison was rejected: it is sensitive to font rendering and antialiasing and would
   be flaky across machines, which the constitution forbids.
4. **Inject failure through the network, not through the app.** The malformed-manifest case uses
   `page.route('**/workflows/manifest.json', …)` to serve broken JSON, so no test-only code path
   exists in the application itself.
5. **The `@live` spec asserts only that the canvas changed** — never an exact color — because a real
   model's output is not deterministic. It is skipped unless `COMFY_LIVE=1`.

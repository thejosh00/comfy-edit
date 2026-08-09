# Tasks: Draw-and-Transform Image Editor

**Input**: Design documents from `/specs/001-comfy-edit/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/)

**Tests**: Tests are MANDATORY (Constitution Principles I & II). Every user story has unit tests
written first and observed failing, plus at least one end-to-end test. No implementation task is
listed before the tests that specify it. A story is not complete until its unit tests AND its E2E
test pass.

**Organization**: Tasks are grouped by user story so each can be implemented and tested
independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Single project, frontend only. `src/` and `tests/` at repository root, workflow configuration under
`public/workflows/`. Full tree in [plan.md](./plan.md) → Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization. No application logic, so no tests here — the first real test
arrives in Phase 2.

- [X] T001 Create `package.json` with dependencies `react`, `react-dom`; devDependencies `vite`, `@vitejs/plugin-react`, `typescript`, `@types/react`, `@types/react-dom`, `vitest`, `@playwright/test`, `ws`; and scripts `dev`, `build`, `start`, `typecheck`, `test:unit`, `test:e2e`, `test:e2e:live`, `test`, `fake-comfy` exactly as specified in [plan.md](./plan.md) and [quickstart.md](./quickstart.md). Nine packages total — do not add a state library, CSS framework, HTTP client, uuid library, jsdom, or React Testing Library (Principle IV, justified in plan.md Complexity Tracking).
- [X] T002 Create `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess`, ESNext modules, `jsx: react-jsx`, and `noEmit`.
- [X] T003 Create `vite.config.ts` with the React plugin, a `/comfy` proxy (target from `COMFY_URL` via `loadEnv`, default `http://127.0.0.1:8188`, `changeOrigin: true`, `ws: true`, rewrite stripping `/comfy`), the **same proxy object assigned to both `server.proxy` and `preview.proxy`** (`vite preview` ignores `server.proxy`), and a `test` block with `environment: 'node'` and `include: ['tests/unit/**/*.test.ts']`.
- [X] T004 Create `playwright.config.ts` with `testDir: 'tests/e2e'`, `list` and `json` reporters (the JSON one writes `test-results/results.json` for Principle III), `baseURL: http://127.0.0.1:5174`, `trace: 'retain-on-failure'`, and a `webServer` array that starts the fake ComfyUI on port 8199 and the dev server on 5174 with URL-readiness probes. Gate the fake's entry on `!process.env.COMFY_LIVE` and set the dev server's `COMFY_URL` to the fake when not live. **No `waitForTimeout` anywhere in the harness.**
- [X] T005 [P] Create `index.html`, `src/main.tsx`, a placeholder `src/App.tsx`, and `src/styles.css` sufficient for `npm run dev` to serve a blank page.
- [X] T006 [P] Create `.env.example` containing `COMFY_URL=http://127.0.0.1:8188`.
- [X] T007 [P] Create `tests/fixtures/base.png` — a 256×256 solid teal `rgb(0,128,128)` PNG. Teal is chosen so it can never be confused with the fake's magenta output; see [contracts/ui-contract.md](./contracts/ui-contract.md) §Determinism.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The shared test harness and the type/selector vocabulary every story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T008 [P] Create `src/testids.ts` exporting one `as const` object with every id from [contracts/ui-contract.md](./contracts/ui-contract.md). This file is imported by **both** components and specs, so a renamed selector becomes a compile error rather than a silently-skipped test.
- [X] T009 [P] Create `src/core/types.ts` with `Point`, `Size`, `ToolId`, and the `Shape` union exactly as defined in [data-model.md](./data-model.md).
- [X] T010 Create `tests/fake-comfy/server.mjs` implementing `POST /upload/image`, `POST /prompt`, `GET /history/<id>`, `GET /view`, `GET /ws`, and `GET /system_stats` per [contracts/comfyui-api.md](./contracts/comfyui-api.md). Include a dependency-free PNG encoder over `node:zlib.deflateSync` producing **solid magenta** output at the input's dimensions. Plain ESM so Playwright runs it with `node` directly.
- [X] T011 Add the contract assertions and test-control endpoints to `tests/fake-comfy/server.mjs`: assert the upload field is named `image` and no `Content-Type` was hand-set; assert the queued body has both `prompt` and `client_id`; assert the image filename inside the queued graph exists in the upload map (this is what catches a `patchWorkflow` writing to the wrong node). Record each queued graph so tests can inspect the seed and prompt that were actually sent. Add `POST /__test/reset`, `POST /__test/config` (`mode`, `steps`, `protocol`, `completion`, `failWith`, `dropWsAfter`, `neverComplete`), `POST /__test/advance`, and `GET /__test/queued`. Log the path each request arrived on, so a proxy rewrite mismatch is diagnosable in one run.
- [X] T012 [P] Create `public/workflows/passthrough.api.json` (the four-node graph in [contracts/workflow-manifest.md](./contracts/workflow-manifest.md)) and `public/workflows/manifest.json` with its entry. **This is what lets US2 be built and shipped with the GPU switched off.**
- [X] T013 [P] Create `tests/e2e/helpers.ts` with `resetFake(request)`, `configureFake(request, cfg)`, `queuedGraphs(request)`, `loadFixture(page)`, `centerPixel(page)`, `pixelAt(page, x, y)`, `canvasHash(page)`, `drawDrag(page, from, to)`, and `runTransformFlow(page, opts)`. `runTransformFlow` is shared by the offline and `@live` specs so the two never drift apart.
- [X] T014 Write `tests/e2e/proxy.spec.ts` asserting the app reaches the fake through the proxy and the WebSocket upgrade arrives at `/ws`, not `/comfy/ws`. **Run this before building anything else** — `ws: true` combined with `rewrite` is version-dependent in `http-proxy` (research.md D1), and this is the assertion that settles it. If it fails, add a `configureServer` hook handling `httpServer.on('upgrade')` manually.

**Checkpoint**: Harness is proven — the fake starts, the proxy forwards, the WebSocket upgrades, and pixels are readable. User story work can begin.

---

## Phase 3: User Story 1 - Mark up an image (Priority: P1) 🎯 MVP

**Goal**: A usable image markup tool — bring in an image, draw four shape types in a chosen color and
thickness, undo, redo, and clear.

**Independent Test**: Passes its full acceptance suite with **no transformation service available**
(SC-008). Verified explicitly in T027.

### Tests for User Story 1 (MANDATORY — write first, MUST fail) ⚠️

> **Write these and observe them FAIL before writing any implementation code.**

- [ ] T015 [P] [US1] Write `tests/unit/shapes.test.ts`: `beginShape` produces a degenerate shape at the click point for each tool; `extendShape` is immutable; `normalizeRect` handles all four drag directions; `ellipseFromCorners` centres correctly; `isDegenerate` is true for a click with no drag (FR-010); `toCanvasPoint` converts client coordinates through a CSS-scaled canvas (FR-009); shift-constrain snaps lines to 45° and forces squares and circles.
- [ ] T016 [P] [US1] Write `tests/unit/drawing.test.ts`: `commitShape` appends **and clears `undone`** (FR-013); `undo` and `redo` move shapes between the lists and are no-ops when empty (FR-011, FR-012); `clearShapes` empties both lists (FR-014); `canUndo`/`canRedo` are derived (FR-015); `rebase` sets the new base and clears **both** `shapes` and `undone` (FR-023, FR-039); every operation returns a new object and mutates nothing. **`rebase` belongs here, with the rest of `DrawingDoc`, because US2's T040 calls it — specifying it later would mean implementing it untested.** The `undone` half is the one a naive implementation misses: a surviving redo stack would let the user redraw a mark already baked into the image beneath it.
- [ ] T017 [P] [US1] Write `tests/unit/render.test.ts` using a ~15-line recording fake implementing the structural `Ctx2D` interface: `drawShape` emits the expected command sequence per shape kind, and sets `strokeStyle` and `lineWidth` from the shape rather than from ambient state. No jsdom, no node-canvas.
- [ ] T018 [US1] Write `tests/e2e/us1-drawing.spec.ts` covering spec Acceptance Scenarios 1–8: `setInputFiles` the teal fixture and assert `canvas-size` reads `256x256` and the centre pixel is teal; paste an image; drag a red rectangle and assert a pixel on the stroke is red; undo and assert it is teal again; assert `btn-redo` becomes enabled; draw after undoing and assert redo is disabled; clear and assert undo is disabled; click without dragging and assert nothing was added. Also cover the Edge Case behind FR-005: `setInputFiles` a non-image file and assert `load-error` is visible with the canvas unchanged.
- [ ] T019 [US1] Run `npm run test:unit` and `npm run test:e2e` and **confirm every test from T015–T018 fails** for the right reason (missing module, missing test id) — not from a typo in the test itself. Do not proceed until the red is real.

### Implementation for User Story 1

- [ ] T020 [P] [US1] Implement `src/core/shapes.ts` to make T015 pass.
- [ ] T021 [P] [US1] Implement `src/core/drawing.ts` to make T016 pass, including `rebase`.
- [ ] T022 [P] [US1] Implement `src/core/render.ts` to make T017 pass — `drawShape(ctx: Ctx2D, s)` plus `renderScene(ctx, base, shapes, size)`. Declare `Ctx2D` structurally so `CanvasRenderingContext2D` satisfies it with no cast at the call site.
- [ ] T023 [US1] Implement the drawing slice of `src/ui/useEditor.ts` — one `useReducer` over `{doc, tool, color, width}` where every mutation delegates to `src/core/`. No logic in the reducer beyond dispatching to core functions.
- [ ] T024 [US1] Implement `src/ui/CanvasStage.tsx`: one `<canvas>` whose backing store matches the base image's natural size, CSS-scaled to fit the viewport; pointer handlers converting through `toCanvasPoint`; full `renderScene` redraw per `pointermove`; the in-flight shape drawn but not committed until pointerup; degenerate shapes discarded.
- [ ] T025 [P] [US1] Implement `src/ui/Toolbar.tsx`: four tool buttons with `data-selected`, color picker, brush size, and undo/redo/clear buttons whose `disabled` state comes from `canUndo`/`canRedo`/shape count.
- [ ] T026 [US1] Wire `src/App.tsx`: hidden `file-input` plus `image-drop-zone` empty state, a document-level paste handler (FR-002), `canvas-size` readout (FR-004), and a `load-error` banner when a file cannot be decoded (FR-005). Canvas sizing follows the loaded image's natural dimensions (FR-003).
- [ ] T027 [US1] Verify SC-008 explicitly: run `COMFY_URL=http://127.0.0.1:9 npx playwright test tests/e2e/us1-drawing.spec.ts` — pointing the proxy at a dead port — and confirm the drawing suite passes green with no transformation service reachable.

**Checkpoint**: User Story 1 is fully functional and testable independently; its unit tests AND its E2E test pass; the full suite is green. **This is a shippable image markup tool.**

---

## Phase 4: User Story 2 - Transform the marked-up image (Priority: P2)

**Goal**: Choose a workflow, type an instruction, run the composited canvas through ComfyUI, and have
the result replace the workspace image.

**Independent Test**: Against the fake ComfyUI, run a transformation and confirm the canvas becomes
magenta, then confirm a second run can start from that result. No GPU, no live instance.

### Tests for User Story 2 (MANDATORY — write first, MUST fail) ⚠️

- [ ] T028 [P] [US2] Write `tests/unit/workflow.test.ts`: `parseManifest` rejects missing required fields naming the workflow and field; `validateWorkflow` throws `WorkflowConfigError` naming an absent node id and listing the ids that do exist; throws a **distinct** message when the target input is driven by a link (`"seed": ["10", 0]`) telling the user which node to point at instead; detects a UI-format export by its top-level `nodes` array and names the Export (API) menu item; `patchWorkflow` injects filename, prompt, and seed at the declared ids, resolves default input names (`image`; `prompt` then `text`; `seed` then `noise_seed`), **does not mutate the input graph**, and **refuses to create an input key that does not already exist** (FR-033).
- [ ] T029 [P] [US2] Write `tests/unit/comfyEvents.test.ts` over recorded message fixtures: `progress` and `progress_state` produce identical progress values; `execution_success` and legacy `executing {node: null}` are both terminal; `execution_error` sets phase `error` carrying `exception_message`; messages bearing a foreign `prompt_id` are ignored; `status` (which has no `prompt_id`) is **not** filtered out; binary frames are dropped; `applyHistory` treats `{}` as not-yet-complete rather than as failure; `selectOutputImage` keeps `type: 'output'` and skips `type: 'temp'` previews.
- [ ] T030 [US2] Write the happy path in `tests/e2e/us2-transform.spec.ts`: load the fixture, draw a mark, select `passthrough`, enter an instruction, run, wait for `run-status[data-phase="done"]`, and assert the centre pixel is magenta `[255,0,255]`. Then draw on the result and run again, asserting the second run's upload contained the marks.
- [ ] T031 [US2] Extend `tests/e2e/us2-transform.spec.ts` with the failure and variant cases: the legacy protocol dialect via `POST /__test/config` reaching the same result (spec AS 2); a queue rejection surfacing the service's message verbatim in `run-error` with the canvas unchanged (AS 5, FR-025); an unreachable service (AS 6); `btn-run` disabled while a run is in progress (AS 4, FR-022); a malformed manifest injected with `page.route` rendering `workflow-error` and disabling `btn-run` (AS 7, FR-032) — **injected through the network so no test-only code path exists in the app**; and progress reported in `stepped` mode asserting `run-progress[data-value]` without any timeout wait.
- [ ] T032 [US2] Extend `tests/e2e/us2-transform.spec.ts` with the two resilience cases that justify the runner's design, using the fake's knobs from T011: **(a) timeout (FR-026)** — configure the fake never to complete, set a short run timeout, and assert `run-status` reaches `error` with a timeout message and the canvas unchanged; **(b) dropped progress channel (FR-027)** — configure `dropWsAfter` so the WebSocket dies mid-run, and assert the run still reaches `done` with the correct magenta pixel. Case (b) is the direct proof that `/history` polling is the authority and the socket is cosmetic — without it, that decision is asserted nowhere.
- [ ] T033 [US2] Extend `tests/e2e/us2-transform.spec.ts` with seed behaviour (FR-028): run twice with `seed-lock` unchecked and assert via `GET /__test/queued` that the two queued graphs carry different seeds; then check `seed-lock`, run twice more, and assert those two seeds match.
- [ ] T034 [US2] Run the suite and **confirm T028–T033 all fail** for the right reasons before implementing.

### Implementation for User Story 2

- [ ] T035 [P] [US2] Implement `src/core/workflow.ts` to make T028 pass — `parseManifest`, `validateWorkflow`, `patchWorkflow` (via `structuredClone`), `randomSeed(rng?)` with an injectable generator so tests stay deterministic, and `WorkflowConfigError`.
- [ ] T036 [P] [US2] Implement `src/core/comfyEvents.ts` to make T029 pass — `initialRunState`, `applyWsMessage`, `applyHistory`, `selectOutputImage`, `isTerminal`. Handle **both** progress dialects and **both** completion signals; this is the module that decides whether the app works against an unknown ComfyUI version.
- [ ] T037 [US2] Implement `src/comfy/client.ts`: `uploadImage` (multipart, field `image`, unique filename, **never set `Content-Type`**), `queuePrompt` (surfacing the 400 body verbatim as `ComfyApiError`), `getHistory`, `viewUrl`, `fetchImageBlob`, `comfyWsUrl`, and `loadWorkflows` (fetch manifest, fetch each graph, validate all, throw `WorkflowConfigError` on any failure).
- [ ] T038 [US2] Implement `src/comfy/runner.ts` — `runWorkflow(args, onState)`: mint one `clientId` used as both `client_id` (body) and `clientId` (query); open the WebSocket best-effort with failures swallowed; upload; patch; queue; then **race the WebSocket against a 1500 ms `/history` poll, with the poll as the authority** (FR-027); select the output image; fetch the blob. Enforce `timeoutMs` (default 300 000, short in E2E) ending in a reported timeout (FR-026).
- [ ] T039 [P] [US2] Implement `src/ui/TransformPanel.tsx`: `workflow-select` populated in manifest order, `prompt-input`, `seed-input`, `seed-lock`, `btn-run`, `run-status` carrying `data-phase`, `run-progress` carrying `data-value`, and the `run-error` and `workflow-error` banners.
- [ ] T040 [US2] Wire the run into `src/ui/useEditor.ts`: composite the canvas with `toBlob` (FR-020), start the run, stream `RunState` into the UI, and on success set the result as the new base image and **`rebase` the document so marks are cleared** (FR-023). Leave the workspace image untouched on any failure (FR-025, FR-026).
- [ ] T041 [US2] Load and validate workflows at app start (FR-031): render `workflow-error` naming the workflow and the problem, and disable `btn-run`, whenever validation fails or no workflows are configured (FR-032).
- [ ] T042 [P] [US2] Implement seed behaviour: randomise per run by default, reuse when `seed-lock` is checked (FR-028). Without this, an identical re-run returns ComfyUI's cached image and reads as a broken app.
- [ ] T043 [US2] Run the full suite and confirm US1 and US2 are both green.

**Checkpoint**: User Stories 1 AND 2 both work independently; each story's unit tests AND E2E test pass; the full suite is green.

---

## Phase 5: User Story 3 - Return to an earlier image (Priority: P3)

**Goal**: Every image the workspace has held is listed and one click away, with its origin recorded.

**Independent Test**: Run two transformations against the fake, confirm three entries exist, select
the first, and confirm the original image is back and all three entries remain.

### Tests for User Story 3 (MANDATORY — write first, MUST fail) ⚠️

- [ ] T044 [P] [US3] Write `tests/unit/history.test.ts`: `addEntry` appends **and** selects (FR-034, FR-036); `selectEntry` with an unknown id **throws**; `currentEntry` returns null on empty; `nextGenerationLabel` numbers per workflow; entries are never removed by selection (FR-038); ids and timestamps are caller-supplied so assertions are plain equality.
- [ ] T045 [US3] Write `tests/e2e/us3-history.spec.ts` covering spec Acceptance Scenarios 1–6: one entry after loading, marked current; three entries in order after two runs with the newest current; each generated entry exposing its workflow, instruction, and seed (FR-035); selecting the first restores that image at its own dimensions with all three entries still listed; branching from an earlier entry appends without removing anything; and selecting an entry with uncommitted marks discards them and disables undo (FR-039).
- [ ] T046 [US3] Run the suite and **confirm T044–T045 fail** before implementing.

### Implementation for User Story 3

- [ ] T047 [P] [US3] Implement `src/core/history.ts` to make T044 pass — `emptyHistory`, `addEntry`, `selectEntry`, `currentEntry`, `nextGenerationLabel`. Ids, timestamps, and object URLs are all passed in, never generated inside `core/`.
- [ ] T048 [P] [US3] Implement `src/ui/HistoryStrip.tsx`: entries oldest-first, each with `data-entry-id` and `data-selected`, exposing workflow, instruction, and seed as accessible text.
- [ ] T049 [US3] Wire history into `src/ui/useEditor.ts`: add an entry when an image is loaded (`origin: upload`) and after each successful run (`origin: generation` with workflow, prompt, seed, and promptId); on selection, restore the image, resize the canvas to that entry's dimensions, and `rebase` the document (FR-037, FR-039).
- [ ] T050 [US3] Run the full suite and confirm all three stories are green.

**Checkpoint**: All user stories are independently functional; every story's unit tests AND E2E test pass; the full suite is green.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T051 [P] Write `README.md` documenting `npm test` as **the** single command, with the `npm ci && npx playwright install chromium` prerequisites (Principle III requires this be documented, not merely possible). Include the add-a-workflow procedure and the troubleshooting table from [quickstart.md](./quickstart.md).
- [ ] T052 [P] Add the `@live` test to `tests/e2e/us2-transform.spec.ts`, skipped unless `COMFY_LIVE=1`, with a 240 s timeout, reusing `runTransformFlow` from `helpers.ts`. It asserts only that the canvas **changed** — never an exact color — because a real model's output is not deterministic.
- [ ] T053 Verify SC-007 by exercising it rather than describing it: add a second manifest entry pointing at a copy of the passthrough graph under a new id, assert both workflows appear in `workflow-select`, and assert `git diff --stat -- src/` is empty. This is the claim most likely to rot silently, since the whole manifest design exists to make it true.
- [ ] T054 [P] Add a Vitest benchmark for SC-002: render 2000 shapes onto a 2048×2048 recording context and assert the per-frame budget holds. This turns the retained-mode decision (research.md D2) and the two-layer-canvas escape hatch into data rather than a guess.
- [ ] T055 Run `npm test` end to end and confirm it completes green in under 60 seconds (SC-009), needs no GPU or network, and writes `test-results/results.json`.
- [ ] T056 Self-check against `.specify/memory/constitution.md` as Governance requires: every test was written before its implementation and observed failing; every story has a passing E2E test; the suite runs unattended from one command; no dependency beyond the nine in T001 was added without a Complexity Tracking entry.
- [ ] T057 [P] Walk [quickstart.md](./quickstart.md) start to finish on a clean checkout and correct anything that does not match reality. Document in `README.md` that `qwen-2511.api.json` is user-supplied, with its commented manifest entry as a template — the app ships working on `passthrough` alone, and the GPU box is needed only for the first real generation.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup — **blocks all user stories**.
- **User Stories (Phases 3–5)**: all depend on Foundational. Sequential in priority order is the
  intended path for a single implementer; they are independent enough to parallelise if desired.
- **Polish (Phase 6)**: depends on all three stories.

### User Story Dependencies

- **US1 (P1)**: depends only on Foundational. Touches no ComfyUI code at all — verified by T027.
- **US2 (P2)**: depends only on Foundational. Consumes the composited canvas that US1 produces, so in
  practice it is built after US1; its own tests use the fake and the checked-in `passthrough`
  workflow, never a live instance. It calls `rebase`, which US1 specifies and implements (T016, T021).
- **US3 (P3)**: depends only on Foundational. Needs US2 in place to have generated images to list,
  but its pure `history.ts` logic is testable on its own.

### Within Each User Story

- Tests MUST be written and observed FAILING before any implementation task begins (Constitution I)
- Each story's E2E test MUST exist and pass before the story is marked complete (Constitution II)
- Pure `core/` modules before the `comfy/` and `ui/` layers that consume them
- Story complete before moving to the next priority

### Parallel Opportunities

- Setup: T005, T006, T007 together.
- Foundational: T008, T009, T012, T013 together; T010 → T011 are sequential (same file).
- US1: the three unit-test files T015–T017 together; then T020–T022 together; T025 alongside T024.
- US2: T028 and T029 together; then T035 and T036 together; T039 and T042 alongside T037–T038.
  T030–T033 all edit `us2-transform.spec.ts`, so they are sequential.
- US3: T044 and T047 pair; T048 alongside T047.
- Polish: T051, T052, T054, T057 together.

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (write these first, confirm they fail):
Task: "Write tests/unit/shapes.test.ts"
Task: "Write tests/unit/drawing.test.ts"
Task: "Write tests/unit/render.test.ts"

# Then, only after the red is confirmed, the three pure modules together:
Task: "Implement src/core/shapes.ts"
Task: "Implement src/core/drawing.ts"
Task: "Implement src/core/render.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup
2. Phase 2: Foundational — **do T014 early**; the proxy WebSocket question is the one unknown that
   could force a config change, and finding out after three stories are built is expensive
3. Phase 3: User Story 1
4. **STOP and VALIDATE**: T027 proves the editor works with no transformation service at all
5. This is a genuinely usable image markup tool on its own

### Incremental Delivery

1. Setup + Foundational → harness proven
2. US1 → a working drawing editor (MVP)
3. US2 → the draw-transform-draw loop, shippable on `passthrough` with the GPU off
4. US3 → safe exploration, since any transformation becomes reversible
5. Polish → docs, the live check, the SC-002 and SC-007 verifications, and the constitution self-check

### Notes

- [P] tasks touch different files and have no incomplete dependencies
- Verify tests fail before implementing — this is non-negotiable, not a suggestion
- The full suite (unit + E2E) MUST be runnable with a single documented command (Constitution III)
- Commit after each task or logical group
- Stop at any checkpoint to validate a story independently

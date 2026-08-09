# Implementation Plan: Draw-and-Transform Image Editor

**Branch**: `001-comfy-edit` | **Date**: 2026-08-09 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-comfy-edit/spec.md`

## Summary

A browser-based single-page image editor. The user brings in an image, marks it up with four vector
tools, then sends the composited result to a ComfyUI instance through a chosen workflow with a text
instruction; the generated image replaces the workspace image and becomes the new basis for drawing.
Every image the workspace has held is kept in a session history strip.

The approach has three load-bearing choices. **All non-trivial logic lives in a DOM-free, network-free
`src/core/`** so that the constitution's test-first mandate is satisfiable with fast unit tests rather
than browser automation. **ComfyUI is reached only through a same-origin `/comfy/*` dev-server proxy**,
which avoids CORS configuration on a remote instance and — more importantly — keeps generated images
same-origin so the canvas is never tainted and pixel reads keep working. **A fake ComfyUI server backs
the entire automated suite**, so the full test run needs no GPU, no network, and no live instance,
with one opt-in test against the real thing to catch protocol drift.

## Technical Context

**Language/Version**: TypeScript 5.9 with `strict: true`; Node.js 22 LTS for tooling and the test
double only. No application backend — the only server-side code in the repository is the dev server's
proxy configuration and the fake ComfyUI used by tests.

**Primary Dependencies**: React 19 + react-dom; Vite 7 (dev server, production build, and the
`/comfy` HTTP + WebSocket proxy). Dev-only: Vitest, Playwright (Chromium), `ws`. Deliberately
excluded per Principle IV: state-management library, UI/CSS framework, HTTP client, uuid library,
jsdom, React Testing Library.

**Storage**: None persisted. The drawing document and the image history live in memory for the
session; generated images are held as blobs behind object URLs. History does not survive a page
reload — an explicit decision recorded in the spec's Assumptions, not an oversight. Workflow
definitions are static JSON under `public/workflows/`, fetched at runtime.

**Testing**: Vitest for the pure-logic unit tests (`environment: 'node'` — no DOM emulation needed,
because `src/core/` touches no DOM). Playwright against Chromium for end-to-end. A fake ComfyUI
server (`tests/fake-comfy/server.mjs`) is started and torn down by Playwright's `webServer` with
URL-readiness probes, so the suite runs offline, deterministically, with no sleeps and no GPU cost.
One `@live` end-to-end variant exercises the same flow against a real ComfyUI when `COMFY_LIVE=1`.
Single documented command: **`npm test`**.

**Target Platform**: Desktop Chromium-based browsers, current version. Runs on the user's own
machine; there is no deployment target.

**Project Type**: Single-page web application, frontend only.

**Performance Goals**: Interactive drawing at 60 fps via a full canvas redraw per pointer move, for
images up to 2048×2048 (SC-002). Progress display reflects a transformation event within 500 ms. The
full offline suite completes in under 60 seconds (SC-009).

**Constraints**: ComfyUI is reached exclusively through the same-origin `/comfy/*` proxy, target from
`COMFY_URL` (default `http://127.0.0.1:8188`). Transformation correctness must not depend on the
WebSocket — `/history/<prompt_id>` polling is the authority and the socket is cosmetic. The client
must tolerate both ComfyUI progress dialects (`progress` and `progress_state`) and both completion
signals (`execution_success` and the legacy `executing` with `node: null`). Adding a workflow must
require no code change (FR-029, SC-007). ComfyUI is remote, billable, and frequently unavailable, so
no build, test, or dev-loop step may require it (SC-008, SC-009).

**Scale/Scope**: One local user, one browser tab, one image at a time. Four UI components, seven pure
modules, four drawing tools, one to three workflows, roughly 1500 lines of application code. Session
history of tens of images.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Gates derived from `.specify/memory/constitution.md` v1.0.1:

| Gate | Principle | Status | How this design satisfies it |
|---|---|---|---|
| Test-first is possible for all non-trivial logic | I | **PASS** | `src/core/` is pure — no DOM, no network, no React — so every interesting behaviour (geometry, undo/redo, history, workflow patching, the ComfyUI protocol) is a plain function testable with Vitest before any implementation exists. The React and I/O layers are deliberately thin wiring with no branching logic to hide bugs in. |
| Every user-facing feature has an E2E test | II | **PASS** | One Playwright spec per user story (`us1-drawing`, `us2-transform`, `us3-history`), each driving the real browser, real canvas pixels, and a real WebSocket. Assertions read actual pixel values, which is only possible because the proxy keeps images same-origin. |
| Agent can drive it unattended | III | **PASS** | `npm test` runs typecheck, unit, and E2E; Playwright's `webServer` starts and stops both the fake ComfyUI and the dev server using URL-readiness probes, so there are no sleeps and no manual setup. Test IDs live in `src/testids.ts`, imported by both components and specs, so a renamed selector is a compile error rather than a silently-skipped test. A JSON reporter writes `test-results/results.json` by default. |
| Deterministic setup/teardown | III | **PASS** | The fake exposes `POST /__test/reset` (called in `beforeEach`) and `POST /__test/config`, including a `stepped` mode that emits nothing until the test asks for the next step — so progress assertions cannot race. No IndexedDB, so there is no cross-test state to leak. |
| Simplest thing that works | IV | **PASS** | No backend service, no state library, no CSS framework, no HTTP client, no jsdom, no component-test layer. Nine packages total. Two designs were chosen specifically because they are *less* code as well as more testable: retained-mode drawing over a pixel-snapshot stack, and racing a poll against the WebSocket over a reconnect state machine. One devDependency (`ws`) is justified below. |
| No backwards-compatibility burden | V | **PASS** | Nothing is persisted and there are no external consumers, so no migration or compatibility surface exists. |

**Post-Phase-1 re-check**: PASS, unchanged. The Phase 1 design added `contracts/` and `data-model.md`
without introducing a new dependency, service, or abstraction layer. The one dependency flagged for
justification (`ws`) is recorded in Complexity Tracking below.

## Project Structure

### Documentation (this feature)

```text
specs/001-comfy-edit/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions, rationale, alternatives
├── data-model.md        # Phase 1 output — entities and state transitions
├── quickstart.md        # Phase 1 output — run it, test it, point it at real ComfyUI
├── contracts/
│   ├── comfyui-api.md   # The external ComfyUI contract this client depends on
│   ├── workflow-manifest.md  # The user-authored workflow configuration format
│   └── ui-contract.md   # Test IDs and observable UI states
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
index.html
package.json
tsconfig.json
vite.config.ts                    # proxy (server + preview) and Vitest config in one file
playwright.config.ts
.env.example                      # COMFY_URL=http://127.0.0.1:8188
README.md                         # documents `npm test` as THE command (Principle III)

public/workflows/
├── manifest.json                 # the dropdown's source of truth
├── passthrough.api.json          # checked in now; carries US2 with no GPU
└── qwen-2511.api.json            # user-supplied later, no code change

src/
├── main.tsx
├── App.tsx
├── testids.ts                    # single source of truth, imported by components AND specs
├── styles.css
├── core/                         # PURE — no DOM, no network, no React. Unit-tested.
│   ├── types.ts                  # Point, Shape, ToolId, Size
│   ├── shapes.ts                 # beginShape, extendShape, normalizeRect, toCanvasPoint
│   ├── drawing.ts                # DrawingDoc; commitShape, undo, redo, clearShapes, rebase
│   ├── render.ts                 # drawShape over a structural Ctx2D interface
│   ├── history.ts                # HistoryState; addEntry, selectEntry, currentEntry
│   ├── workflow.ts               # parseManifest, validateWorkflow, patchWorkflow
│   └── comfyEvents.ts            # the ComfyUI protocol as a pure reducer
├── comfy/                        # I/O — E2E-tested
│   ├── client.ts                 # upload, queue, history, view, loadWorkflows
│   └── runner.ts                 # runWorkflow — orchestrates one transformation
└── ui/                           # React — E2E-tested
    ├── useEditor.ts              # one useReducer; every mutation delegates to core/
    ├── CanvasStage.tsx
    ├── Toolbar.tsx
    ├── TransformPanel.tsx
    └── HistoryStrip.tsx

tests/
├── fixtures/base.png             # 256×256 solid teal
├── unit/                         # one file per core module
│   ├── shapes.test.ts  drawing.test.ts  render.test.ts
│   └── history.test.ts workflow.test.ts comfyEvents.test.ts
├── e2e/
│   ├── us1-drawing.spec.ts  us2-transform.spec.ts  us3-history.spec.ts
│   └── helpers.ts
└── fake-comfy/server.mjs         # plain ESM so Playwright runs it with `node` directly
```

**Structure Decision**: Single project, frontend only — the spec's Assumptions rule out accounts,
sharing, persistence, and deployment, so there is nothing for a backend to do. The meaningful
structural decision is not `src/` versus `frontend/`, it is the **`core/` boundary**: `core/` imports
nothing from the DOM, the network, or React, which is what makes Principle I's test-first requirement
practical rather than ceremonial. `comfy/` and `ui/` are wiring thin enough that E2E coverage is
sufficient for them.

## Complexity Tracking

> Filled only for choices that need justification against Principle IV.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `ws` devDependency | The fake ComfyUI must serve a WebSocket endpoint; Node 22 ships a WebSocket *client* but no server. | Hand-rolling the RFC 6455 handshake and frame writer is ~40 lines and genuinely doable, but it is exactly the kind of cleverness that produces intermittent failures. The constitution's Testing & Quality Gates say flaky tests must be fixed or deleted immediately, which weights reliability above dependency count here. |
| Two test runners (Vitest + Playwright) | Pure logic needs fast, DOM-free unit tests (Principle I); canvas pixels and a real WebSocket need a real browser (Principle II). Neither runner covers both well. | A single Playwright-only suite would make every unit test a browser test — slow, and it would push `core/` logic behind UI automation, undermining test-first. A single Vitest-only suite cannot honour Principle II at all. Note this *removes* a layer rather than adding one: jsdom and React Testing Library are both excluded. |
| `@types/node` devDependency (added during implementation — the plan said nine packages, this is the tenth) | `vite.config.ts`, `playwright.config.ts`, the E2E helpers and the fake server all run in Node and use `process`, `node:url`, and `node:fs`. Without it `npm run typecheck` fails, so the single-command gate in Principle III cannot pass. | Declaring `process` and friends by hand, or dropping the config files out of `tsconfig`'s `include`, would both trade a type-only dependency for silently untypechecked build configuration. Type-only, zero runtime weight. |

### Other deviations recorded per Governance

- **`workers: 1` in `playwright.config.ts`.** Not a dependency, but a deliberate constraint: one fake
  ComfyUI holds all queue and history state and every spec resets it in `beforeEach`, so parallel
  workers wipe each other mid-test. This was found as a real cross-file flake, not assumed. The
  alternative — a fake per worker — is more machinery than a 38-second suite justifies.
- **`runSeq` / `data-run-seq` on the run status element.** Added because a test needed to distinguish
  *this* run's completion from the previous one's, which are otherwise identical. It is honest
  observable state ("which run is this"), not a test-only branch in the application.

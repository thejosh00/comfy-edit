# Phase 0 Research: Draw-and-Transform Image Editor

**Feature**: `001-comfy-edit` | **Date**: 2026-08-09

The Technical Context in [plan.md](./plan.md) contains no `NEEDS CLARIFICATION` markers — the stack,
the ComfyUI access path, the workflow configuration format, and the testing strategy were all settled
with the user before planning began. This document records those decisions with their rationale and
the alternatives rejected, plus the external-protocol research that the design depends on.

---

## D1. Application shape: frontend-only SPA with a dev-server proxy

**Decision**: React + TypeScript + Vite single-page app, no backend service. ComfyUI is reached
through a same-origin `/comfy/*` path that the Vite dev server proxies to `COMFY_URL`.

**Rationale**: Two things fall out of the proxy, and the second is the one that is easy to miss.
First, ComfyUI needs no `--enable-cors-header` flag and no configuration change — which matters
because the instance is remote and managed outside this project. Second, **generated images arrive
same-origin, so the canvas is never tainted**. A cross-origin `drawImage` silently poisons the
canvas, after which both `getImageData` (the end-to-end pixel assertions) and `toBlob` (the next
upload in the draw-transform-draw loop) throw `SecurityError`. The proxy is load-bearing for
correctness and testability, not merely for convenience.

`vite preview` ignores `server.proxy`, so the same proxy object is also assigned to `preview.proxy`.
That removes the only reason to write a separate Node static server, so `npm start` is just
`vite build && vite preview`.

**Alternatives considered**:
- *Frontend plus a Node/Express backend that owns the ComfyUI client.* Rejected: a second process to
  start in every test run and a second deployment surface, buying a seam the spec's Assumptions
  explicitly say will not be used (no persistence, no sharing, no multi-user).
- *Python/FastAPI backend with a thin JS canvas frontend.* Rejected: the drawing editor is the larger
  half of this application and lives in JavaScript regardless, so a Python backend adds a language
  boundary without removing any JavaScript.
- *Browser talking to ComfyUI directly with `--enable-cors-header`.* Rejected: requires changing
  configuration on a remote instance the user rebuilds from a filesystem snapshot, and it taints the
  canvas, which breaks the pixel assertions that make the E2E suite meaningful.

**Known risk**: `ws: true` combined with `rewrite` is version-dependent in `http-proxy` — the HTTP
*upgrade* request may reach ComfyUI as `/comfy/ws` rather than `/ws`. This is not worth reasoning
about in the abstract; it is made the first assertion the E2E suite makes, and the fake server logs
the path it actually received so a mismatch is diagnosed in one run. Fallback if it bites: a
`configureServer` hook handling `httpServer.on('upgrade')` manually, roughly ten lines.

---

## D2. Drawing model: retained mode, flattened by each transformation

**Decision**: The document is a base image plus an ordered list of shapes, fully re-rendered each
frame. Undo and redo move shapes between a `shapes` list and an `undone` list. A completed
transformation *rebases*: the result becomes the new base image and both lists are emptied.

**Rationale**: The decisive argument is Principle I. Undo and redo become five lines of pure,
DOM-free code, so the behaviour the constitution most wants under test-first discipline is a plain
unit test. A pixel-snapshot stack needs `getImageData`/`putImageData` per stroke, which cannot be
unit-tested without a real canvas — it would push undo/redo behind browser automation, exactly
backwards.

Three lesser arguments point the same way. Memory: a 1024×1024 RGBA snapshot is 4 MB, so twenty undo
levels is 80 MB and needs a depth cap and an eviction policy; a shape list is a few kilobytes and
needs no policy. The ComfyUI hand-off is free, because `canvas.toBlob()` already contains base and
shapes composited exactly as the user sees them (FR-020) with no separate flatten step. And rebasing
is *correct*, not merely convenient: after a run the strokes are baked into the pixels the model
consumed, so keeping them as live vectors would double-draw them over the result. FR-023 requires
exactly this behaviour.

**Cost, stated plainly**: no true pixel tools. An eraser would have to be a `destination-out` stroke,
and fill or blur do not fit this model at all. The spec's Assumptions already scope those out.

**Alternatives considered**:
- *Destructive painting with an image-snapshot undo stack.* Rejected for the reasons above.
- *Two canvases (committed strokes static, in-flight shape on an overlay).* Rejected as premature: a
  full redraw of a few thousand points at 1024² is well under a millisecond, so 60 fps is not at
  risk. Recorded as the escape hatch if SC-002 is ever missed; one canvas also keeps the E2E story
  to a single element, a single `toBlob`, and a single `getImageData`.

---

## D3. History: in-memory only, not persisted

**Decision**: History entries hold a blob object URL plus metadata, live in React state, and are lost
on reload. No IndexedDB, no localStorage.

**Rationale**: Beyond the schema, async open, and quota handling, IndexedDB has a **teardown
problem**. Playwright's context isolation does not clear IndexedDB the way it clears cookies, so
every `beforeEach` would need an explicit `deleteDatabase`, and any leak becomes a
cross-test-contamination bug. That runs directly against Principle III's "deterministic setup and
teardown" and against Principle IV. Losing history on reload is a fine cost for a personal tool where
the source image is still a file on disk and results are cheap to regenerate.

Entries are never removed, so object URLs are never revoked. At roughly 1–2 MB per generated PNG,
fifty generations is about 75 MB — acceptable for a session. Unbounded growth over a very long
session is a real but minor risk; the fix (cap at fifty, evict oldest and revoke) is six lines and is
deliberately not built now.

`parentId` is recorded on every entry even though the strip renders flat and chronological. It costs
one field and makes "which image did this come from?" answerable. Tree visualisation is explicitly
not built.

**Alternatives considered**: IndexedDB persistence (rejected above; if ever wanted, the least-bad
shape is one object store, one "clear history" button, and a `deleteDatabase` in test teardown).
localStorage (rejected: a 5 MB quota holds two or three generated images).

**Related UX decision**: selecting a history entry discards uncommitted marks with no confirmation
dialog (FR-039). A modal is real E2E surface for little benefit, and nothing in *history* is lost —
only in-progress marks. Recorded as deliberate.

---

## D4. Workflow configuration: one manifest, patch only existing inputs

**Decision**: A single `public/workflows/manifest.json` lists each workflow with an `id`, a display
`label`, the API-format JSON `file`, and the node IDs that receive the image, the prompt, and the
seed. `patchWorkflow` deep-clones the graph and writes those three values.

**Rationale for a manifest over sibling meta files**: static hosting gives no directory listing, so
sibling files would need to be enumerated some other way. A manifest is one fetch, one parse, one
validation path, and it makes dropdown order explicit.

**The most important rule in this layer: only ever overwrite an input key that already exists.** That
guarantees the client never invents a field ComfyUI will reject, and — far more importantly — it
converts "wrong node ID in the manifest" from a silent no-op that returns an unedited image into a
loud, precise error. A silent no-op presents to the user as "the model ignored my prompt", and
diagnosing that against a billable remote GPU is expensive. FR-033 requires this behaviour.

**Links must be rejected, not overwritten.** In exported API JSON, an input driven by another node is
an array: `"seed": ["10", 0]`. Writing a number over that silently breaks the graph. Validation
checks `!Array.isArray(...)` and reports which node to point at instead. This is a common, real
consequence of exporting a graph that uses a primitive or seed-generator node.

**Detecting the wrong export format matters more than it looks.** A UI-format export has a top-level
`nodes` array; the API format is a flat object keyed by node ID. Confusing the two is the single most
common mistake, so validation names it explicitly and tells the user to use Workflow → Export (API).

**Seed defaults to random per run, with a lock for reproducibility** (FR-028). ComfyUI caches by graph
content, so re-running an identical graph returns the cached image instantly, which reads as "the app
is broken".

**Alternatives considered**:
- *Auto-detect nodes by `class_type`.* Rejected: guesses wrong whenever a graph has two text encoders
  or an img2img chain, and it fails silently — the worst possible failure mode here.
- *Fetch saved workflows from the running ComfyUI's userdata.* Rejected: couples the dropdown to a
  live instance (violating SC-008/SC-009), and ComfyUI's saved format is the UI format, not the API
  format the `/prompt` endpoint needs.

---

## D5. ComfyUI protocol: poll for truth, socket for progress

**Decision**: After `POST /prompt` succeeds, start both watchers and race them. The WebSocket is
**cosmetic** — node name, progress percentage, early error text. Polling `GET /history/<prompt_id>`
every 1500 ms is the **authority** for completion. Whichever reaches a terminal state first wins; the
other is cancelled.

**Rationale**: If the socket never opens, drops mid-run, or speaks a protocol dialect this client did
not anticipate, the transformation still completes correctly and only the progress bar is lost — which
is exactly FR-027. This is also *less* code than a reconnect-and-backoff state machine, so it is a
Principle IV win as well as a robustness one, and it makes the E2E suite immune to WebSocket timing.

**Protocol research — the version-sensitive part.** ComfyUI has two dialects in the wild and the
remote instance's version is unknown:

| Concern | Current builds | Older builds |
|---|---|---|
| Progress | `progress_state` with a `nodes` map | `progress` with `{value, max, node}` |
| Completion | `execution_success` | `executing` with `node: null` |

Current ComfyUI emits `progress_state` and does not emit `progress` at all; older builds do the
reverse. Likewise, current builds send `executing` only with a real node ID and signal completion via
`execution_success`, while older builds signalled completion with a null node. **Both dialects of both
concerns are handled**, and the fake server can emit either on demand so one E2E proves it. This is
precisely the class of bug that works locally and hangs against the real instance.

**Traps encoded as tests** (details in [contracts/comfyui-api.md](./contracts/comfyui-api.md)):
- `GET /history/<id>` returns `{}` with **HTTP 200** while queued or running — poll must test for the
  key, not for `response.ok`.
- `outputs` also contains `PreviewImage` entries with `"type": "temp"`; only `"type": "output"` is the
  result, or the user sees a low-resolution preview instead.
- `client_id` (snake_case, POST body) and `clientId` (camelCase, WS query) must carry the same value.
- Never set `Content-Type` manually on the upload — the browser must generate the multipart boundary.
  This is the most common upload failure.
- Surface the `POST /prompt` 400 body verbatim: that is where "value not in list:
  qwen_image_edit_2511_bf16.safetensors" — meaning the model is not on the GPU box — appears. FR-025
  requires the service's own reason, and a generic "run failed" here costs a GPU-hour of confusion.

**Explicitly cut from v1**: binary WebSocket preview frames (live sampler previews). The frame layout
is a four-byte big-endian event type, then a format code, then raw image bytes, with a metadata
variant. Genuinely nice, genuinely non-trivial; non-string messages are dropped. Recorded as a
follow-up, not an omission.

---

## D6. Testing: fake ComfyUI for everything, one opt-in live check

**Decision**: `tests/fake-comfy/server.mjs` implements the ComfyUI endpoints this client uses, plus
test-control endpoints. Playwright's `webServer` starts and stops it with a URL-readiness probe. One
`@live` spec runs the same flow against a real instance when `COMFY_LIVE=1`.

**Rationale**: The real instance is remote, billable at roughly $2.29/hour, slow, frequently down,
and non-deterministic. Depending on it would make the suite unrunnable unattended (violating
Principle III and SC-009) and flaky (which the constitution says must be fixed or deleted
immediately). But testing *only* against a fake means nothing ever verifies the real contract, so
format drift would go unnoticed until manual use — hence the opt-in live variant, which asserts only
that the canvas *changed*, since a real model's output is not deterministic.

**The fake is a contract test, not a stub.** It asserts the upload field is named `image`, that no
`Content-Type` was hand-set, and that the image filename referenced in the queued graph actually
exists in its upload map — so a broken `patchWorkflow` fails loudly instead of quietly producing
output.

**Determinism without sleeps** comes from test-control endpoints: `POST /__test/reset` in
`beforeEach`, and `POST /__test/config` selecting `mode: 'instant' | 'stepped'`, the progress dialect,
the completion signal, and failure injection. In `stepped` mode the server emits nothing until the
test asks for the next step, so a progress assertion cannot race.

**Unambiguous pixel assertions**: the fake generates its output PNG at request time with a small
encoder over `node:zlib.deflateSync` — zero dependencies, fully deterministic — emitting **solid
magenta** at the input's dimensions. Paired with a **solid teal** fixture image, "did the pipeline
actually run?" becomes a single centre-pixel read. This only works because of the same-origin proxy
from D1.

**Alternatives considered**: always testing against real ComfyUI (rejected: unattended runs
impossible, GPU cost per run, flaky by construction); fake only (rejected: never verifies the real
contract).

---

## D7. Test runners: Vitest and Playwright, nothing else

**Decision**: Vitest for `src/core/` with `environment: 'node'`; Playwright/Chromium for end-to-end.
No jsdom, no React Testing Library.

**Rationale**: Vitest reuses the Vite config and TypeScript pipeline, so it costs no additional
configuration. Because `src/core/` is DOM-free by construction, the unit tests need no DOM emulation
at all — jsdom is simply not required. Component-level behaviour is already mandated to be E2E-covered
by Principle II, so adding React Testing Library would introduce a third testing paradigm covering
ground the E2E suite must cover anyway. This decision *removes* two dependencies and one whole layer.

The renderer is still unit-tested without a canvas: `drawShape` takes a structural `Ctx2D` interface
that `CanvasRenderingContext2D` satisfies, and tests pass a fifteen-line recording fake and assert the
emitted command sequence.

**Single command**: `npm test` = typecheck → Vitest → Playwright, where Playwright boots and tears
down both the fake ComfyUI and the dev server. Prerequisites are `npm ci` and
`npx playwright install chromium`, documented in the README as Principle III requires.

---

## D8. Deferred decisions, recorded so they are not rediscovered

| Deferred | Trigger to revisit | Least-bad shape when it arrives |
|---|---|---|
| History persistence across reload | User asks for it | One IndexedDB object store, a "clear history" button, `deleteDatabase` in test teardown |
| Live sampler preview frames | User wants to watch generation | Decode binary WS frames, draw to an overlay canvas |
| Object-URL eviction | A session exceeds a few hundred generations | Cap at 50 entries, FIFO evict and revoke |
| Two-layer canvas | SC-002 (60 fps) is missed in practice | Static committed-strokes canvas plus an in-flight overlay |
| Eraser tool | User asks | `globalCompositeOperation: 'destination-out'` stroke — fits the retained model |

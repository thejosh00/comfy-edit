# Contract: ComfyUI HTTP + WebSocket API

**Direction**: this application is the *client*. ComfyUI owns this contract; we conform to it.

The fake server in `tests/fake-comfy/server.mjs` implements exactly this surface, which is what makes
it a contract test rather than a stub. If a behaviour is not written down here, the fake must not
rely on it.

All paths are prefixed with `/comfy` from the browser's point of view; the dev server strips the
prefix and forwards to `COMFY_URL`. Everything below describes the request as ComfyUI receives it.

## 0. The `Origin` header — required on every route

ComfyUI 0.31+ answers **403 to any request carrying an `Origin` header that is not its own host** —
every route, not just writes, and regardless of method. A request with no `Origin` at all (curl,
server-to-server) is accepted.

The proxy must therefore rewrite `Origin` to the target's origin, on both HTTP requests and the
WebSocket upgrade. **`changeOrigin: true` is not sufficient** — it rewrites `Host` and leaves
`Origin` exactly as the browser set it, which is the failing combination.

Verified against ComfyUI 0.31.0: `POST /upload/image` with `Origin: http://127.0.0.1:5174` → 403;
the identical request with `Origin: http://127.0.0.1:8188` → 200.

The fake server enforces the same rule, so a proxy that forwards the browser's `Origin` fails the
offline suite rather than only failing against a real instance.

---

## 1. `POST /upload/image` — send the composited canvas

**Request**: `multipart/form-data`

| Field | Value |
|---|---|
| `image` | the PNG blob, with a filename |
| `type` | `input` |

```ts
const fd = new FormData()
fd.append('image', blob, `comfy-edit-${stamp}.png`)
fd.append('type', 'input')
await fetch('/comfy/upload/image', { method: 'POST', body: fd })   // no Content-Type header
```

**Response** `200`: `{ "name": "comfy-edit-1754.png", "subfolder": "", "type": "input" }`
Newer builds add an `asset` object; ignore it.

The value written into the graph's image input is `subfolder ? \`${subfolder}/${name}\` : name`. This
client never sends a subfolder, so it is always just `name` — one fewer string join to get wrong.

**Two rules the fake enforces:**
1. **Never set `Content-Type` manually.** The browser must generate the multipart boundary; setting
   the header by hand is the most common cause of upload failure.
2. **Use a unique filename per upload.** With a stable name, cache-busting depends on ComfyUI hashing
   the file contents in `LoadImage.IS_CHANGED`. It does work, but unique names remove the question.

---

## 2. `POST /prompt` — queue the patched graph

**Request**:
```json
{ "prompt": { "3": { "class_type": "KSampler", "inputs": { } } },
  "client_id": "3f2a…-uuid" }
```

**Response** `200`: `{ "prompt_id": "uuid", "number": 7, "node_errors": {} }`

**Response** `400`:
```json
{ "error": { "type": "…", "message": "…", "details": "…" },
  "node_errors": { "12": "…" } }
```

**The 400 body must be surfaced to the user verbatim** (FR-025). This is where "value not in list:
qwen_image_edit_2511_bf16.safetensors" appears — meaning the model is not present on the GPU box —
and it is the single most useful diagnostic the application can show. A generic "run failed" here
costs an hour of confusion against a billable instance.

**Casing trap**: `client_id` here is snake_case in the POST body; the WebSocket query parameter below
is camelCase `clientId`. Same value, different spelling. Derive both from one `crypto.randomUUID()`.

---

## 3. `GET /ws?clientId=<uuid>` — progress, and progress only

```ts
const url = `${location.origin.replace(/^http/, 'ws')}/comfy/ws?clientId=${clientId}`
```

Text frames are `{ "type": "<name>", "data": { … } }`.

| `type` | Payload | Client use |
|---|---|---|
| `status` | `{ status: { exec_info: { queue_remaining } } }` | queue depth. **No `prompt_id` — never filter it out** |
| `execution_start` | `{ prompt_id }` | phase → running |
| `executing` | `{ node, display_node, prompt_id }` | current node name |
| `executing` *(legacy)* | `{ node: null, prompt_id }` | **terminal** — older builds' only completion signal |
| `progress` *(legacy)* | `{ value, max, node, prompt_id }` | `value / max` |
| `progress_state` *(current)* | `{ prompt_id, nodes: { id: { value, max, state } } }` | sum over nodes with `state === 'running'` |
| `executed` | `{ node, output: { images: [ … ] }, prompt_id }` | fast path to the result |
| `execution_success` | `{ prompt_id }` | terminal (current builds) |
| `execution_error` | `{ prompt_id, node_id, exception_message, traceback }` | terminal failure; show `exception_message` |
| `execution_interrupted` | `{ prompt_id, node_id }` | terminal cancel |

**Both dialects are mandatory.** Current ComfyUI emits `progress_state` and never `progress`, and
signals completion with `execution_success`; older builds do the opposite on both counts. The remote
instance's version is unknown and rebuilt from a filesystem snapshot, so a client that handles only
one dialect works locally and hangs against the real box. The fake's `POST /__test/config` switches
dialects so a single E2E proves both.

**Filter every message by `data.prompt_id === myPromptId`**, except `status`, which has none. A reused
client id across tabs otherwise delivers another tab's events.

**Binary frames are dropped.** The layout is a four-byte big-endian event type, then a format code,
then raw JPEG/PNG bytes (with a JSON-prefixed metadata variant). Live sampler previews are out of
scope for v1 — an explicit cut, recorded in research.md D5.

**This channel is cosmetic.** Nothing about correctness may depend on it (FR-027).

---

## 4. `GET /history/<prompt_id>` — the authority

```json
{ "<prompt_id>": {
    "outputs": { "9": { "images": [ { "filename": "comfy-edit_00001_.png",
                                      "subfolder": "", "type": "output" } ] } },
    "status": { "status_str": "success", "completed": true } } }
```

**Two traps, both encoded as unit tests:**

1. **While queued or running this returns `{}` with HTTP 200** — an empty object, not a 404. The poll
   must test for the presence of the `prompt_id` key, never for `response.ok`.
2. **`outputs` also contains `PreviewImage` results with `"type": "temp"`.** Selection keeps only
   `type === "output"` and takes the last one; otherwise the user is shown a low-resolution preview
   in place of the actual result.

Polled every 1500 ms until terminal or until the bounded wait expires (`RUN_TIMEOUT_MS`, default
300 000, overridden to 15 000 in E2E). This poll — not the WebSocket — decides that a run finished.

---

## 5. `GET /view?filename=&subfolder=&type=output` — fetch the result

Returns the image bytes. Always send `subfolder`, even when empty.

The response must arrive **same-origin** through the proxy. A cross-origin fetch here taints the
canvas, after which `getImageData` (the E2E pixel assertions) and `toBlob` (the next upload in the
draw-transform-draw loop) both throw `SecurityError`. The proxy is load-bearing for correctness, not
just for CORS convenience.

---

## 6. `GET /system_stats` — readiness probe

Used only by Playwright's `webServer` to know the fake has bound its port. Contents are ignored.

---

## Test-only endpoints (fake server only — never called by the application)

| Endpoint | Purpose |
|---|---|
| `POST /__test/reset` | clear uploads, history, and config — called in `beforeEach` |
| `POST /__test/config` | `{ mode: 'instant' \| 'stepped', steps, protocol: 'progress' \| 'progress_state', completion: 'execution_success' \| 'legacy_null', failWith?, dropWsAfter? }` |
| `POST /__test/advance` | emit exactly one more progress step |

`stepped` mode is what removes sleeps from the progress test: the server emits nothing until the test
asks, so an assertion on the progress value cannot race. `reset` per test is cheaper than restarting
the process and equally deterministic.

**Contract assertions the fake makes** (a broken client fails loudly rather than quietly):
- the upload field is named `image` and no `Content-Type` was hand-set;
- the queued body has both a `prompt` object and a `client_id`;
- the image filename referenced inside the queued graph exists in the upload map — which catches a
  `patchWorkflow` that wrote to the wrong node.

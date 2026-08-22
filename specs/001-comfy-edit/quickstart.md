# Quickstart: comfy-edit

**Feature**: `001-comfy-edit` | **Date**: 2026-08-09

---

## Install

```bash
npm ci
npx playwright install chromium
```

Node 22 or later. Nothing else — no GPU, no ComfyUI, no network access beyond npm.

---

## Run the test suite

```bash
npm test
```

**This is the single command** the constitution's Principle III requires. It runs, in order:

1. `tsc --noEmit` — typecheck
2. `vitest run` — unit tests over `src/core/`
3. `playwright test --grep-invert @live` — end-to-end

Playwright starts the fake ComfyUI server and the Vite dev server itself, waits for each to answer a
readiness URL, and tears both down afterwards. There are no sleeps anywhere, no manual setup, and no
GPU cost. Measured wall time: **38 seconds** (SC-009 budget is 60).

Two harness details that matter if you change the config:

- **`workers: 1` is deliberate.** One fake ComfyUI holds the uploads, queue and history, and every
  spec resets it in `beforeEach`. Parallel workers wipe each other's state mid-test.
- **The dev server is started with `--host 127.0.0.1`.** Vite otherwise binds `::1` only, and the
  readiness probe never connects.

Machine-readable results land in `test-results/results.json`.

Narrower runs while working:

```bash
npm run test:unit                      # Vitest only, fast
npm run test:e2e                       # Playwright only
npx vitest run tests/unit/shapes.test.ts
npx playwright test tests/e2e/us1-drawing.spec.ts --headed
```

---

## Develop against the fake ComfyUI

Two terminals, no GPU required:

```bash
# terminal 1
npm run fake-comfy                     # binds 127.0.0.1:8199

# terminal 2
COMFY_URL=http://127.0.0.1:8199 npm run dev
```

Open the printed URL. Load an image, draw, pick **Passthrough (test)**, and run — the fake returns a
solid magenta image, which is a clear signal that the whole upload → queue → poll → fetch → redraw
path worked.

---

## Open images from a folder on this machine

**Open from folder…** in the toolbar opens a folder chooser, then lists the images under whatever
you pick. No configuration and no restart — the choice is made in the app and remembered in
`localStorage` under `comfy-edit.imagesDir`.

The folder is ours, not ComfyUI's — it can be one ComfyUI has never heard of, because a transform
uploads the composited canvas rather than referring to a path on the server.

A browser cannot show a native picker for a path on the machine running the dev server; that dialog
only returns files the *browser* can reach. So the chooser is drawn from our own listing: click down
through subfolders, or paste a path into the field, which is the quicker way to somewhere far away.

Details:

- Served by `src/server/localFolder.ts`, a Vite middleware mounted at `/local/*` in both `dev` and
  `preview`. Same-origin for the same reason `/comfy/*` is: a cross-origin image taints the canvas.
  - `/local/dirs?path=` — subdirectories of one directory (home when the path is omitted)
  - `/local/images?dir=` — every image under a chosen folder
  - `/local/file?dir=&path=` — one of those images
- Recurses up to 6 levels and lists alphabetically, numerically within a name (`render-2` before
  `render-10`). Capped at 500 images — by recency, so a big folder keeps the newest rather than the
  first 500 names — and gives up walking after 5000. Either cap is reported in the picker.
- Tiles are served from `/local/thumb` as 160px WebP, resized by `sharp`. Sending full renders for
  73px tiles cost 546MB and 9s to open a 500-image folder; measured after, 0.2MB and 1.5s.
- Every image URL carries the file's mtime as `v=`, and a versioned response is `immutable`. So a
  folder opens once and is free after that — reopening or reloading transfers nothing. A file that
  changes gets a new mtime, so a new URL, so it is refetched.
- `sharp` is a native module and the one dependency that can fail to build. It is imported lazily and
  its absence falls back to serving the original file: the picker is slow again, not broken.
- Skips dot-directories, non-images, and symlinks. `/local/file` refuses any path that resolves
  outside the chosen folder, so the route is an image source and not a fileserver.

## Save an image back out

**Save image…** writes what is on the canvas into a folder you choose. The first use opens the same
chooser; after that it goes straight to the filename prompt. The save folder is remembered separately
from the folder images are opened from (`comfy-edit.saveDir`) — the two are rarely the same place.

- The filename defaults to `<workflow>-<seed>.png`, which says something about the image and differs
  between saves, so "that name is taken" stays off the common path.
- A name with no extension gets `.png`. Any other image extension is refused: the canvas exports PNG,
  and a `.jpg` holding PNG bytes is a slow way to find that out.
- Saving never overwrites — `POST /local/save` opens with `wx` and answers 409 if the name exists.
  The dialog stays open carrying the reason so another name can be typed.
- The image saved is the canvas as it stands. For a freshly generated result that is exactly the
  generated image; once something has been drawn on it, it is what is on screen.

### What this exposes

The chosen folder travels with each request rather than being fixed at startup, which means any
directory the dev server's user can read is browsable, any image under a chosen one is readable, and
a PNG can be written into any directory it can write to — by anything that can reach the port. That is the same trust boundary `/comfy/*` already assumes — a
dev server on the loopback interface — but it is wider than a single configured root. Don't run the
dev server on a public interface.

---

## Develop against real ComfyUI

The instance is remote, billable at roughly $2.29/hour, and not always running.

```bash
# 1. Launch it (Lambda GPU) — see the launch-comfyui-instance skill
# 2. Tunnel it to localhost
ssh -L 8188:localhost:8188 ubuntu@<ip>

# 3. Point the dev server at the tunnel (this is the default target)
npm run dev
```

Verify the tunnel is live before blaming the app:

```bash
curl -s http://127.0.0.1:8188/system_stats | head -c 200
```

**Terminate the instance when you are done** — it bills hourly:

```bash
cloudgpu lambda terminate <instance_id>
```

---

## Add a workflow (no code change)

1. In ComfyUI, get the workflow running once.
2. **Workflow → Export (API)** — not a plain save. A UI-format export has a top-level `nodes` array
   and will be rejected at startup with a message telling you exactly this.
3. Save it into `public/workflows/`.
4. Open it and note the node ids for the image loader, the positive prompt encoder, and the sampler.
   Each node's `_meta.title` makes this quick.
5. Add an entry to `public/workflows/manifest.json`:

   ```json
   { "id": "qwen-2511", "label": "Qwen-Image-Edit-2511", "file": "qwen-2511.api.json",
     "imageNode": "78", "promptNode": "76", "seedNode": "3" }
   ```

6. Reload. The workflow is in the dropdown.

If a node id is wrong, you get a startup banner naming the workflow and listing the node ids that do
exist — deliberately, rather than a run that succeeds while ignoring your instruction.

---

## Run the live check

Only after a real workflow is configured and the tunnel is open:

```bash
COMFY_LIVE=1 npm run test:e2e:live
```

This drives the same flow as the offline test against the real instance. It asserts only that the
canvas *changed*, not that it became a specific color, because a real model's output is not
deterministic. Its purpose is to catch drift in what ComfyUI expects — a changed upload response
shape, a new WebSocket dialect — that a fake can never catch on its own.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Run stalls at "queued" forever | WebSocket upgrade not reaching ComfyUI (`/comfy/ws` instead of `/ws`) | The run should still complete via history polling — if it does, only progress is broken. Check the proxy's `ws: true` and rewrite behaviour. |
| `value not in list: …safetensors` | The model is not on the GPU box | Download it there; this app never installs models |
| Startup banner about a workflow | Manifest node ids do not match the graph | Fix the ids; the banner lists the ones that exist |
| "looks like a UI-format workflow export" | Wrong export menu item | Re-export with Workflow → Export (API) |
| Result image is low-resolution | A `PreviewImage` output was selected instead of the real one | Selection must keep only `type: "output"` — this is unit-tested |
| Same image every run | ComfyUI cached an identical graph | Uncheck the seed lock so the seed varies per run |
| Canvas pixel reads throw `SecurityError` | An image was fetched cross-origin and tainted the canvas | Everything must go through `/comfy/*`; never use `COMFY_URL` directly from the browser |

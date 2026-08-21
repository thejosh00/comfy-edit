# Contract: Workflow Manifest

**Direction**: the user authors these files; the application reads and validates them. This is the
contract that makes FR-029 and SC-007 true — adding a workflow is configuration, never code.

Location: `public/workflows/`. Served statically, so files can be added or edited without a rebuild.

---

## `manifest.json`

```json
{
  "workflows": [
    {
      "id": "passthrough",
      "label": "Passthrough (test)",
      "file": "passthrough.api.json",
      "imageNode": "1",
      "promptNode": "2",
      "seedNode": "3"
    },
    {
      "id": "qwen-2511",
      "label": "Qwen-Image-Edit-2511",
      "file": "qwen-2511.api.json",
      "imageNode": "78",
      "promptNode": "76",
      "seedNode": "3",
      "promptInput": "prompt"
    }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | stable key; used in history labels and test selectors |
| `label` | yes | what the dropdown shows |
| `file` | yes | API-format graph, resolved relative to `public/workflows/` |
| `imageNode` | yes | node id whose input receives the uploaded filename |
| `promptNode` | yes | node id whose input receives the user's instruction |
| `seedNode` | yes | node id whose input receives the seed |
| `imageInput` | no | overrides the default input name `image` |
| `promptInput` | no | overrides the default; tried in order: `prompt`, `text` |
| `seedInput` | no | overrides the default; tried in order: `seed`, `noise_seed` |
| `loraNodes` | no | node ids of the user-selectable LoRA slots, in slot order; 1 to 3 |
| `loraNameInput` | no | overrides the default input name `lora_name` |
| `loraStrengthInput` | no | overrides the default; tried in order: `strength_model`, `strength` |

The dropdown lists workflows in manifest order.

---

## `loras.json` — the optional LoRA catalog

Same directory. **Optional**: a missing file simply means no LoRAs are offered, and the editor is
fully usable without one. A file that exists but is malformed is a hard error — silently ignoring it
would present as the dropdown mysteriously being empty.

```json
{
  "loras": [
    { "id": "krea2-darkbrush", "label": "Dark Brush", "file": "krea2_darkbrush.safetensors",
      "workflows": ["krea2-refine"], "strength": 0.8 },
    { "id": "qwen-female", "label": "Female", "file": "female.safetensors",
      "workflows": ["qwen-2511"] }
  ]
}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | stable key, unique across the catalog |
| `label` | yes | what the slot dropdown shows |
| `file` | yes | the `.safetensors` name as ComfyUI knows it; written to `lora_name` verbatim |
| `workflows` | no | workflow ids this LoRA is offered for; **omitted means every workflow** |
| `strength` | no | the slider's initial value when selected; defaults to `1` |

`workflows` exists because a LoRA trained against one base model does nothing useful on another —
`krea2_darkbrush` on Qwen is a wasted GPU-minute and a confusing result, not an error the user can
read. Scoping hides it rather than offering it and letting the run fail.

---

## LoRA slots: declared, never discovered

A workflow's LoRA slots are the node ids listed in `loraNodes`. They are **not** found by scanning the
graph for `LoraLoader*` nodes, because a graph may legitimately carry a LoRA that must stay on and out
of the user's hands — `qwen-2511`'s `Lightning 4-step LoRA (always on)` at node `32` is exactly that.
Auto-discovery would hand the user a control that breaks the workflow.

The slots are expected to be chained in series through their `model` inputs, each disabled at
`strength_model: 0`, which is how both shipped graphs already export.

**Off is `strength_model: 0`, never node removal.** Every declared slot is written on every run: a
selected slot gets its `lora_name` and strength, an empty one gets `strength_model: 0` **with its
authored `lora_name` left alone**. Two reasons:

- Removing a node would mean rewiring the `model` chain around it — the one thing patching promises
  never to do.
- ComfyUI validates `lora_name` against the files on disk *even at strength 0*, so overwriting the
  authored name with a placeholder would fail the whole prompt with `value not in list`.

Selections do not survive changing workflow, since the catalog is filtered per workflow and a
carried-over choice could name a file the next workflow cannot load. Re-selecting the *same* workflow
keeps them.

---

## The graph file: API format, not UI format

Export from ComfyUI with **Workflow → Export (API)**. On older frontends, enable
Settings → Lite Graph → "Enable Dev mode Options" to reveal *Save (API Format)*.

API format is a flat object keyed by node id:

```json
{ "1": { "class_type": "LoadImage", "inputs": { "image": "PLACEHOLDER.png", "upload": "image" } },
  "3": { "class_type": "KSampler",  "inputs": { "seed": 0, "steps": 4, "positive": ["2", 0] } } }
```

UI format has a top-level `nodes` **array** and will not work. Confusing the two is the most common
mistake with this workflow, so validation detects it by name and says exactly which export menu item
to use instead of failing with a generic parse error.

---

## Patching rules

`patchWorkflow` deep-clones the graph and writes three values. Two rules govern it, and both exist to
turn silent misbehaviour into loud errors.

**1. Only ever overwrite an input key that already exists.**

Inventing a key would produce a graph ComfyUI rejects. Far worse, tolerating a wrong node id would
mean the run *succeeds* and returns an image the user's instruction never reached — which presents as
"the model ignored my prompt" and is expensive to diagnose against a billable remote GPU. FR-033
requires the loud failure.

**2. Reject inputs driven by links; never overwrite them.**

In API format, a value supplied by another node is an array:

```json
"inputs": { "seed": ["10", 0] }
```

Writing a number over that silently breaks the graph. This is a real and common consequence of
exporting a workflow that uses a primitive or seed-generator node, so validation reports it with the
fix:

> `workflow 'qwen-2511': node 3 input 'seed' is driven by a link from node 10. Point seedNode at node 10 instead.`

---

## Validation, at startup, before any run

Every workflow is validated when the editor loads (FR-031). Any failure shows a banner naming the
workflow and the problem, and disables running (FR-032). Each message below is a unit test against
the pure validator.

| Condition | Message includes |
|---|---|
| Manifest is not valid JSON | the parser's own message and the file path |
| Required field missing | the workflow id and the field name |
| Graph file 404s | the path attempted |
| Graph is UI format | that it has a top-level `nodes` array, and to use Workflow → Export (API) |
| Declared node id absent | the id, plus available node ids with their `class_type`s |
| Node lacks the target input | the input names it does have |
| Target input is a link | which node to point at instead |
| No workflows configured at all | that there are none; drawing stays fully usable |
| `loraNodes` is not 1–3 node id strings | the workflow id and the field name |
| A declared LoRA node is absent | the id, the field name `loraNodes`, and the available node ids |
| A LoRA node lacks `lora_name` / `strength_model` | the inputs it does have, and which `lora*Input` to set |
| `loras.json` is malformed | the lora id and the offending field |
| A duplicate lora id | the id, and that ids must be unique |
| `loras.json` is absent | *not an error* — no LoRAs are offered |

---

## Seeds

The seed is randomised per run by default, with a lock for reproducibility (FR-028). ComfyUI caches
by graph content, so re-running an identical graph returns the cached image instantly — which reads
as "the app is broken" rather than as a cache hit.

---

## `passthrough.api.json` — checked in, and load-bearing

A minimal four-node graph the fake server never executes; it only verifies that the patched values
landed where the manifest said they would.

This matters more than it looks: **US2 is fully implementable, testable, and shippable before the
real Qwen export exists and with the GPU switched off.** Given the instance is billable and currently
down, that is the difference between a blocked feature and a finished one. Adding `qwen-2511` later
is precisely the drop-in-files flow — already proven by `passthrough`.

---

## Adding a workflow (the SC-007 procedure)

1. In ComfyUI, load or build the workflow and run it once to confirm it works.
2. Workflow → Export (API); save into `public/workflows/`.
3. Open the file and read the node ids for the image loader, the positive prompt encoder, and the
   sampler — `_meta.title` on each node makes this quick.
4. Add an entry to `manifest.json`.
5. Reload the editor. The workflow appears in the dropdown. Zero lines of code changed.

For Qwen-Image-Edit-2511 specifically, the ComfyUI template uses `LoadImage` for the base image,
`TextEncodeQwenImageEditPlus` for the positive prompt, and `KSampler` for the seed. The models must
already be on the GPU box — this application never downloads or installs anything.

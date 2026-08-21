# Phase 1 Data Model: Draw-and-Transform Image Editor

**Feature**: `001-comfy-edit` | **Date**: 2026-08-09

Every type below lives in `src/core/` and is a plain immutable value. Nothing here imports the DOM,
the network, or React — that is what makes each transition a unit test rather than a browser test.

A convention that runs through the whole model: **identity and time are passed in, never generated
inside `core/`.** `crypto.randomUUID()`, `Date.now()`, and `URL.createObjectURL()` are called by the
UI layer and handed down as arguments. Without this, every history test would need clock and UUID
mocking; with it, they are ordinary equality assertions.

---

## Geometry and marks

```ts
type Point = { x: number; y: number }          // canvas pixel space, not screen space
type Size  = { w: number; h: number }
type ToolId = 'freehand' | 'line' | 'rect' | 'ellipse'

type Shape =
  | { kind: 'freehand'; points: Point[];          color: string; width: number }
  | { kind: 'line';     from: Point; to: Point;   color: string; width: number }
  | { kind: 'rect';     from: Point; to: Point;   color: string; width: number }
  | { kind: 'ellipse';  from: Point; to: Point;   color: string; width: number }
```

**Shape** is the spec's *Mark* entity. `color` is a CSS color string and `width` a stroke thickness
in canvas pixels; both are captured at creation time, so changing the toolbar afterwards does not
retroactively restyle existing marks.

Coordinates are always **canvas pixel space**. The canvas backing store matches the base image's
natural dimensions while CSS scales its presentation to the viewport, so pointer events must be
converted by `toCanvasPoint(rect, canvasSize, clientX, clientY)`. Getting this wrong is a classic
off-by-a-scale-factor bug (FR-009); as a pure function it is one unit test instead of a mystery.

**Validation**: `isDegenerate(shape)` is true for a click with no drag — a freehand with fewer than
two points, or any two-point shape whose corners coincide. Degenerate shapes are never committed
(FR-010).

**Constraint mode**: when the pointer event carries a shift modifier, `extendShape` snaps lines to
45° increments and forces rectangles and ellipses square. This is a pure argument, not global state.

---

## DrawingDoc

```ts
type DrawingDoc = {
  baseImageId: string     // the HistoryEntry currently underneath the marks
  shapes: Shape[]         // committed, oldest first — render order
  undone: Shape[]         // undo stack, most recently undone last
}
```

**Transitions** (all return a new document; none mutate):

| Operation | Effect | Requirement |
|---|---|---|
| `createDoc(baseImageId)` | empty `shapes` and `undone` | — |
| `commitShape(doc, s)` | appends to `shapes`, **clears `undone`** | FR-013 |
| `undo(doc)` | moves last of `shapes` to `undone`; no-op when empty | FR-011 |
| `redo(doc)` | moves last of `undone` back to `shapes`; no-op when empty | FR-012 |
| `clearShapes(doc)` | empties `shapes`; **also empties `undone`** | FR-014, FR-015 |
| `rebase(doc, newBaseId)` | new base, **both lists emptied** | FR-023, FR-039 |

`canUndo` and `canRedo` are derived, never stored (FR-015).

Two subtleties worth stating because they are easy to get wrong and both are directly tested:

- **`commitShape` clearing `undone`** is what makes the undo trail a stack rather than a tree. Draw,
  undo, draw again — the undone mark is gone for good.
- **`rebase` clearing `undone` as well as `shapes`** is the one a naive implementation misses. After
  a transformation the marks are baked into the result's pixels; leaving a redo stack alive would let
  the user redo a mark that is already part of the image underneath it, drawing it twice.

---

## HistoryEntry and HistoryState

```ts
type EntryOrigin =
  | { kind: 'upload' }
  | { kind: 'generation'; workflowId: string; prompt: string; seed: number; promptId: string }

type HistoryEntry = {
  id: string            // supplied by the caller
  label: string         // "Original", "qwen-2511 #2"
  src: string           // blob: object URL — the image itself
  width: number
  height: number
  createdAt: number     // supplied by the caller
  parentId: string | null
  origin: EntryOrigin
}

type HistoryState = { entries: HistoryEntry[]; currentId: string | null }
```

**Entries are append-only.** Nothing removes one, which is what lets a user branch from an earlier
image without destroying the path they branched from (FR-038).

`origin` carries the spec's requirement that a generated entry records what produced it (FR-035).
`promptId` is not shown in the UI but is retained deliberately: it is the key to paste into
`/history/<id>` when debugging a bad generation against the live instance.

`parentId` records provenance even though the strip renders flat and chronological. One field, and
"which image did this come from?" stays answerable. Tree visualisation is explicitly not built.

**Transitions**:

| Operation | Effect | Requirement |
|---|---|---|
| `emptyHistory()` | no entries, `currentId: null` | — |
| `addEntry(h, id, entry)` | appends **and** selects the new entry | FR-034, FR-036 |
| `addEntry(emptyHistory(), …)` | how an upload lands: the new image becomes the only entry | FR-034a |
| `selectEntry(h, id)` | changes `currentId`; **throws on an unknown id** | FR-037 |
| `currentEntry(h)` | the selected entry, or `null` | FR-036 |
| `nextGenerationLabel(h, workflowId)` | `"<workflowId> #<n>"`, counting that workflow's entries | FR-035 |

`selectEntry` throwing rather than silently ignoring an unknown id is deliberate: in a session-only
store an unknown id means a caller bug, and swallowing it would surface as a blank workspace.

---

## Workflow configuration

```ts
type WorkflowMeta = {
  id: string; label: string; file: string
  imageNode:  string; imageInput?:  string
  promptNode: string; promptInput?: string
  seedNode:   string; seedInput?:   string
  loraNodes?: string[]                        // 1..MAX_LORA_SLOTS, in slot order
  loraNameInput?: string; loraStrengthInput?: string
}

type ApiNode  = { class_type: string; inputs: Record<string, unknown>; _meta?: { title?: string } }
type ApiGraph = Record<string, ApiNode>     // node id -> node

class WorkflowConfigError extends Error {}
```

**Workflow** is the spec's entity of the same name. The optional `*Input` fields override the
defaults when a graph deviates: image defaults to `image`, prompt tries `prompt` then `text`, seed
tries `seed` then `noise_seed`.

**Validation runs once at startup, before any transformation is possible** (FR-031, FR-032). Every
failure is a `WorkflowConfigError` naming the workflow and the specific problem:

| Condition | Message must include |
|---|---|
| Manifest is not valid JSON | the parser's own message |
| A required field is missing | the workflow id and the field name |
| The graph file 404s | the path attempted |
| The graph is UI format, not API format | that it has a top-level `nodes` array, and to use Workflow → Export (API) |
| A declared node id is absent | the id, plus the available node ids with their `class_type`s |
| The node exists but lacks the target input | the input names it does have |
| The target input is driven by a link | which node to point at instead |

The last two carry the most weight. `patchWorkflow` **only ever overwrites an input key that already
exists**, so a wrong node id becomes a loud error rather than a silent no-op that returns an unedited
image (FR-033). And an input driven by another node appears as an array — `"seed": ["10", 0]` —
which must be rejected, not overwritten, because writing a scalar over a link silently breaks the
graph.

`patchWorkflow(graph, meta, {imageFilename, prompt, seed, loras})` `structuredClone`s the graph and
returns a new one; the loaded graph is never mutated, so consecutive runs cannot accumulate state.

---

## LoRA selection

```ts
type LoraMeta = {
  id: string; label: string; file: string
  workflows?: string[]        // omitted means every workflow
  strength?: number           // the slider's initial value; defaults to DEFAULT_LORA_STRENGTH (1)
}

type LoraSelection = { file: string; strength: number } | null   // null = the slot is empty

const MAX_LORA_SLOTS = 3
```

A workflow declares which node ids are user-controllable slots (`loraNodes`); the catalog declares
which LoRAs may be offered for it (`lorasFor(catalog, workflowId)`). One `LoraSelection` per declared
slot, in slot order, reaches `patchWorkflow`.

**Every declared slot is written on every run.** A selected slot receives its `file` and `strength`;
an empty one receives `strength_model: 0` with its authored `lora_name` untouched — ComfyUI validates
that name against the files on disk even at strength 0, and turning a LoRA off by strength rather than
by removing the node means the `model` chain is never rewired.

Selections are cleared when the workflow changes, since a LoRA scoped to one base model would fail or
silently misbehave on another.

---

## Batch runs

```ts
type BatchMode = 'variations' | 'serial'

const BATCH_COUNTS = [1, 2, 3, 4, 6, 8]
const MAX_BATCH_COUNT = 8

clampBatchCount(count: number): number                      // 1..MAX_BATCH_COUNT, 1 for nonsense
batchSeeds(count, seed, locked, rng?): number[]             // one seed per run
```

Run executes the workflow `count` times. The mode decides what each repeat consumes and where its
result lands in the history:

| Mode | Each run's input | Parent of each result |
|---|---|---|
| `variations` | the same composite, every time | the image the batch started from — the results are siblings |
| `serial` | the previous run's result | the previous result — the results are a chain |

A serial pass never re-composites the canvas. Adopting a result rebases the document, which clears the
marks, so the composite would equal the result blob anyway — and reading it back would mean waiting on
a canvas repaint mid-batch.

**A locked seed walks upward** — `seed`, `seed+1`, … — rather than repeating. Locking promises
reproducibility, and a walk is reproducible; reusing one seed would hit ComfyUI's content cache and
return the identical image every time, which reads as a broken app rather than as a batch. A single
locked run is therefore still exactly the seed the user chose.

**A failure stops the batch where it is and keeps what already succeeded.** Those results are real
images that cost real GPU time; discarding them because a later run failed would be the more
surprising behaviour. Run stays disabled for the whole batch, not merely for the run in flight.

---

## RunState — the ComfyUI protocol as a value

```ts
type RunPhase = 'idle' | 'uploading' | 'queued' | 'running' | 'done' | 'error'

type OutputImageRef = { filename: string; subfolder: string; type: string }

type RunState = {
  phase: RunPhase
  promptId: string | null
  node: string | null           // display name of the executing node
  progress: number | null       // 0..100
  queueRemaining: number | null
  error: string | null
  images: OutputImageRef[]
}
```

**Run state** is the spec's *Transformation run* entity. Modelling the protocol as a reducer over
messages — `applyWsMessage(state, rawJson)` and `applyHistory(state, json, promptId)` — is the highest
-leverage decision in the codebase: both progress dialects, both completion signals, error
extraction, cross-prompt filtering, and temp-versus-output selection all become pure functions over
recorded fixtures, so the E2E tests only have to prove wiring rather than protocol.

**Phase transitions**:

```
idle ──start──> uploading ──queued──> queued ──execution_start──> running ──┬──> done
                    │                    │                            │     └──> error
                    └────── error ───────┴────────── error ───────────┘
```

`done` and `error` are terminal (`isTerminal`). `error` is reachable from every non-terminal phase:
upload failure, a 400 from queueing, `execution_error`, an unreachable service, or the bounded-wait
timeout (FR-025, FR-026). In every case the workspace image is left unchanged — the base image is
only replaced on `done`.

**Message handling rules**, each a unit test:

| Message | Handling |
|---|---|
| `status` | update `queueRemaining`. **Has no `prompt_id` — never filter it out.** |
| `execution_start` | phase → `running` |
| `executing` with a node id | update `node` |
| `executing` with `node: null` | **terminal** — the legacy completion signal |
| `progress` | `progress = value / max * 100` (legacy dialect) |
| `progress_state` | sum `value` and `max` across nodes in the `running` state (current dialect) |
| `executed` | collect `output.images` — the fast path to the result |
| `execution_success` | terminal (current dialect) |
| `execution_error` | phase → `error`, message from `exception_message` |
| `execution_interrupted` | terminal cancel |
| anything with a foreign `prompt_id` | **ignored** — another tab may share the connection |
| non-string (binary) frames | dropped; preview frames are out of scope for v1 |

`selectOutputImage(historyEntry)` keeps only images with `type === 'output'` and takes the last —
`PreviewImage` nodes also appear in `outputs` with `type: 'temp'`, and returning one of those shows
the user a low-resolution preview instead of the result.

---

## Entity relationships

```
HistoryEntry ──parentId──> HistoryEntry        (append-only provenance chain)
     ▲                                          created on upload and on each successful run
     │ baseImageId
DrawingDoc ──shapes──> Shape[]                  (emptied by rebase and by clear)

WorkflowMeta ──file──> ApiGraph                 (validated once at startup)
     │
     └── patchWorkflow(graph, meta, {image, prompt, seed}) ──> ApiGraph (a clone, queued)
                                                                    │
                                                                    ▼
                                                              RunState ──done──> HistoryEntry
```

One transformation therefore touches all five entities: the composited `DrawingDoc` becomes the
uploaded image, a `WorkflowMeta` selects and patches an `ApiGraph`, the run is tracked as `RunState`,
and success appends a `HistoryEntry` which becomes the new `baseImageId` of a freshly rebased
`DrawingDoc`.

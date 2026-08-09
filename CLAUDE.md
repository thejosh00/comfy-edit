<!-- SPECKIT START -->
For technologies, project structure, shell commands, and other important context,
read the current plan: `specs/001-comfy-edit/plan.md`

Supporting design artifacts for this feature:

- `specs/001-comfy-edit/spec.md` — what and why, with the three prioritized user stories
- `specs/001-comfy-edit/research.md` — decisions with rationale and rejected alternatives
- `specs/001-comfy-edit/data-model.md` — core types and their state transitions
- `specs/001-comfy-edit/contracts/comfyui-api.md` — the external ComfyUI protocol
- `specs/001-comfy-edit/contracts/workflow-manifest.md` — workflow configuration format
- `specs/001-comfy-edit/contracts/ui-contract.md` — test ids and observable UI states
- `specs/001-comfy-edit/quickstart.md` — how to run it and test it

Project rules live in `.specify/memory/constitution.md` and are binding. In short:
tests come first and must be observed failing; every user story needs an end-to-end
test; the whole suite runs from `npm test` with no GPU and no live ComfyUI; prefer
the simplest thing that works.

Two boundaries worth keeping in mind while editing:

- `src/core/` imports nothing from the DOM, the network, or React. All non-trivial
  logic belongs there so it can be unit-tested. `src/comfy/` and `src/ui/` stay thin.
- ComfyUI is reached only through the same-origin `/comfy/*` proxy. Fetching it
  directly taints the canvas and breaks both pixel assertions and the next upload.
<!-- SPECKIT END -->

# Feature Specification: Draw-and-Transform Image Editor

**Feature Branch**: `001-comfy-edit`

**Created**: 2026-08-09

**Status**: Draft

**Input**: User description: "A single-screen image editor that lets one person iterate on an image by alternating between drawing on it and transforming it with an AI image-editing model. The user brings an image in, marks it up with freehand strokes, straight lines, rectangles and ellipses in a chosen color and thickness, with undo/redo and clear. They then choose a pre-configured editing recipe, type an instruction, and start a transformation; the marked-up image is sent to a running ComfyUI instance and the result replaces the image in the workspace, ready to be drawn on and transformed again. Every image the user has had in the workspace is kept in a visible strip they can return to. New recipes are added by dropping configuration files in, with clear startup errors when a recipe is misconfigured. Priorities: P1 the drawing editor, P2 the AI transformation, P3 the history strip."

## Overview

Iterating on an image today means exporting from an editor, uploading into a separate generation
tool, downloading the result, and re-importing it. That loop is slow enough that people stop
experimenting. This feature collapses it into one screen: draw, transform, draw on the result,
transform again — with every intermediate image one click away.

A **workflow** in this document means a pre-configured, named image-editing recipe that the
transformation service knows how to run (for example, a Qwen image-edit recipe). Workflows are
configuration, not code: the person running the editor adds and removes them by editing files in the
project, without any code change.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mark up an image (Priority: P1)

A person opens the editor, brings in an image — by choosing a file or pasting from the clipboard —
and it appears in the workspace at its natural size. They pick a tool (freehand, straight line,
rectangle, or ellipse), pick a color and a stroke thickness, and draw directly on the image. Marks
accumulate in the order they were made. They can undo marks one at a time, redo marks they undid, or
clear every mark at once and start over.

**Why this priority**: This is the foundation everything else builds on — the transformation has
nothing to send without it, and the history strip has nothing to record. It is also the only part
that delivers standalone value with no external service involved, which makes it the natural first
shippable slice.

**Independent Test**: Fully testable with no transformation service present or configured. Bring in
an image, draw each of the four shapes, confirm each appears in the chosen color and thickness,
undo and redo them, and clear. Delivers a usable image markup tool on its own.

**Acceptance Scenarios**:

1. **Given** an empty workspace, **When** the user chooses an image file, **Then** the image appears
   in the workspace at its natural dimensions and the workspace reports those dimensions.
2. **Given** an image in the workspace, **When** the user pastes an image from the clipboard,
   **Then** it replaces the workspace image at its own natural dimensions.
3. **Given** an image in the workspace and the rectangle tool selected with a chosen color and
   thickness, **When** the user drags across the image, **Then** a rectangle outline is drawn in that
   color and thickness between the drag start and end points.
4. **Given** three marks have been drawn, **When** the user undoes twice, **Then** only the first
   mark remains visible.
5. **Given** two marks have been undone, **When** the user redoes once, **Then** the second mark
   reappears and redo remains available for the third.
6. **Given** marks have been undone, **When** the user draws a new mark, **Then** the undone marks
   can no longer be redone.
7. **Given** several marks have been drawn, **When** the user clears, **Then** the workspace shows
   the unmarked image and undo is unavailable.
8. **Given** any tool selected, **When** the user clicks without dragging, **Then** no mark is added.

---

### User Story 2 - Transform the marked-up image (Priority: P2)

With an image marked up, the person picks a workflow from a list of the configured ones, types an
instruction describing the change they want, and starts the transformation. The marked-up image —
exactly as it appears on screen, marks included — is sent to the transformation service and run
through the chosen workflow. While it runs, the person can see that it is in progress and roughly how
far along it is. When it finishes, the result replaces the image in the workspace, marks and all are
gone, and the person can immediately draw on the result and transform again. If it fails, they are
shown the reason.

**Why this priority**: This is the differentiating capability, but it depends on US1 for its input
and is useless without it. It is second because the editor is valuable alone and this is not.

**Independent Test**: Testable against a stand-in transformation service that returns a
recognizably different image, with no real AI model involved. Bring in an image, choose a workflow,
enter an instruction, run it, and confirm the workspace image is replaced by the returned one and
that a second run can be started from that result.

**Acceptance Scenarios**:

1. **Given** at least one workflow is configured, **When** the editor starts, **Then** the workflow
   list offers each configured workflow by its display name.
2. **Given** an image in the workspace, a chosen workflow, and an entered instruction, **When** the
   user starts a transformation, **Then** progress is shown while it runs and the resulting image
   replaces the workspace image when it completes.
3. **Given** a transformation has completed, **When** the user draws on the result and starts another
   transformation, **Then** the second transformation receives the result-plus-new-marks image.
4. **Given** a transformation is running, **When** the user attempts to start another, **Then** they
   cannot start a second concurrent transformation.
5. **Given** the transformation service rejects the request, **When** the failure occurs, **Then**
   the reason reported by the service is shown to the user and the workspace image is unchanged.
6. **Given** the transformation service is unreachable, **When** the user starts a transformation,
   **Then** they are told it could not be reached and the workspace image is unchanged.
7. **Given** a workflow's configuration names parts of the recipe that do not exist, **When** the
   editor starts, **Then** the user is shown which workflow is misconfigured and what is wrong, and
   transformation cannot be started.
8. **Given** a new workflow configuration file is added to the project, **When** the editor is
   reloaded, **Then** the new workflow appears in the list without any code change.

---

### User Story 3 - Return to an earlier image (Priority: P3)

Every image the person has had in the workspace — the one they brought in, plus each transformation
result — is kept in a visible strip. Each entry records which workflow, instruction, and seed
produced it, so the person can tell the results apart. Selecting an entry brings that image back
into the workspace so the person can branch off from it in a different direction. Entries are never
removed by going back, so a branch never destroys the path it came from.

**Why this priority**: It makes exploration safe rather than possible — without it, a bad
transformation is a dead end. But the draw-transform loop works without it, so it comes last.

**Independent Test**: Testable with the same stand-in transformation service. Bring in an image, run
two transformations, confirm three entries exist, select the first, and confirm the original image
is back in the workspace and both later entries are still listed.

**Acceptance Scenarios**:

1. **Given** an image has been brought in, **When** the user looks at the history strip, **Then** it
   contains one entry for that image, marked as the current one.
2. **Given** two transformations have completed, **When** the user looks at the history strip,
   **Then** it contains three entries in the order they were produced, with the newest current.
3. **Given** a history entry produced by a transformation, **When** the user inspects it, **Then**
   the workflow, instruction, and seed that produced it are identifiable.
4. **Given** three history entries, **When** the user selects the first, **Then** that image returns
   to the workspace at its own dimensions, all three entries remain listed, and the first is marked
   current.
5. **Given** the user has selected an earlier entry and drawn new marks, **When** they transform,
   **Then** the new result is added as a further entry and the entries it branched from remain.
6. **Given** unfinished marks on the workspace image, **When** the user selects a different history
   entry, **Then** those marks are discarded and undo is unavailable for them.

---

### Edge Cases

- **A file that is not a usable image** is chosen: the user is told the file could not be read, and
  the workspace is left as it was.
- **The clipboard contains no image** when the user pastes: nothing changes and no error is raised.
- **An image far larger than the viewport** is brought in: it is scaled to fit on screen while
  keeping its natural dimensions for drawing and transforming, and marks land where the user aims
  regardless of the on-screen scale.
- **A transformation result has different dimensions** from the image sent: the workspace adopts the
  result's dimensions.
- **A transformation never completes**: it is abandoned after a bounded wait and reported as timed
  out, leaving the workspace image unchanged.
- **The progress channel drops mid-run** while the transformation itself succeeds: the result is
  still delivered to the workspace; only the progress display is degraded.
- **No workflows are configured at all**: the user is told there are none and transformation cannot
  be started, but drawing remains fully usable.
- **A workflow configuration file is present but unreadable or malformed**: the user is told which
  file and what is wrong at startup, rather than on a failed transformation.
- **The same instruction and workflow are run twice** on the same image: the user gets a fresh
  result rather than a repeat, unless they have deliberately fixed the seed.
- **The user reloads the page**: the workspace and history start empty; this is expected (see
  Assumptions).

## Requirements *(mandatory)*

### Functional Requirements

#### Bringing an image in

- **FR-001**: Users MUST be able to bring an image into the workspace by choosing a file.
- **FR-002**: Users MUST be able to bring an image into the workspace by pasting from the clipboard.
- **FR-003**: The system MUST display the workspace image at its natural pixel dimensions for the
  purposes of drawing and transforming, scaling only its on-screen presentation to fit the viewport.
- **FR-004**: The system MUST report the current workspace image's dimensions to the user.
- **FR-005**: The system MUST tell the user when a chosen file could not be read as an image, and
  leave the workspace unchanged.

#### Drawing

- **FR-006**: Users MUST be able to draw freehand strokes, straight lines, rectangle outlines, and
  ellipse outlines on the workspace image.
- **FR-007**: Users MUST be able to choose the color of subsequent marks.
- **FR-008**: Users MUST be able to choose the stroke thickness of subsequent marks.
- **FR-009**: The system MUST place marks where the user aims regardless of the scale at which the
  image is presented on screen.
- **FR-010**: The system MUST discard a mark that has no extent (a click with no drag).
- **FR-011**: Users MUST be able to undo marks one at a time, in reverse order of creation.
- **FR-012**: Users MUST be able to redo marks they have undone, in order.
- **FR-013**: The system MUST discard the redo trail once a new mark is made.
- **FR-014**: Users MUST be able to remove all marks at once.
- **FR-015**: The system MUST indicate whether undo and redo are currently available.
- **FR-016**: Drawing MUST be fully usable with no transformation service reachable or configured.

#### Transforming

- **FR-017**: The system MUST offer the user a list of the configured workflows, identified by
  display name.
- **FR-018**: Users MUST be able to enter a free-text instruction for the transformation.
- **FR-019**: Users MUST be able to start a transformation of the current workspace image, marks
  included, using the chosen workflow and instruction.
- **FR-020**: The system MUST send the workspace image exactly as the user sees it, with all marks
  applied.
- **FR-021**: The system MUST indicate that a transformation is in progress and give an approximate
  measure of how far along it is.
- **FR-022**: The system MUST prevent a second transformation from being started while one is
  running.
- **FR-023**: The system MUST replace the workspace image with the transformation result on success,
  and MUST clear the marks, so the result becomes the new basis for drawing.
- **FR-024**: The system MUST allow a transformation to be started from a previous transformation's
  result, repeatedly, with no fixed limit.
- **FR-025**: The system MUST show the user the reason a transformation failed, as reported by the
  transformation service, and leave the workspace image unchanged.
- **FR-026**: The system MUST abandon a transformation that has not completed within a bounded wait
  and report it as timed out.
- **FR-027**: The system MUST still deliver a completed result even if the progress channel is
  interrupted during the run.
- **FR-028**: The system MUST vary the seed between otherwise identical transformations by default,
  and MUST let the user fix the seed for a reproducible result.

#### Configuring workflows

- **FR-029**: The system MUST read its available workflows from configuration files in the project,
  so adding or removing a workflow requires no code change.
- **FR-030**: Each workflow's configuration MUST declare which parts of its recipe receive the
  image, the instruction, and the seed.
- **FR-031**: The system MUST validate every workflow's configuration when the editor starts, before
  any transformation can be attempted.
- **FR-032**: The system MUST report a misconfigured workflow to the user at startup, naming the
  workflow and the specific problem, and MUST prevent transformation from being started.
- **FR-033**: The system MUST reject a workflow configuration that points at a part of the recipe
  that does not exist, rather than silently transforming with the user's instruction ignored.

#### History

- **FR-034**: The system MUST record every image that has occupied the workspace — the one brought
  in and each transformation result — as an entry in a visible history strip, in the order produced.
- **FR-035**: Each history entry produced by a transformation MUST record the workflow, instruction,
  and seed that produced it.
- **FR-036**: The system MUST indicate which history entry is currently in the workspace.
- **FR-037**: Users MUST be able to select any history entry and have that image return to the
  workspace at its own dimensions.
- **FR-038**: Selecting a history entry MUST NOT remove any entry, so the user can branch without
  destroying the path branched from.
- **FR-039**: Selecting a history entry MUST discard any unfinished marks on the current image and
  reset undo and redo.

### Key Entities

- **Workspace image**: the image currently being edited — either the one the user brought in or a
  transformation result. Has natural pixel dimensions. Is the basis that marks are drawn over.
- **Mark**: one drawn element — freehand stroke, straight line, rectangle, or ellipse — with a
  color, a stroke thickness, and its geometry. Ordered relative to other marks. Exists only until
  the next transformation or history selection.
- **Workflow**: a named, pre-configured editing recipe, together with the declaration of which parts
  of that recipe receive the image, the instruction, and the seed. Supplied as project configuration.
- **Transformation run**: one attempt to transform the workspace image with a chosen workflow,
  instruction, and seed. Has a progress state and ends in a result, a failure with a reason, or a
  timeout.
- **History entry**: an image that has occupied the workspace, with its dimensions, the entry it
  came from, and — if it was produced by a transformation — the workflow, instruction, and seed
  responsible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person can bring in an image, mark it up, and have the marked-up version transformed
  and back in the workspace without leaving the screen or handling any intermediate file.
- **SC-002**: Every drawing action — selecting a tool, drawing a mark, undoing, redoing, clearing —
  is reflected on screen within 100 milliseconds, with no visible lag while drawing on images up to
  2048 by 2048 pixels.
- **SC-003**: Starting a second transformation from a result takes no more than two actions
  (adjusting the instruction and starting the run); no export, download, or re-import step exists.
- **SC-004**: Returning to any earlier image in the session takes exactly one action.
- **SC-005**: 100% of transformation failures — rejection, unreachable service, and timeout — result
  in a message that names the cause, rather than a generic failure or a silent no-op.
- **SC-006**: 100% of workflow misconfigurations are reported before a transformation is attempted,
  never after one has run.
- **SC-007**: Adding a new workflow requires only adding configuration files: zero lines of code
  change, verified by adding one.
- **SC-008**: The drawing capability passes its full acceptance suite with no transformation service
  available.
- **SC-009**: The entire automated test suite runs unattended from a single documented command,
  requires no AI model or GPU hardware, and completes in under 60 seconds.

## Assumptions

- **Single user, single session, single image at a time.** There are no accounts, no sharing, no
  collaboration, and no concurrent editing.
- **Nothing is persisted.** The workspace and history live only for the life of the session; a
  reload starts empty. The source image is a file the user still has, and transformation results are
  cheap to reproduce, so durable storage is not worth its cost here. This is a deliberate scope
  boundary, revisited only if the user asks for it.
- **The transformation service is ComfyUI**, is already installed and running with its models in
  place, and is managed entirely outside this feature. This feature never installs, configures,
  starts, or downloads anything for it.
- **The transformation service may be remote, slow, and frequently unavailable.** No part of
  building, testing, or running the editor may depend on it being up.
- **Workflow recipes are supplied by the user**, exported from the transformation service in the
  form it accepts for programmatic runs. This feature does not author or convert recipes.
- **A stand-in transformation service is acceptable for automated testing**, since the real one is
  costly, slow, and non-deterministic. At least one opt-in check against the real service exists to
  catch drift in what it expects.
- **Desktop use with a mouse or trackpad.** Touch and stylus pressure are out of scope.
- **Marks are outlines, not filled or erased regions.** Fill, eraser, text, and image-blending tools
  are out of scope.
- **The user's own machine.** There is no deployment, hosting, or multi-environment concern.

# Code Map

This file is a practical guide to the current `src/` tree.

It is optimized for:
- finding the right file quickly
- understanding which layer owns which state
- tracing common flows like click selection, drag-box selection, primitive swaps, context-menu actions, select-all/invert-selection, grab, rotate, scale, extrude, and interactive modal inset
- calling out unfinished or misleading areas

## Project shape

The app is currently a small modeling/editor prototype with four real layers:

1. `src/app/`
The top-level orchestration layer. This is where the app is assembled and where selection, commands, grab, rotate, scale, and extrude are wired together.

2. `src/ui/`
DOM shell and pointer-event glue. This layer should not mutate the core mesh directly.

3. `src/renderer/`
Three.js scene management, picking, overlays, and gizmo visuals.

4. `src/core/`
Mesh data model, stable IDs, selection model, and undoable command types.

There are also a few placeholder files for future editor/project/object-transform work.

## Current ownership rules

These are the most important boundaries in the repo:

- Core mesh state lives in [`src/core/mesh.ts`](src/core/mesh.ts)
- Core selection state lives in [`src/core/selection/selection.ts`](src/core/selection/selection.ts)
- Undo/redo history lives in [`src/core/commands/commandManager.ts`](src/core/commands/commandManager.ts)
- The assembled app lifecycle lives in [`src/app/main.ts`](src/app/main.ts)
- Three.js scene/camera/render buffers live in [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- DOM controls and pointer glue live in [`src/ui/appShell.ts`](src/ui/appShell.ts) and [`src/ui/bindings.ts`](src/ui/bindings.ts)

Important design intent:

- `core/` should own data and mutations
- `renderer/` should visualize core state and compute pick/drag results
- `ui/` should translate browser events into app callbacks
- `app/main.ts` currently acts as the composition root and policy layer

## Read this first

If you are new to the repo, read files in this order:

1. [`src/app/main.ts`](src/app/main.ts)
2. [`src/core/mesh.ts`](src/core/mesh.ts)
3. [`src/core/selection/selection.ts`](src/core/selection/selection.ts)
4. [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
5. [`src/ui/bindings.ts`](src/ui/bindings.ts)
6. [`src/app/grabController.ts`](src/app/grabController.ts)
7. [`src/app/rotateController.ts`](src/app/rotateController.ts)
8. [`src/app/scaleController.ts`](src/app/scaleController.ts)
9. [`src/app/extrudeController.ts`](src/app/extrudeController.ts)
10. [`src/app/insetController.ts`](src/app/insetController.ts)
11. [`src/app/knifeController.ts`](src/app/knifeController.ts)

That path gives the least confusing view of how the app is actually wired today.

## End-to-end flows

### App startup

Entry path:

- [`src/main.ts`](src/main.ts)
- [`src/app/main.ts`](src/app/main.ts)

What happens:

- the stylesheet is imported
- `startApp()` mounts the DOM shell
- `ThreeRenderer` is created with the UI canvas
- the initial cube mesh is created in core and pushed into the renderer
- selection state and command manager are created
- UI callbacks, pointer handlers, keyboard shortcuts, context-menu actions, and primitive swap actions are wired
- the top-right app menu in `src/ui/appShell.ts` routes OBJ import/export actions back into `src/app/main.ts`, including a shell-owned `Yes / No / Cancel` import confirmation dialog
- face shading mode now lives on each core face, and both the renderer and OBJ export path respect that per-face smooth/flat setting
- left-click selection is intercepted in `src/ui/bindings.ts`, but `Ctrl+Alt` + left-drag is allowed through for camera panning; adding `Shift` switches that left-drag camera action to rotation
- keyboard-started modal transforms request pointer lock in `src/app/main.ts`, which lets their drag math continue past the viewport edges using accumulated relative pointer motion
- keyboard-started modal actions preserve the currently armed toolbar tool instead of changing the persistent tool highlight

### Selection / picking flow

Main files:

- [`src/ui/bindings.ts`](src/ui/bindings.ts)
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- [`src/renderer/picking.ts`](src/renderer/picking.ts)
- [`src/core/selection/selection.ts`](src/core/selection/selection.ts)
- [`src/core/commands/selectionCommands/setSelectionCommand.ts`](src/core/commands/selectionCommands/setSelectionCommand.ts)
- [`src/app/main.ts`](src/app/main.ts)

Flow:

1. pointer input lands in `bindUI()`
2. `bindings.ts` converts screen coordinates to NDC
3. `ThreeRenderer.pick()` delegates to face, edge, or vertex picking logic
4. `app/main.ts` computes a before/after selection snapshot
5. `SetSelectionCommand` is executed through `CommandManager`
6. `app/main.ts` syncs overlay state and status text

### Drag-box selection flow

Main files:

- [`src/ui/bindings.ts`](src/ui/bindings.ts)
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- [`src/core/selection/selection.ts`](src/core/selection/selection.ts)
- [`src/core/commands/selectionCommands/setSelectionCommand.ts`](src/core/commands/selectionCommands/setSelectionCommand.ts)
- [`src/app/main.ts`](src/app/main.ts)

Flow:

1. `bindUI()` treats pointerdown as a potential marquee selection start
2. once the pointer moves past a small threshold, `bindings.ts` shows a screen-space selection rectangle
3. on pointerup, `ThreeRenderer.boxSelect()` returns stable IDs for vertices, edges, or faces based on the active selection mode
4. `app/main.ts` applies the bulk result through the same command-backed selection update path used by click selection
5. overlays and status text are refreshed from core selection state

### Grab flow (`G`)

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/grabController.ts`](src/app/grabController.ts)
- [`src/core/selection/selectionToVertexIds.ts`](src/core/selection/selectionToVertexIds.ts)
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- [`src/core/commands/mesh/moveVerticesCommand.ts`](src/core/commands/mesh/moveVerticesCommand.ts)

Flow:

1. `app/main.ts` listens for `G`
2. `GrabController.beginFromKey()` expands the current selection into vertex IDs
3. a drag plane is built from camera direction through the selection centroid
4. `src/app/main.ts` requests pointer lock for the modal transform so dragging can continue without cursor edge limits
5. preview movement is applied only to renderer buffers
6. commit should execute `MoveVerticesCommand`
7. cancel restores preview geometry without changing core state
8. the move tool highlight persists after the transform ends until the user switches tools or another shortcut changes it

Important caveat:

- preview and commit both use the command system now
- this is separate from the pointer-driven move gizmo path

### Transform gizmo flow

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- [`src/renderer/gizmos.ts`](src/renderer/gizmos.ts)
- [`src/core/selection/selectionToVertexIds.ts`](src/core/selection/selectionToVertexIds.ts)
- [`src/core/commands/mesh/moveVerticesCommand.ts`](src/core/commands/mesh/moveVerticesCommand.ts)

Flow:

1. when the move tool is highlighted and a selection exists, `app/main.ts` enables the renderer move gizmo
2. `ThreeRenderer` computes the selected element centroid and attaches the gizmo to that world position
3. selecting the move toolbar tool does not start movement immediately; it only arms the gizmo-visible state
4. `bindings.ts` gives the gizmo first chance to capture pointerdown
5. `gizmos.ts` emits axis-constrained drag data for translation, rotation, or scale depending on the active tool
6. `app/main.ts` previews selected vertex edits in the renderer and commits with `MoveVerticesCommand`, `RotateVerticesCommand`, or `ScaleVerticesAxisCommand` on pointer release

### Scale flow (`S`)

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/scaleController.ts`](src/app/scaleController.ts)
- [`src/core/selection/selectionToVertexIds.ts`](src/core/selection/selectionToVertexIds.ts)
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- [`src/core/commands/mesh/scaleVerticesCommand.ts`](src/core/commands/mesh/scaleVerticesCommand.ts)

Flow:

1. `app/main.ts` listens for `S`
2. `ScaleController.beginFromKey()` expands the current selection into vertex IDs
3. the average selected vertex position is used as the scale center
4. `src/app/main.ts` requests pointer lock for the modal transform so dragging can continue without cursor edge limits
5. pointer motion changes the radius from the center on a camera-facing drag plane
6. preview writes explicit per-vertex positions into renderer buffers
7. commit executes `ScaleVerticesCommand`
8. the scale tool highlight persists after the transform ends until the user switches tools or another shortcut changes it

### Rotate flow (`R`)

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/rotateController.ts`](src/app/rotateController.ts)
- [`src/core/selection/selectionToVertexIds.ts`](src/core/selection/selectionToVertexIds.ts)
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- [`src/core/commands/mesh/rotateVerticesCommand.ts`](src/core/commands/mesh/rotateVerticesCommand.ts)

Flow:

1. `app/main.ts` listens for `R`
2. `RotateController.beginFromKey()` expands the current selection into vertex IDs
3. the average selected vertex position is used as the rotation center
4. `src/app/main.ts` requests pointer lock for the modal transform so dragging can continue without cursor edge limits
5. pointer motion on a camera-facing drag plane determines a signed rotation angle
6. preview writes explicit per-vertex rotated positions into renderer buffers
7. commit executes `RotateVerticesCommand`
8. the click that commits rotation is consumed so it does not also deselect the selection

### Extrude flow (`E`)

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/extrudeController.ts`](src/app/extrudeController.ts)
- [`src/core/commands/mesh/replaceMeshCommand.ts`](src/core/commands/mesh/replaceMeshCommand.ts)
- [`src/core/selection/selection.ts`](src/core/selection/selection.ts)
- [`src/core/mesh.ts`](src/core/mesh.ts)

Flow:

1. `app/main.ts` listens for `E` and also arms extrusion from the extrude toolbar button or the right-click context menu
2. `ExtrudeController.beginFromKey()` derives a face region from the current face selection or from faces touched by the current edge/vertex selection
3. the controller computes one average polygon normal for that region
4. when the extrude tool is armed and a face selection exists, `ThreeRenderer` shows a white averaged-normal arrow handle at the region centroid
5. clicking that arrow starts the modal extrude drag
6. `src/app/main.ts` requests pointer lock for the modal transform so dragging can continue without cursor edge limits
7. pointer motion changes the extrusion distance along that shared normal
8. region mode replaces the selected cap with the moved top shell and boundary side walls; the original selected faces are not left in place
9. pressing `E` again during an active face extrusion toggles to an `individual` mode where each selected face extrudes along its own local normal and separates from adjacent selected faces
10. commit executes `ReplaceMeshCommand` with the new topology and selects the new top region
11. cancel restores the pre-extrude mesh snapshot and selection state

### Topology edit actions

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/core/commands/mesh/flipFacesCommand.ts`](src/core/commands/mesh/flipFacesCommand.ts)
- [`src/core/commands/mesh/deleteSelectionCommand.ts`](src/core/commands/mesh/deleteSelectionCommand.ts)
- [`src/core/commands/mesh/mergeVerticesCommand.ts`](src/core/commands/mesh/mergeVerticesCommand.ts)
- [`src/core/commands/mesh/insetFacesCommand.ts`](src/core/commands/mesh/insetFacesCommand.ts)
- [`src/core/commands/mesh/smoothVerticesCommand.ts`](src/core/commands/mesh/smoothVerticesCommand.ts)
- [`src/core/mesh.ts`](src/core/mesh.ts)

Flow:

1. keyboard shortcuts and the right-click context menu both route into `app/main.ts`
2. `FlipFacesCommand` reverses face winding for the selected faces
3. `DeleteSelectionCommand` deletes selected faces directly or deletes faces touched by the current edge/vertex selection, then prunes orphaned vertices
4. `MergeVerticesCommand` collapses the selected vertices to their average position, rewrites affected faces, and drops degenerates
5. `SubdivideFacesCommand` splits the selected faces and also inserts any new edge midpoints into adjacent non-selected face loops so the surrounding topology stays stitched
6. `InsetFacesCommand` performs an independent inset on each selected face by creating an inset polygon plus bridge quads around the perimeter
7. `SmoothVerticesCommand` performs one Laplacian-style smoothing pass over the vertices implied by the current selection by moving each toward the average of its neighboring connected vertices
8. `app/main.ts` rebuilds renderer state after each topology edit so overlays and handles stay aligned

### Inset flow (`I`)

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/insetController.ts`](src/app/insetController.ts)
- [`src/core/commands/mesh/insetFacesCommand.ts`](src/core/commands/mesh/insetFacesCommand.ts)
- [`src/core/commands/mesh/replaceMeshCommand.ts`](src/core/commands/mesh/replaceMeshCommand.ts)

Flow:

1. `app/main.ts` listens for `I` or the `Inset Faces` context-menu action
2. `InsetController.beginFromKey()` snapshots the current face selection and starts a modal preview
3. `src/app/main.ts` requests pointer lock for the modal transform so dragging can continue without cursor edge limits
4. horizontal pointer motion changes the inset amount
5. preview rebuilds the mesh through the shared `buildInsetSnapshot()` helper
6. left click or `Enter` commits with `ReplaceMeshCommand`
7. right click or `Esc` cancels and restores the original mesh snapshot

### Knife flow (`K`)

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/knifeController.ts`](src/app/knifeController.ts)
- [`src/core/commands/mesh/knifeFaceCommand.ts`](src/core/commands/mesh/knifeFaceCommand.ts)

Flow:

1. `app/main.ts` listens for `K` or the `Knife Face` context-menu action in face mode
2. `KnifeController.begin()` enters a click-driven knife state
3. the first left click stores a picked point on a face
4. the second left click on the same face executes `KnifeFaceCommand`
5. `KnifeFaceCommand` projects both picked points onto the nearest boundary edges of that face, inserts the two cut vertices, and replaces the source face with two faces
6. right click or `Esc` cancels the knife state without changing the mesh

### Selection shortcut flow

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/core/selection/selection.ts`](src/core/selection/selection.ts)
- [`src/core/commands/selectionCommands/setSelectionCommand.ts`](src/core/commands/selectionCommands/setSelectionCommand.ts)

Flow:

1. `A` selects all components of the current selection mode
2. `Ctrl+Shift+I` / `Cmd+Shift+I` inverts the current mode-specific selection against the full set of face, edge, or vertex IDs in the mesh
3. both operations route through the same command-backed selection update helper as click and box selection

### Context menu flow

Main files:

- [`src/ui/appShell.ts`](src/ui/appShell.ts)
- [`src/app/main.ts`](src/app/main.ts)

Flow:

1. right-click on the viewport opens a custom shell-owned context menu
2. `app/main.ts` builds grouped items based on the current tool and selection state
3. menu actions call the same tool-switch and command helpers already used by buttons and keyboard shortcuts
4. horizontal separators split the menu into selection modes and edit actions

### Primitive swap flow

Main files:

- [`src/app/main.ts`](src/app/main.ts)
- [`src/core/mesh.ts`](src/core/mesh.ts)
- [`src/core/commands/mesh/replaceMeshCommand.ts`](src/core/commands/mesh/replaceMeshCommand.ts)

Flow:

1. UI button click chooses a primitive kind
2. `app/main.ts` snapshots current mesh and selection
3. a new primitive mesh is created
4. `ReplaceMeshCommand` restores the new mesh snapshot and clears selection
5. renderer buffers and overlays are rebuilt

## Directory map

### `src/main.ts`

Browser entry point.

Used for:
- importing global CSS
- calling `startApp()`

This file should stay thin.

### `src/app/main.ts`

The composition root for the current app.

Owns:
- startup wiring
- the live `mesh` instance
- the live `selection` instance
- the active selection `mode`
- the active editor tool
- context-menu action routing
- the `CommandManager`
- UI sync helpers
- keyboard shortcuts
- primitive swap handling
- grab lifecycle wiring
- rotate lifecycle wiring
- scale lifecycle wiring
- extrude lifecycle wiring
- shared selection update logic for click and box selection

Look here when:
- selection seems to update incorrectly
- overlays are out of sync with core state
- undo/redo behavior is wrong
- a top-level interaction is broken

Notable helpers:
- `formatSelectionText()`
- `syncSelectionOverlays()`
- `syncMeshToRenderer()`
- `applyModeFromSelectionIfNeeded()`
- `applySelectionUpdate()`

Important note:
- this file currently carries a lot of policy and is the main integration hotspot
- highlighted tool state does not disable normal selection; selection is only blocked while a transform is actively running
- the left click that commits an active transform is intentionally suppressed from also triggering selection changes
- active move, rotate, and scale tool highlights control which renderer gizmo mode is shown for the current selection
- toolbar switching into move, rotate, or scale does not auto-begin a keyboard-modal transform
- gizmo drags preview in the renderer and commit through `MoveVerticesCommand`, `RotateVerticesCommand`, or `ScaleVerticesAxisCommand` on pointer release
- extrude has no gizmo path today; it is a keyboard/toolbar-started modal topology edit that commits through `ReplaceMeshCommand`

### `src/app/grabController.ts`

Encapsulates the `G`-key vertex/edge/face grab workflow.

Responsible for:
- expanding selection to vertex IDs
- computing centroid/pivot
- building a camera-facing drag plane
- turning pointer motion into a world delta
- applying preview deltas through renderer callbacks
- committing or canceling the operation

Look here when:
- grab starts from the wrong pivot
- plane/ray intersection behaves strangely
- preview movement differs from committed movement

Important note:
- it depends on app-provided callbacks rather than owning renderer or mesh lifecycle itself

### `src/app/scaleController.ts`

Encapsulates the `S`-key scale workflow.

Responsible for:
- expanding selection to vertex IDs
- computing the centroid of the selected vertices
- using that centroid as the scale center
- converting pointer motion into a scalar scale factor
- previewing scaled vertex positions through renderer callbacks
- committing or canceling the operation

Look here when:
- scaling uses the wrong center
- scaling feels too sensitive
- preview scale differs from committed scale

Important note:
- this controller is for modal uniform scale started by `S`; toolbar scale gizmo drags use the renderer gizmo path plus `ScaleVerticesAxisCommand` instead

### `src/app/rotateController.ts`

Encapsulates the `R`-key rotate workflow.

Responsible for:
- expanding selection to vertex IDs
- computing the centroid of the selected vertices
- using camera forward as the rotation axis for the current interaction
- converting pointer motion on the drag plane into a signed angle
- previewing rotated vertex positions through renderer callbacks
- committing or canceling the operation

Look here when:
- rotation direction feels inverted
- rotation angle is unstable
- preview rotation differs from committed rotation

Important note:
- this controller is for modal camera-plane rotation started by `R`; toolbar rotate gizmo drags use the renderer gizmo path plus `RotateVerticesCommand`

### `src/app/extrudeController.ts`

Encapsulates the `E`-key and toolbar extrude workflow.

Responsible for:
- deriving a face region from face, edge, or vertex selection
- computing the shared average normal for that region
- converting pointer motion into an extrusion distance along that normal
- previewing topology edits by rebuilding mesh snapshots in place
- committing or canceling the topology change

Look here when:
- extrusion goes in the wrong direction
- edge or vertex selection extrudes the wrong incident faces
- preview topology differs from the committed topology

Important note:
- unlike move/rotate/scale, this controller previews by restoring whole mesh snapshots because extrusion changes topology rather than only positions

## Core layer

### `src/core/mesh.ts`

The main geometry model.

Owns:
- vertices, faces, and derived edges
- stable IDs for topology elements
- topology lookup maps
- snapshots and restore
- primitive mesh factories

Used by:
- app startup
- renderer mesh rebuilds
- selection expansion
- mesh edit commands

Look here when:
- IDs do not stay stable
- topology seems inconsistent
- primitive generation is wrong
- a mesh restore/snapshot behaves unexpectedly

### `src/core/ids/ids.ts`

Small shared ID helper.

Owns:
- the `Id` type
- `makeId()`

### `src/core/selection/selection.ts`

Core selection state and operations.

Owns:
- active selection mode
- selected face IDs
- selected edge IDs
- selected vertex IDs
- snapshots and snapshot restore
- replace/toggle helpers
- selection-mode inference from populated sets

Important note:
- `applySelectionSnapshot()` intentionally does not change `sel.mode`
- mode and selected IDs are related, but not fully unified yet

### `src/core/selection/selectionToVertexIds.ts`

Selection expansion helper.

Used for:
- converting face, edge, or vertex selection into a de-duplicated vertex ID list
- powering grab, scale, and any future vertex-level transform tools

This is the bridge between selection semantics and vertex-edit semantics.

### `src/core/tolerances.ts`

Central interaction tuning constants.

Used for:
- pick radius thresholds

This is where picking feel should be tuned before scattering constants elsewhere.

## Commands layer

### `src/core/commands/command.ts`

Base undoable command contract.

Defines:
- `name`
- `do(ctx)`
- `undo(ctx)`

### `src/core/commands/commandManager.ts`

Undo/redo history manager.

Owns:
- undo stack
- redo stack
- optional history limit

Used by:
- selection changes
- primitive swaps
- intended future mesh/object transform commands

### `src/core/commands/selectionCommands/setSelectionCommand.ts`

Undoable selection snapshot swap.

Used for:
- normal click selection changes
- shift-toggle selection changes

This is the main stable command implementation currently used in the app.

It now backs both single-click selection and drag-box selection.

### `src/core/commands/mesh/replaceMeshCommand.ts`

Undoable whole-mesh replacement.

Used for:
- primitive swaps

Behavior:
- restores a mesh snapshot
- restores a paired selection snapshot

### `src/core/commands/mesh/moveVerticesCommand.ts`

Undoable vertex translation command for grab commit.

Behavior:
- stores the original positions for the affected vertices
- reapplies translation in `do(...)`
- restores original positions in `undo(...)`

### `src/core/commands/mesh/scaleVerticesCommand.ts`

Undoable centroid-based vertex scaling command.

Behavior:
- stores the original positions for the affected vertices
- scales each selected vertex around a provided center point
- restores original positions in `undo(...)`

### `src/core/commands/mesh/scaleVerticesAxisCommand.ts`

Undoable axis-constrained gizmo scale command.

Behavior:
- stores the original positions for the affected vertices
- scales each selected vertex along a provided axis around a provided center point
- restores original positions in `undo(...)`

### `src/core/commands/mesh/rotateVerticesCommand.ts`

Undoable centroid-based vertex rotation command.

Behavior:
- stores the original positions for the affected vertices
- rotates each selected vertex around a provided center point and axis
- restores original positions in `undo(...)`

### Placeholder command files

These exist but are currently empty:

- [`src/core/commands/commandStack.ts`](src/core/commands/commandStack.ts)
- [`src/core/commands/setObjectTransformCommand.ts`](src/core/commands/setObjectTransformCommand.ts)
- [`src/core/commands/transformObjectCommand.ts`](src/core/commands/transformObjectCommand.ts)

They are not part of the live app flow right now.

## Renderer layer

### `src/renderer/threeRenderer.ts`

Main renderer/controller integration file.

Owns:
- WebGL renderer
- scene
- perspective camera
- `OrbitControls`
- triangulated render geometry
- stable-ID bridges from core IDs to render indices
- base overlays and selection overlays
- vertex position preview buffers
- preview application for both translation and arbitrary explicit vertex positions
- rectangle-based bulk selection queries for vertices, edges, and faces
- selection-centroid transform gizmo activation, pointer routing, hover, and centroid tracking

Look here when:
- scene rendering is wrong
- overlays do not line up with geometry
- picking returns the wrong element
- marquee selection returns the wrong elements
- preview edits are not visible
- gizmo position or drag behavior is wrong

Important note:
- the old object-transform gizmo path is still intentionally disabled; the live path is selection-centroid vertex editing only

Important note:
- this file is the renderer orchestrator, not a pure renderer utility

### `src/renderer/picking.ts`

Picking math and helpers.

Owns:
- face raycast picking
- screen-space edge picking
- screen-space vertex picking
- edge-key construction from core faces
- viewport/canvas size helpers

Used by:
- `ThreeRenderer.pick()`
- the UI pointer pipeline

Important note:
- face picks use triangle intersections but map back to stable core face IDs

### `src/renderer/overlays.ts`

Overlay construction and selection highlight rendering.

Owns:
- base edge overlay
- base vertex overlay
- selected face highlight mesh
- selected edge highlight lines
- selected vertex highlight points
- display-mode visibility rules

Look here when:
- highlight visuals are wrong
- vertex points should change appearance
- edge/face overlays need redesign

Important note:
- selection highlight is built from triangulated render data while preserving core face identity

### `src/renderer/gizmos.ts`

Renderer-level transform gizmo implementation.

Owns:
- translate, rotate, and scale gizmo visuals
- gizmo hit testing
- gizmo drag plane logic
- hover state and handle highlighting
- world-space drag delta, angle, and scale-factor emission

Current role:
- live selection-centroid transform gizmo for world-axis translate, rotate, and scale
- emits axis-constrained drag data to the app layer, which owns preview and command commit policy

### `src/renderer/sync/applySelectionToScene.ts`

Currently empty placeholder for future renderer-sync extraction.

Potential future role:
- moving selection-to-overlay sync logic out of `app/main.ts`

## UI layer

### `src/ui/appShell.ts`

DOM shell construction and inline shell styling.

Owns:
- sidebar/panel markup
- vertical editor tool bar markup
- selection mode radio buttons
- primitive swap buttons
- viewport canvas creation
- shell-local CSS injection

Public API returned by `mountAppShell()`:
- `canvas`
- `setSelectionText()`
- `onModeChange()`
- `setMode()`
- `onToolChange()`
- `setTool()`
- `onPrimitiveSwap()`

Look here when:
- the visible UI structure should change
- the toolbar/panel layout should change
- shell-local CSS should change

Important note:
- the vertical tool bar currently exposes `select`, `move`, `rotate`, and `scale`; choosing a transform tool changes active tool state and matching gizmo visibility, but does not immediately start a modal transform

### `src/ui/bindings.ts`

Pointer and UI glue.

Responsible for:
- pointer tracking
- screen to NDC conversion
- gizmo capture handoff
- single-click selection dispatch
- drag-box marquee lifecycle
- bulk selection dispatch
- one-shot suppression of the click that commits an active transform
- lightweight status text updates
- forwarding pointer state to app code

Look here when:
- clicks do not pick correctly
- drag-box selection feels wrong
- gizmo drag capture conflicts with selection
- pointer coordinates look stale

Important note:
- this file already owns a pointer-state pipeline
- `app/main.ts` also tracks pointer state for grab, rotate, and scale, so there is some duplication to clean up later
- `app/main.ts` also tracks pointer state for grab, rotate, scale, and extrude, so there is some duplication to clean up later

## Misc files

### `src/style.css`

Global Vite-level stylesheet.

Current role:
- page/base styles

Important note:
- most app-specific shell styling currently lives in [`src/ui/appShell.ts`](src/ui/appShell.ts), not here

### `src/counter.ts`

Leftover Vite starter example.

Current status:
- not used by the modeling app

### `src/typescript.svg`

Leftover Vite starter asset.

Current status:
- not part of the app logic

## Empty placeholders

These files are currently empty and safe to ignore unless you are explicitly building those systems:

- [`src/core/editor/editorModel.ts`](src/core/editor/editorModel.ts)
- [`src/core/project/projectModel.ts`](src/core/project/projectModel.ts)
- [`src/core/math/transform.ts`](src/core/math/transform.ts)
- [`src/renderer/sync/applySelectionToScene.ts`](src/renderer/sync/applySelectionToScene.ts)
- [`src/core/commands/commandStack.ts`](src/core/commands/commandStack.ts)
- [`src/core/commands/setObjectTransformCommand.ts`](src/core/commands/setObjectTransformCommand.ts)
- [`src/core/commands/transformObjectCommand.ts`](src/core/commands/transformObjectCommand.ts)

## Known rough edges

These are worth knowing before debugging too deeply:

- `src/app/main.ts` is the integration bottleneck and currently owns a lot of unrelated responsibilities
- selection mode and selection contents are related but not fully modeled as one source of truth
- pointer tracking exists in both `bindings.ts` and `app/main.ts`
- the old object gizmo code still exists but is intentionally disabled
- some files still contain debugging comments or MVP-era notes
- some Vite starter files are still present and can distract from the real codepath

## Quick lookup

Where is selection stored?
- [`src/core/selection/selection.ts`](src/core/selection/selection.ts)

Where is mesh data stored?
- [`src/core/mesh.ts`](src/core/mesh.ts)

Where does picking start?
- [`src/ui/bindings.ts`](src/ui/bindings.ts)

Where is picking math implemented?
- [`src/renderer/picking.ts`](src/renderer/picking.ts)

Where are selection highlights rendered?
- [`src/renderer/overlays.ts`](src/renderer/overlays.ts)

Where are renderer buffers rebuilt from the core mesh?
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)

Where is undo/redo managed?
- [`src/core/commands/commandManager.ts`](src/core/commands/commandManager.ts)

Where does primitive swapping happen?
- [`src/app/main.ts`](src/app/main.ts)
- [`src/core/commands/mesh/replaceMeshCommand.ts`](src/core/commands/mesh/replaceMeshCommand.ts)

Where does grab start?
- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/grabController.ts`](src/app/grabController.ts)

Where does scale start?
- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/scaleController.ts`](src/app/scaleController.ts)

Where does rotate start?
- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/rotateController.ts`](src/app/rotateController.ts)

Where does extrude start?
- [`src/app/main.ts`](src/app/main.ts)
- [`src/app/extrudeController.ts`](src/app/extrudeController.ts)

Where do gizmo-driven transforms start?
- [`src/ui/bindings.ts`](src/ui/bindings.ts)
- [`src/renderer/threeRenderer.ts`](src/renderer/threeRenderer.ts)
- [`src/renderer/gizmos.ts`](src/renderer/gizmos.ts)

Where are vertex transform commands?
- [`src/core/commands/mesh/moveVerticesCommand.ts`](src/core/commands/mesh/moveVerticesCommand.ts)
- [`src/core/commands/mesh/rotateVerticesCommand.ts`](src/core/commands/mesh/rotateVerticesCommand.ts)
- [`src/core/commands/mesh/scaleVerticesAxisCommand.ts`](src/core/commands/mesh/scaleVerticesAxisCommand.ts)
- [`src/core/commands/mesh/scaleVerticesCommand.ts`](src/core/commands/mesh/scaleVerticesCommand.ts)

Which files are likely unfinished?
- the placeholder files listed above

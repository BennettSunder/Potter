# AI Helper

Shared quick-reference for you and Codex so common project locations are easy to find.

## Usage Rules
- Before making edits, check this file for likely locations first.
- Check `CODE_MAP.md` for file-by-file summaries (`used for`, `variables`, `functions`, `relevant tags`).
- After any file change, append a short entry to `CHANGELOG.md`.
- After any file change, keep `AI_HELPER.md` and `CODE_MAP.md` in sync with behavior or architecture changes introduced by that edit set.
- Keep this file concise and update it when architecture or paths change.

## Commands
- Install deps: `npm install`
- Dev server: `npm run dev`
- Build: `npm run build`
- Preview build: `npm run preview`
- Fast file search: `rg --files`
- Fast text search: `rg "pattern" src`

## Project Map
- App entry:
  - `src/main.ts`
  - `src/app/main.ts`
  - `src/app/grabController.ts`
  - `src/app/rotateController.ts`
  - `src/app/scaleController.ts`
  - `src/app/extrudeController.ts`
  - `src/app/insetController.ts`
  - `src/app/knifeController.ts`
- UI:
- `src/ui/appShell.ts`
- `src/ui/bindings.ts`
- `src/style.css`
- Renderer:
  - `src/renderer/threeRenderer.ts`
  - `src/renderer/picking.ts`
  - `src/renderer/gizmos.ts`
  - `src/renderer/overlays.ts`
  - `src/renderer/sync/applySelectionToScene.ts`
- Core data/model:
  - `src/core/editor/editorModel.ts`
  - `src/core/project/projectModel.ts`
- `src/core/mesh.ts`
- Selection:
  - `src/core/selection/selection.ts`
  - `src/core/selection/selectionToVertexIds.ts`
- Commands/undo-redo:
  - `src/core/commands/command.ts`
  - `src/core/commands/commandManager.ts`
  - `src/core/commands/commandStack.ts`
  - `src/core/commands/setObjectTransformCommand.ts`
  - `src/core/commands/transformObjectCommand.ts`
  - `src/core/commands/mesh/moveVerticesCommand.ts`
- `src/core/commands/mesh/rotateVerticesCommand.ts`
- `src/core/commands/mesh/scaleVerticesAxisCommand.ts`
- `src/core/commands/mesh/scaleVerticesCommand.ts`
- `src/core/commands/mesh/replaceMeshCommand.ts`
- `src/core/commands/mesh/flipFacesCommand.ts`
  - `src/core/commands/mesh/deleteSelectionCommand.ts`
  - `src/core/commands/mesh/mergeVerticesCommand.ts`
  - `src/core/commands/mesh/insetFacesCommand.ts`
  - `src/core/commands/mesh/knifeFaceCommand.ts`
  - `src/core/commands/mesh/setFaceShadingCommand.ts`
  - `src/core/commands/mesh/smoothVerticesCommand.ts`
  - `src/core/commands/selectionCommands/setSelectionCommand.ts`
- Full file-by-file summaries:
  - `CODE_MAP.md`

## Current Interaction Notes
- `src/ui/appShell.ts` now includes `select`, `move`, `rotate`, `scale`, and `extrude` tools in the vertical editor tool bar.
- The highlighted editor tool is persistent UI state; keyboard-started modal actions no longer overwrite that toolbar highlight, so the previously armed tool remains selected after the action finishes.
- The transform toolbar modes now expose matching gizmos at the current selection centroid: arrows for move, rings for rotate, and box handles for scale.
- Clicking the `move`, `rotate`, or `scale` toolbar tool changes the active tool highlight only; transforms still start from direct gizmo drag or keyboard shortcuts, not immediately on tool switch.
- Clicking the `extrude` toolbar tool arms the extrusion workflow; extrusion now starts from the white averaged-normal arrow handle or from the `E` shortcut.
- The top-right hamburger app menu now exposes `Import OBJ` and `Export OBJ`; import uses a styled `Yes / No / Cancel` prompt to optionally save the current model first, then replaces the editable mesh with the uploaded OBJ contents.
- Face mode now supports `Shade Smooth` and `Shade Flat` actions from the context menu; OBJ export writes matching smoothing state.
- `G` starts grab/translate for the currently selected vertices, edges, or faces.
- `R` starts centroid-based rotation on a camera-facing plane for the currently selected vertices, edges, or faces.
- `S` starts centroid-based scaling for the currently selected vertices, edges, or faces.
- Keyboard-started modal grab/rotate/scale/extrude/inset transforms request pointer lock so dragging can continue past the viewport edges.
- Holding `Ctrl+Alt` turns left-drag into camera panning, and adding `Shift` changes that left-drag camera action to rotation.
- `E` starts modal extrusion for the selected region using the average normal of the selected faces or the faces touched by the current edge/vertex selection.
- Pressing `E` again during an active face extrusion toggles to independent per-face extrusion along each face's own normal.
- `I` starts modal per-face inset preview on the selected faces; horizontal pointer motion controls inset amount.
- `K` starts a first-pass knife mode in face mode; the first left click stores a cut point and the second left click on the same face commits a single-face cut.
- `V` smooths the vertices implied by the current face, edge, or vertex selection.
- `F` flips the winding of the selected faces.
- `Delete` / `Backspace` deletes the current selection and prunes orphaned vertices.
- `M` merges the selected vertices to their average position in vertex mode.
- `A` selects everything in the current selection mode.
- `Ctrl+Shift+I` / `Cmd+Shift+I` inverts the current selection in the current selection mode.
- Active modal tools now commit on left mouse release or `Enter`, and cancel on right click or `Esc`.
- Knife mode cancels on right click or `Esc`; this first version is a single-face two-click cut, not a full freehand Blender-style knife.
- `Subdivide Faces` now stitches adjacent non-selected faces by inserting split-edge midpoints into their boundary loops instead of leaving cracks around the subdivided region.
- Dragging in selection mode now performs box selection after a small movement threshold; simple clicks still do single-pick selection.
- Extrude preview mutates the mesh topology temporarily and commits through `ReplaceMeshCommand`; move/rotate/scale still preview through renderer-only geometry edits.
- Right click on the viewport now opens a custom context menu with grouped selection-mode and edit actions in addition to the existing toolbar buttons and shortcuts.
- The old object gizmo code still exists in the renderer layer, but it is intentionally disabled.

## Quick Update Template
Use this format for `CHANGELOG.md` entries:

```md
## YYYY-MM-DD
- Short summary of change.
- Short summary of change.
```

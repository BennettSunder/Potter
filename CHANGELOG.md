# Changelog

All notable repository changes should be logged here in reverse chronological order.

## 2026-03-03
- Added OBJ import through the top-right app menu, including a styled `Yes / No / Cancel` pre-import prompt to save the current model as a download, and wired imported OBJ meshes back into the editable core mesh/selection flow.
- Added per-face smooth/flat shading state in `src/core/mesh.ts`, renderer support in `src/renderer/threeRenderer.ts`, `Shade Smooth` / `Shade Flat` face actions in `src/app/main.ts`, and OBJ export smoothing directives so exported meshes preserve the intended shading mode.
- Added a top-right hamburger app menu in `src/ui/appShell.ts` with an `Export OBJ` action, and wired `src/app/main.ts` to serialize the current polygon mesh to a downloadable `.obj` file.
- Changed keyboard-started move, rotate, scale, extrude, inset, and knife actions so they no longer overwrite the persistent selected toolbar tool; after the modal action finishes, the previously armed tool button remains selected.
- Added a first-pass knife tool with `K` and a `Knife Face` context-menu action, implemented through `src/app/knifeController.ts` and `src/core/commands/mesh/knifeFaceCommand.ts` as a two-click single-face cut that splits one face along two picked boundary points.
- Updated `src/core/commands/mesh/subdivideFacesCommand.ts` so subdividing a face also inserts the new split-edge midpoints into adjacent non-selected faces, stitching the boundary instead of leaving neighboring polygons separated.
- Added pointer-lock-backed infinite dragging for keyboard-started modal grab, rotate, scale, extrude, and inset transforms so they can continue smoothly when the mouse reaches the viewport edge.
- Replaced the fixed inset action with `src/app/insetController.ts`, making inset a modal preview tool started with `I` or the context menu, previewed live from horizontal pointer motion, committed with left click or `Enter`, and canceled with right click or `Esc`.
- Added laptop-friendly camera drag modifiers: `Ctrl+Alt+left-drag` pans the camera, while `Ctrl+Alt+Shift+left-drag` rotates it.
- Added first-pass vertex smoothing through `src/core/commands/mesh/smoothVerticesCommand.ts`, exposed via `V` and the context menu, operating on vertices implied by the current face/edge/vertex selection.
- Reworked `src/app/extrudeController.ts` so region extrusion replaces the selected source faces with a translated top shell instead of leaving the original cap in place.
- Fixed extrusion face orientation by aligning top faces to the extrusion normal and orienting side walls from the actual extrusion offset and boundary edge direction.
- Added a second extrusion mode: pressing `E` again while a face extrusion is active now toggles from region extrusion to independent per-face extrusion along each face's own normal.
- Added first-pass face inset through `src/core/commands/mesh/insetFacesCommand.ts`, exposed via `I` in face mode and the context menu as an independent per-face inset operation.
- Added mode-aware `A` select-all and `Ctrl+Shift+I` / `Cmd+Shift+I` invert-selection shortcuts using the existing command-backed selection path.
- Added face normal flipping with `F` through `src/core/commands/mesh/flipFacesCommand.ts`, wired in `src/app/main.ts` as an undoable face-winding edit.
- Added selection deletion with `Delete` / `Backspace` through `src/core/commands/mesh/deleteSelectionCommand.ts`; face mode deletes selected faces, while edge and vertex mode delete faces touched by the current selection and prune orphaned vertices.
- Added vertex merge-at-center with `M` in vertex mode through `src/core/commands/mesh/mergeVerticesCommand.ts`, collapsing the selected vertices to their average position and dropping degenerate faces.
- Added `Mesh.setFaceVerts()` in `src/core/mesh.ts` to support face-winding edits and other topology commands.
- Added an averaged-normal extrude preview arrow and made `src/renderer/threeRenderer.ts` own a dedicated extrusion handle path instead of treating the arrow as a passive visual.
- Changed the extrude preview arrow to white, kept it visible while extrusion is active or while the extrude tool is armed on a face selection, and made clicking the arrow start extrusion.
- Changed the extrude toolbar tool so selecting it arms extrusion instead of immediately starting the modal action.
- Added a custom right-click context menu in `src/ui/appShell.ts` with horizontal separators and grouped actions for selection modes, tools, edit actions, and primitive swaps.
- Wired the new context menu through `src/app/main.ts` so it reuses the same command and tool paths as the existing toolbar buttons and keyboard shortcuts.
- Added `.gitignore` for dependencies, build output, logs, OS artifacts, and editor swap/config files.
- Pruned stale edge IDs in `src/core/mesh.ts` during `rebuildMaps()` to avoid unbounded `edgeIdByKey` growth after topology edits and mesh replacement.
- Removed debug logging from hot mesh-sync paths and dropped the old synthetic middle-click orbit-release workaround.

## 2026-03-02
- Added modal extrusion with `E`, a new extrude toolbar tool, and `src/app/extrudeController.ts` to preview and commit topology-changing extrusions through `ReplaceMeshCommand`.
- Extrusion now derives an average normal from the currently selected faces or from faces touched by the current edge/vertex selection, then extrudes that region along the shared normal.
- Extended `src/renderer/gizmos.ts` into a mode-aware translate/rotate/scale gizmo system and updated `src/renderer/threeRenderer.ts` to switch gizmo mode from the active editor tool.
- Updated `src/app/main.ts` so move, rotate, and scale toolbar modes each show a matching gizmo and commit through the appropriate preview/command path.
- Added `src/core/commands/mesh/scaleVerticesAxisCommand.ts` so the scale gizmo can commit axis-constrained scaling with undo/redo support.
- Added modal rotation with `R`, a new rotate toolbar tool, `src/app/rotateController.ts`, and `src/core/commands/mesh/rotateVerticesCommand.ts` for command-backed preview, commit, and undo.
- Updated transform input handling so the left click that commits grab/scale/rotate does not also fall through into a selection or deselection change.
- Changed `src/app/main.ts` so clicking the move or size toolbar tool no longer starts an immediate transform; the toolbar now switches mode only, with move gizmo visibility handled separately.
- Replaced the inert renderer gizmo path with a selection-centroid move gizmo that supports axis-constrained dragging and commits through `MoveVerticesCommand`.
- Restyled `src/renderer/gizmos.ts` to render a Blender/Godot-like translate gizmo with colored X/Y/Z arrows and axis highlighting.
- Updated `src/renderer/threeRenderer.ts` to anchor the move gizmo to the current selection centroid and keep it synced through selection changes and preview edits.
- Updated `src/app/main.ts` so gizmo drags preview selected vertex movement and commit on pointer release using the command system.
- Changed `src/app/main.ts` so the highlighted editor tool persists after move/scale commits or cancels, keyboard shortcuts update that highlight, and selection remains available whenever a transform is not actively running.
- Added a vertical editor tool bar in `src/ui/appShell.ts` for select, move, and size using the same icon-button styling as the selection mode bar.
- Wired the editor tool bar through `src/app/main.ts` so move and size can be started from the UI and the active tool returns to select after commit or cancel.
- Added drag-box selection in `src/ui/bindings.ts` with a screen-space marquee and click-vs-drag threshold.
- Extended `src/renderer/threeRenderer.ts` with rectangle-based bulk selection for vertices, edges, and faces using projected screen-space bounds.
- Refactored selection application in `src/app/main.ts` so click-pick and box-pick both use the same command-backed selection update path.
- Updated `AI_HELPER.md` and `CODE_MAP.md` to reflect the editor tool bar, drag-box selection, and documentation workflow requirement.
- Disabled the current object gizmo path so it no longer captures pointer input or moves the mesh object.
- Added `S` as a scale hotkey with centroid-based vertex scaling around the average selected vertex position.
- Added `src/app/scaleController.ts` to manage modal scale preview, commit, and cancel behavior.
- Added `src/core/commands/mesh/scaleVerticesCommand.ts` for undoable vertex scaling.
- Repaired `src/core/commands/mesh/moveVerticesCommand.ts` so grab commits use the command system correctly.
- Extended renderer preview support so tools can preview explicit vertex positions, not only translation deltas.
- Fixed existing TypeScript issues in selection, overlays, gizmos, and command typings so `npm run build` passes.
- Updated `AI_HELPER.md` and `CODE_MAP.md` to reflect the scale tool, disabled gizmo behavior, and current architecture.

## 2026-02-27
- Added `CHANGELOG.md` to track file changes made in this project.
- Added `AI_HELPER.md` as a quick-reference index for key files, commands, and update workflow.
- Added `CODE_MAP.md` with file-oriented summaries and a quick Q&A for common navigation questions.
- Updated `AI_HELPER.md` to point to `CODE_MAP.md` for fast codebase navigation.
- Expanded `CODE_MAP.md` to cover the full `src/` tree, including placeholder and starter files.
- Updated `AI_HELPER.md` project map to explicitly include the full `CODE_MAP.md` reference.

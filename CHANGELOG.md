# Changelog

All notable repository changes should be logged here in reverse chronological order.

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

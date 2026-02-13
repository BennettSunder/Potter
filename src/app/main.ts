// src/app/main.ts
//
// App entry point (current MVP).
//
// Responsibilities (for now):
// - Mount UI shell
// - Create renderer + initial mesh
// - Own the Selection state (core/selection/selection)
// - Bind UI events (pointer picking, mode changes, gizmo capture) via ui/binding.ts
//
// IMPORTANT: UI code does not mutate mesh state directly.
// Selection changes are done via core/selection/selection helpers.
// (Later: transforms become Commands + undo/redo.)

import { mountAppShell } from "../ui/appShell";
import { bindUI } from "../ui/bindings";
import { ThreeRenderer } from "../renderer/threeRenderer";
import { makeUnitCubeMesh, type Vec3, type Mesh } from "../core/mesh";
import {
    clearSelection,
    makeSelection,
    replaceEdges,
    replaceFaces,
    replaceVertices,
    setSelectionMode,
    toggleEdge,
    toggleFace,
    toggleVertex,
    type SelectionMode,
    snapshotSelection,
    applySelectionSnapshot,
    selectionSnapshotEquals,
    inferSelectionModeFromSelection,
} from "../core/selection/selection";
import type { PickHit } from "../renderer/picking";

import { CommandManager } from "../core/commands/commandManager";
import {
    SetSelectionCommand,
    type SelectionContext,
} from "../core/commands/selectionCommands/setSelectionCommand";
import { GrabController } from "./grabController";

// --------------------
// Formatting utilities
// --------------------

function fmtNum(n: number): string {
    // Keeps output tidy (avoids "-0")
    const v = Math.abs(n) < 1e-9 ? 0 : n;
    return String(v);
}

function fmtVec3(p: Vec3): string {
    return `(${fmtNum(p.x)}, ${fmtNum(p.y)}, ${fmtNum(p.z)})`;
}

function formatSelectionText(sel: ReturnType<typeof makeSelection>, mesh: Mesh): string {
    if (sel.mode === "face") {
        const n = sel.faceIds.size;
        return n ? `mode: face (${n})` : "mode: face (none)";
    }

    if (sel.mode === "edge") {
        const n = sel.edgeIds.size;
        return n ? `mode: edge (${n})` : "mode: edge (none)";
    }

    // vertex mode: list vertex positions for selected vertex IDs
    const n = sel.vertexIds.size;
    if (!n) return "mode: vertex (none)";

    const verts = mesh.getVertices();

    const parts: string[] = [];
    for (const vId of sel.vertexIds) {
        try {
            const i = mesh.getVertexIndex(vId);
            const p = verts[i]?.position;
            if (p) parts.push(fmtVec3(p));
        } catch {
            // If an ID is invalid for some reason, skip it (shouldn't happen in normal use)
        }
    }

    const list = parts.length ? parts.join(", ") : "(invalid ids)";
    return `mode: vertex (${n}) ${list}`;
}

// --------------------
// App boot
// --------------------

export function startApp(): void {
    const root = document.querySelector<HTMLDivElement>("#app");
    if (!root) throw new Error("Missing #app");

    const ui = mountAppShell(root);
    const renderer = new ThreeRenderer(ui.canvas);

    // Use the same canvas the renderer is using
    const canvas = ui.canvas;

    // Core mesh (polygons); renderer triangulates for display/picking
    const mesh = makeUnitCubeMesh();
    renderer.setMesh(mesh);

    // Selection state lives in core
    const selection = makeSelection();
    let mode: SelectionMode = selection.mode;

    // Undo/redo manager (selection-only for now)
    const commands = new CommandManager<SelectionContext>();
    const cmdCtx: SelectionContext = { selection };

    renderer.setDisplayMode(mode);
    ui.setSelectionText(formatSelectionText(selection, mesh));

    const syncUI = () => ui.setSelectionText(formatSelectionText(selection, mesh));

    const syncSelectionOverlays = () => {
        renderer.setSelectedFaces(selection.faceIds);
        renderer.setSelectedEdges(selection.edgeIds);
        renderer.setSelectedVertices(selection.vertexIds);

        // Optional: enable gizmo when something is selected (faces/edges/verts)
        const anySelected =
        selection.faceIds.size > 0 || selection.edgeIds.size > 0 || selection.vertexIds.size > 0;
        renderer.setGizmoActive(anySelected);
    };

    const syncMeshToRenderer = () => {
        // Rebuild render buffers after mesh edits (command commits, topology changes, etc.)
        renderer.setMesh(mesh);

        // Keep selection overlays consistent after rebuild
        syncSelectionOverlays();
        syncUI();
        console.log("syncMeshToRenderer called");

    };

    /**
     * During grab previews we mutate vertex positions in the core mesh.
     * Renderer currently does NOT live-update BufferGeometry attributes, so we rebuild.
     * Keep this lightweight-ish: for MVP this is acceptable.
     */
    const requestRenderSync = () => {
        syncMeshToRenderer();
    };

    const applyModeFromSelectionIfNeeded = () => {
        const inferred = inferSelectionModeFromSelection(selection);
        if (!inferred) return; // keep current mode when nothing selected
        if (inferred === mode) return;

        mode = inferred;

        // IMPORTANT: do NOT call setSelectionMode here (it clears selection).
        // We only change how we interpret/display picks + how overlays render.
        renderer.setDisplayMode(mode);

        // Requires ui.setMode(mode) to be added to the AppShell API
        ui.setMode(mode);
    };

    syncSelectionOverlays();

    // --------------------
    // Pointer tracking (for Grab)
    // --------------------

    // Local pointer state (screen/client coords). Avoid globals.
    let lastClientX = 0;
    let lastClientY = 0;
    let hasPointer = false;

    const updatePointer = (e: PointerEvent) => {
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        hasPointer = true;
    };

    const getPointerClientPos = () => {
        if (hasPointer) return { x: lastClientX, y: lastClientY };

        // fallback: canvas center before any pointer activity
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    };

    // Track pointer position on window so it stays valid even if pointer leaves canvas.
    window.addEventListener("pointerup", updatePointer, { capture: true });
    window.addEventListener("pointerenter", updatePointer, { capture: true });


    // --------------------
    // Grab (G) controller
    // --------------------

    // GrabController needs a camera. Prefer an explicit getter on the renderer,
    // but allow fallback to a public field if that's what you have today.
    const camera =
    (renderer as any).getCamera?.() ??
    (renderer as any).camera ??
    undefined;

    const syncCameraForPicking = () => {
        (renderer as any).forceCameraUpdate?.();
        // Safety: even if renderer doesn't expose forceCameraUpdate, ensure matrices are fresh.
        if (camera) {
            camera.updateMatrixWorld(true);
            (camera as any).updateProjectionMatrix?.();
        }
    };

    const grab = camera
    ? new GrabController(
        mesh,
        selection,
        commands,
        cmdCtx,
        camera,
        () => canvas,
                         getPointerClientPos,
                         syncCameraForPicking,
                         requestRenderSync
    )
    : null;

    // While grabbing: pointermove should drive preview updates.
    // NOTE: GrabController reads pointer via getPointerClientPos(), not event args.
    window.addEventListener(
        "pointermove",
        (e) => {
            updatePointer(e);
            if (grab?.isActive()) grab.onPointerMove();
            console.log("pm", e.clientX, e.clientY, "grab", grab?.isActive());
        },
        { capture: true }
    );

    window.addEventListener(
        "pointerdown",
        (e) => {
            updatePointer(e);

            if (!grab?.isActive()) return;

            if (e.button === 0) {
                e.preventDefault();
                grab.commit();
            } else if (e.button === 2) {
                e.preventDefault();
                grab.cancel();
            }
        },
        { capture: true }
    );


    // Prevent context menu while grabbing (right click = cancel)
    window.addEventListener("contextmenu", (e) => {
        if (grab?.isActive()) e.preventDefault();
    });

        // --------------------
        // Keyboard shortcuts
        // --------------------

        const isMac = () => navigator.platform.toLowerCase().includes("mac");

        window.addEventListener("keydown", (e) => {
            // If grab mode is active, Esc/Enter should work regardless of modifiers.
            if (grab?.isActive()) {
                const k = e.key.toLowerCase();
                if (k === "escape") {
                    e.preventDefault();
                    grab.cancel();
                    return;
                }
                if (k === "enter") {
                    e.preventDefault();
                    grab.commit();
                    return;
                }
            }

            // Start grab with G (when there is a selection)
            if ((e.key === "g" || e.key === "G") && grab) {
                // Avoid typing 'g' into text fields
                const tag = (e.target as HTMLElement | null)?.tagName ?? "";
                if (tag === "INPUT" || tag === "TEXTAREA") return;

                // Ensure camera state is fresh right at grab start.
                syncCameraForPicking();

                e.preventDefault();
                grab.beginFromKey();
                return;
            }

            // Selection undo/redo
            const mod = isMac() ? e.metaKey : e.ctrlKey;
            if (!mod) return;

            const key = e.key.toLowerCase();

            if (key === "z" && !e.shiftKey) {
                e.preventDefault();
                commands.undo(cmdCtx);
                applyModeFromSelectionIfNeeded();
                syncSelectionOverlays();
                syncUI();
                return;
            }

            if ((key === "z" && e.shiftKey) || key === "y") {
                e.preventDefault();
                commands.redo(cmdCtx);
                applyModeFromSelectionIfNeeded();
                syncSelectionOverlays();
                syncUI();
            }
        });

        // UI radio buttons -> selection mode change
        ui.onModeChange((m) => {
            mode = m;
            setSelectionMode(selection, m);

            renderer.setDisplayMode(m);
            renderer.forceCameraUpdate();
            // updatePointerPositionFromCanvasCenter();


            // Core clears selection on mode change; reflect it.
            syncSelectionOverlays();
            syncUI();
        });

        // Pointer picking + gizmo capture lives in ui/binding.ts now
        bindUI({
            shell: ui,
            renderer,
            mesh,
            getMode: () => mode,

               onPick: (hit: PickHit | null, additive: boolean) => {
                   // Don't allow selection changes while actively grabbing
                   if (grab?.isActive()) return;

                   const before = snapshotSelection(selection);

                   // Compute "after" on a temp selection to keep mutations inside Commands
                   const temp = makeSelection();
                   setSelectionMode(temp, mode); // clears temp (fine)
        applySelectionSnapshot(temp, before);

        // Empty click behavior:
        // - if not additive, clear selection
        // - if additive (shift), keep selection intact
        if (!hit) {
            if (!additive) {
                clearSelection(temp);
            } else {
                return; // no change
            }
        } else {
            if (mode === "face") {
                if (additive) toggleFace(temp, hit.id);
                else replaceFaces(temp, [hit.id]);
            } else if (mode === "edge") {
                if (additive) toggleEdge(temp, hit.id);
                else replaceEdges(temp, [hit.id]);
            } else {
                if (additive) toggleVertex(temp, hit.id);
                else replaceVertices(temp, [hit.id]);
            }
        }

        const after = snapshotSelection(temp);
        if (selectionSnapshotEquals(before, after)) return;

        commands.execute(cmdCtx, new SetSelectionCommand(before, after));

                   // If selection changed categories via undo/redo history, we keep mode stable here.
                   // Mode swapping is handled on undo/redo only (per requirement).
                   syncSelectionOverlays();
                   syncUI();
               },

               onGizmoCaptureChange: (captured) => {
                   // Optional hook: could show “dragging…” UI, disable hover, etc.
                   // For now, no-op.
                   void captured;
               },
        });

        renderer.start();
}

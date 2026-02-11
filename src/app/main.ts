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
import { TOL } from "../core/tolerances";
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
} from "../core/selection/selection";
import type { Id } from "../core/ids/ids";
import type { PickHit } from "../renderer/picking";
import { CommandManager } from "../core/commands/commandManager";
import { SetSelectionCommand, type SelectionContext } from "../core/commands/selection/setSelectionCommand";
import {
    snapshotSelection,
    applySelectionSnapshot,
    selectionSnapshotEquals,
} from "../core/selection/selection";


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

function formatSelectionText( sel: ReturnType<typeof makeSelection>, mesh: Mesh ): string {
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

    // Core mesh (polygons); renderer triangulates for display/picking
    const mesh = makeUnitCubeMesh();
    renderer.setMesh(mesh);

    // Selection state lives in core
    const selection = makeSelection();
    let mode: SelectionMode = selection.mode;

    // NEW:
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

    syncSelectionOverlays();

    const isMac = () => navigator.platform.toLowerCase().includes("mac");

    window.addEventListener("keydown", (e) => {
        const mod = isMac() ? e.metaKey : e.ctrlKey;
        if (!mod) return;

        const key = e.key.toLowerCase();

        if (key === "z" && !e.shiftKey) {
            e.preventDefault();
            commands.undo(cmdCtx);
            syncSelectionOverlays();
            syncUI();
            return;
        }

        if ((key === "z" && e.shiftKey) || key === "y") {
            e.preventDefault();
            commands.redo(cmdCtx);
            syncSelectionOverlays();
            syncUI();
        }
    });


    // UI radio buttons -> selection mode change
    ui.onModeChange((m) => {
        mode = m;
        setSelectionMode(selection, m);

        renderer.setDisplayMode(m);

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

           onPick: (hit: PickHit, additive: boolean) => {
               const before = snapshotSelection(selection);

               // Build "after" by applying logic to a temp selection,
               // then committing via a command. This avoids mutating state
               // outside the command system.
               const temp = makeSelection();
               setSelectionMode(temp, mode);
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

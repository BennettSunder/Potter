// src/ui/bindings.ts
//
// UI Binding = “glue code” between:
// - AppShell (DOM controls / radio buttons / status text)
// - ThreeRenderer (picking, overlays, gizmos)
// - (Later) App/Commands/Selection model
//
// IMPORTANT ARCHITECTURE RULE:
// - This file should NOT directly mutate the core mesh.
// - This file can call renderer picking/gizmo APIs and then emit events/callbacks.
// - Your app-layer (main.ts or a controller) decides what to do with those events
//   (update SelectionModel, run Commands, undo/redo, etc.)
//
// Why this exists:
// - Keeps main.ts tiny
// - Keeps renderer “graphics only”
// - Centralizes mouse→NDC conversion and pointer event handling
//
// NOTE (what we’re improving now):
// - We do NOT want to show “vertex v_123” anymore.
// - We want the status line to show vertex POSITIONS when in vertex mode.
//   This file can *display* mesh-derived information, but should not *edit* mesh data.

import type { PickHit } from "../renderer/picking";
import type { DisplayMode } from "../renderer/overlays";
import type { ThreeRenderer } from "../renderer/threeRenderer";

import type { Mesh, Vec3 } from "../core/mesh";
import type { Id } from "../core/ids/ids";

export type SelectionMode = DisplayMode;

// The minimal interface we need from your app shell.
export type AppShellAPI = {
    canvas: HTMLCanvasElement;

    // Update the little status readout in the UI
    setSelectionText: (t: string) => void;

    // AppShell emits selection mode changes when user clicks radio buttons.
    onModeChange: (cb: (mode: SelectionMode) => void) => void;
};

export type BindUIOptions = {
    shell: AppShellAPI;
    renderer: ThreeRenderer;

    /**
     * The current mesh, used ONLY for *reading* vertex positions for UI display.
     * (No mutation allowed here.)
     */
    mesh: Mesh;

    /**
     * Ask the app “what selection mode are we in right now?”
     */
    getMode: () => SelectionMode;

    /**
     * When the user clicks (and the gizmo did NOT capture the pointer),
     * we convert mouse coords -> NDC, run picking, and report the result.
     *
     * additive = true when shift is held (multi-select behavior).
     * hit can be null for empty clicks.
     */
    onPick: (hit: PickHit | null, additive: boolean) => void;

    /**
     * Optional: provide currently selected vertex IDs so we can display their positions.
     * If omitted, we fall back to showing the picked vertex position only.
     */
    getSelectedVertexIds?: () => Iterable<Id>;

    /**
     * Optional: when gizmo drag starts/ends, you might want to switch UI state,
     * suspend hover highlight, etc.
     */
    onGizmoCaptureChange?: (captured: boolean) => void;

    /**
     * Pointer position provider (for tools like GrabController).
     * This returns the *last known* clientX/clientY (screen coords).
     */
    onPointerClientPosProvider?: (getPos: () => { x: number; y: number }) => void;

    /**
     * Optional: raw pointer move passthrough (useful for tools like GrabController).
     * Note: this fires on every pointermove over the canvas (not only while dragging gizmo).
     */
    onCanvasPointerMove?: (ev: PointerEvent) => void;

    /**
     * Optional: raw pointer down passthrough (useful for tools like GrabController to
     * seed mouse position even if the mouse hasn't moved yet).
     */
    onCanvasPointerDown?: (ev: PointerEvent) => void;
};

function fmtNum(n: number): string {
    const v = Math.abs(n) < 1e-9 ? 0 : n; // avoid "-0"
    return String(v);
}

function fmtVec3(p: Vec3): string {
    return `(${fmtNum(p.x)}, ${fmtNum(p.y)}, ${fmtNum(p.z)})`;
}

/**
 * Installs all DOM bindings for:
 * - pointer picking (face/edge/vertex depending on mode)
 * - gizmo dragging (capture pointer + call renderer gizmo API)
 * - mode changes (update renderer display mode)
 *
 * Returns dispose() so you can remove listeners (useful for hot reload / tests).
 */
export function bindUI(opts: BindUIOptions): { dispose: () => void } {
    const {
        shell,
        renderer,
        mesh,
        getMode,
        onPick,
        getSelectedVertexIds,
        onGizmoCaptureChange,
        onPointerClientPosProvider,
        onCanvasPointerMove,
        onCanvasPointerDown,
    } = opts;

    const canvas = shell.canvas;

    // -------------------------
    // Pointer tracking (single source of truth)
    // -------------------------

    let lastClientX = 0;
    let lastClientY = 0;
    let hasPointer = false;

    const updatePointer = (ev: PointerEvent) => {
        lastClientX = ev.clientX;
        lastClientY = ev.clientY;
        hasPointer = true;
    };

    const getPointerClientPos = () => {
        if (hasPointer) return { x: lastClientX, y: lastClientY };

        // Fallback: canvas center (before any pointer activity)
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    };

    // Hand pointer provider back to app (so GrabController can use it).
    onPointerClientPosProvider?.(getPointerClientPos);

    // Track pointer on *window* so we don't miss updates when UI overlays / controls
    // capture events or when the pointer leaves the canvas.
    window.addEventListener("pointermove", updatePointer, { passive: true });
    window.addEventListener("pointerdown", updatePointer, { passive: true });
    window.addEventListener("pointerenter", updatePointer, { passive: true });

    // -------------------------
    // Helpers: coords conversion
    // -------------------------

    /**
     * Convert a PointerEvent to NDC (Normalized Device Coordinates):
     * -1..+1 in X and Y, suitable for Three.js raycasting and our picking.
     */
    const eventToNdc = (ev: PointerEvent): { ndcX: number; ndcY: number } => {
        const rect = renderer.getCanvasRectCssPx();

        // CSS pixel coordinates inside the canvas rect
        const x = (ev.clientX - rect.left) / rect.width;
        const y = (ev.clientY - rect.top) / rect.height;

        // Convert to NDC
        const ndcX = x * 2 - 1;
        const ndcY = -(y * 2 - 1);

        return { ndcX, ndcY };
    };

    /**
     * Unified picking call.
     * Renderer decides how to pick based on mode.
     */
    const runPick = (ndcX: number, ndcY: number): PickHit | null => {
        const mode = getMode();
        return renderer.pick(ndcX, ndcY, mode);
    };

    // -------------------------
    // Mode change -> renderer UI
    // -------------------------

    shell.onModeChange((mode) => {
        renderer.setDisplayMode(mode);
    });

    // -------------------------
    // UI status text helpers
    // -------------------------

    const updateStatusText = (hit: PickHit | null) => {
        const mode = getMode();

        if (mode !== "vertex") {
            // Compact for face/edge modes
            if (!hit) shell.setSelectionText("(none)");
            else shell.setSelectionText(`${hit.type} ${String(hit.id)}`);
            return;
        }

        // Vertex mode: show positions.
        const ids = getSelectedVertexIds ? Array.from(getSelectedVertexIds()) : null;

        if (ids && ids.length > 0) {
            const parts: string[] = [];
            for (const vId of ids) {
                try {
                    const v = mesh.getVertexById(vId);
                    parts.push(fmtVec3(v.position));
                } catch {
                    // ignore invalid ids (shouldn't happen)
                }
            }

            const list = parts.length ? parts.join(", ") : "(none)";
            shell.setSelectionText(`mode: vertex (${ids.length}): ${list}`);
            return;
        }

        // Fallback: picked vertex position (if any)
        if (hit && hit.type === "vertex") {
            try {
                const v = mesh.getVertexById(hit.id);
                shell.setSelectionText(`mode: vertex (picked): ${fmtVec3(v.position)}`);
            } catch {
                shell.setSelectionText("mode: vertex (picked): (unknown vertex)");
            }
            return;
        }

        shell.setSelectionText("mode: vertex (none)");
    };

    // -------------------------
    // Pointer handling (pick/gizmo)
    // -------------------------

    let dragging = false;
    let gizmoCaptured = false;

    const onPointerDown = (ev: PointerEvent) => {
        // Keep pointer state fresh even if mouse hasn't moved yet.
        updatePointer(ev);
        onCanvasPointerDown?.(ev);

        // Only left button for selection/drag tools
        if (ev.button !== 0) return;

        ev.preventDefault();

        const { ndcX, ndcY } = eventToNdc(ev);

        // First chance: gizmo tries to capture the drag.
        gizmoCaptured = renderer.gizmoPointerDown(ndcX, ndcY);
        if (gizmoCaptured) {
            dragging = true;
            canvas.setPointerCapture(ev.pointerId);
            onGizmoCaptureChange?.(true);
            return;
        }

        // Otherwise: do normal picking (can be null)
        const hit = runPick(ndcX, ndcY);
        const additive = ev.shiftKey;

        onPick(hit, additive);

        // UI feedback
        updateStatusText(hit);
    };

    const onPointerMove = (ev: PointerEvent) => {
        // Always keep pointer state fresh.
        updatePointer(ev);
        onCanvasPointerMove?.(ev);

        // Gizmo drag path (existing behavior)
        if (!dragging) return;
        if (!gizmoCaptured) return;

        ev.preventDefault();
        const { ndcX, ndcY } = eventToNdc(ev);
        renderer.gizmoPointerMove(ndcX, ndcY);
    };

    const endDrag = (ev: PointerEvent) => {
        if (!dragging) return;

        ev.preventDefault();

        if (gizmoCaptured) {
            renderer.gizmoPointerUp();
            gizmoCaptured = false;
            onGizmoCaptureChange?.(false);
        }

        dragging = false;

        try {
            canvas.releasePointerCapture(ev.pointerId);
        } catch {
            // can throw if capture wasn't set; ignore
        }
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);
    canvas.addEventListener("pointerleave", endDrag);

    const dispose = () => {
        canvas.removeEventListener("pointerdown", onPointerDown);
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", endDrag);
        canvas.removeEventListener("pointercancel", endDrag);
        canvas.removeEventListener("pointerleave", endDrag);

        window.removeEventListener("pointermove", updatePointer);
        window.removeEventListener("pointerdown", updatePointer);
        window.removeEventListener("pointerenter", updatePointer);
    };

    return { dispose };
}

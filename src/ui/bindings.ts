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
    onBoxPick?: (
        ids: ReadonlyArray<Id>,
        mode: SelectionMode,
        additive: boolean,
    ) => void;

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
    shouldSuppressPointerDown?: () => boolean;
    onBeforePickPointerDown?: (ndcX: number, ndcY: number) => boolean;
    shouldRoutePointerToCamera?: (ev: PointerEvent) => boolean;
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
        onBoxPick,
        getSelectedVertexIds,
        onGizmoCaptureChange,
        onPointerClientPosProvider,
        onCanvasPointerMove,
        onCanvasPointerDown,
        shouldSuppressPointerDown,
        onBeforePickPointerDown,
        shouldRoutePointerToCamera,
    } = opts;

    const canvas = shell.canvas;
    const DRAG_SELECT_THRESHOLD_PX = 6;

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
    let selectionBoxActive = false;
    let selectionBoxMoved = false;
    let selectionBoxPointerId: number | null = null;
    let selectionStart = { x: 0, y: 0 };
    let selectionCurrent = { x: 0, y: 0 };

    const marquee = document.createElement("div");
    marquee.style.position = "fixed";
    marquee.style.display = "none";
    marquee.style.pointerEvents = "none";
    marquee.style.zIndex = "20";
    marquee.style.border = "1px solid #9aa0ff";
    marquee.style.background = "rgba(154, 160, 255, 0.18)";
    marquee.style.boxSizing = "border-box";
    document.body.appendChild(marquee);

    const hideMarquee = () => {
        marquee.style.display = "none";
    };

    const updateMarquee = () => {
        const left = Math.min(selectionStart.x, selectionCurrent.x);
        const top = Math.min(selectionStart.y, selectionCurrent.y);
        const width = Math.abs(selectionCurrent.x - selectionStart.x);
        const height = Math.abs(selectionCurrent.y - selectionStart.y);

        marquee.style.display = "block";
        marquee.style.left = `${left}px`;
        marquee.style.top = `${top}px`;
        marquee.style.width = `${width}px`;
        marquee.style.height = `${height}px`;
    };

    const onPointerDown = (ev: PointerEvent) => {
        // Keep pointer state fresh even if mouse hasn't moved yet.
        updatePointer(ev);
        onCanvasPointerDown?.(ev);

        // Only left button for selection/drag tools
        if (ev.button !== 0) return;

        if (shouldRoutePointerToCamera?.(ev)) {
            return;
        }

        if (shouldSuppressPointerDown?.()) {
            ev.stopPropagation();
            ev.preventDefault();
            return;
        }

        ev.stopPropagation();
        ev.preventDefault();

        const { ndcX, ndcY } = eventToNdc(ev);

        if (onBeforePickPointerDown?.(ndcX, ndcY)) {
            dragging = false;
            return;
        }

        // First chance: gizmo tries to capture the drag.
        const gizmoInteraction = renderer.gizmoPointerDown(ndcX, ndcY);
        gizmoCaptured = gizmoInteraction === "drag";
        if (gizmoInteraction === "modal") {
            dragging = false;
            return;
        }
        if (gizmoCaptured) {
            dragging = true;
            canvas.setPointerCapture(ev.pointerId);
            onGizmoCaptureChange?.(true);
            return;
        }

        dragging = true;
        selectionBoxActive = true;
        selectionBoxMoved = false;
        selectionBoxPointerId = ev.pointerId;
        selectionStart = { x: ev.clientX, y: ev.clientY };
        selectionCurrent = { x: ev.clientX, y: ev.clientY };
        canvas.setPointerCapture(ev.pointerId);
    };

    const onPointerMove = (ev: PointerEvent) => {
        // Always keep pointer state fresh.
        updatePointer(ev);
        onCanvasPointerMove?.(ev);

        const { ndcX, ndcY } = eventToNdc(ev);

        // Gizmo drag path (existing behavior)
        if (!dragging) {
            renderer.gizmoPointerHover(ndcX, ndcY);
            return;
        }
        if (gizmoCaptured) {
            ev.preventDefault();
            renderer.gizmoPointerMove(ndcX, ndcY);
            return;
        }

        if (!selectionBoxActive || selectionBoxPointerId !== ev.pointerId) return;

        const dx = ev.clientX - selectionStart.x;
        const dy = ev.clientY - selectionStart.y;
        if (!selectionBoxMoved && Math.hypot(dx, dy) < DRAG_SELECT_THRESHOLD_PX) return;

        selectionBoxMoved = true;
        selectionCurrent = { x: ev.clientX, y: ev.clientY };
        updateMarquee();
    };

    const endDrag = (ev: PointerEvent) => {
        if (!dragging) return;

        ev.preventDefault();

        if (gizmoCaptured) {
            renderer.gizmoPointerUp();
            gizmoCaptured = false;
            onGizmoCaptureChange?.(false);
        }

        if (selectionBoxActive && selectionBoxPointerId === ev.pointerId) {
            const additive = ev.shiftKey;

            if (selectionBoxMoved) {
                const ids = renderer.boxSelect(selectionStart, selectionCurrent, getMode());
                onBoxPick?.(ids, getMode(), additive);
                updateStatusText(null);
            } else {
                const { ndcX, ndcY } = eventToNdc(ev);
                const hit = runPick(ndcX, ndcY);
                onPick(hit, additive);
                updateStatusText(hit);
            }
        }

        dragging = false;
        selectionBoxActive = false;
        selectionBoxMoved = false;
        selectionBoxPointerId = null;
        hideMarquee();

        try {
            canvas.releasePointerCapture(ev.pointerId);
        } catch {
            // can throw if capture wasn't set; ignore
        }
    };

    canvas.addEventListener("pointerdown", onPointerDown, { capture: true });
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", endDrag);

    const dispose = () => {
        canvas.removeEventListener("pointerdown", onPointerDown, { capture: true });
        canvas.removeEventListener("pointermove", onPointerMove);
        canvas.removeEventListener("pointerup", endDrag);
        canvas.removeEventListener("pointercancel", endDrag);

        window.removeEventListener("pointermove", updatePointer);
        window.removeEventListener("pointerdown", updatePointer);
        marquee.remove();
    };

    return { dispose };
}

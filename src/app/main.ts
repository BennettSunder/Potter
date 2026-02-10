// src/app/main.ts
import { mountAppShell } from "../ui/appShell";
import { ThreeRenderer } from "../renderer/threeRenderer";
import { makeUnitCubeMesh } from "../core/mesh";
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
} from "../core/selection";

function formatSelectionText(sel: ReturnType<typeof makeSelection>): string {
    if (sel.mode === "face") {
        const n = sel.faceIds.size;
        return n ? `mode: face (${n})` : "mode: face (none)";
    }
    if (sel.mode === "edge") {
        const n = sel.edgeIds.size;
        return n ? `mode: edge (${n})` : "mode: edge (none)";
    }
    const n = sel.vertexIds.size;
    return n ? `mode: vertex (${n})` : "mode: vertex (none)";
}

function ndcFromPointerEvent(e: PointerEvent, rect: DOMRect): { x: number; y: number } {
    const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    return { x, y };
}

export function startApp(): void {
    const root = document.querySelector<HTMLDivElement>("#app");
    if (!root) throw new Error("Missing #app");

    const ui = mountAppShell(root);
    const renderer = new ThreeRenderer(ui.canvas);

    const mesh = makeUnitCubeMesh();
    renderer.setMesh(mesh);

    const selection = makeSelection();
    let mode: SelectionMode = selection.mode;

    renderer.setDisplayMode(mode);
    ui.setSelectionText(formatSelectionText(selection));

    const syncUI = () => ui.setSelectionText(formatSelectionText(selection));

    const syncSelectionOverlays = () => {
        renderer.setSelectedFaces(selection.faceIds);
        renderer.setSelectedEdges(selection.edgeIds);
        renderer.setSelectedVertices(selection.vertexIds);
    };

    syncSelectionOverlays();

    ui.onModeChange((m) => {
        mode = m;
        setSelectionMode(selection, m);

        renderer.setDisplayMode(m);

        // Core clears selection on mode change; reflect it.
        syncSelectionOverlays();
        syncUI();
    });

    ui.canvas.addEventListener("pointerup", (e) => {
        if (e.button !== 0) return; // left click selects

        const rect = renderer.getCanvasRectCssPx();
        const { x: ndcX, y: ndcY } = ndcFromPointerEvent(e, rect);

        // FACE MODE
        if (mode === "face") {
            const hit = renderer.pick(ndcX, ndcY);

            if (!hit) {
                // Keep selection intact on Shift+empty click
                if (!e.shiftKey) {
                    clearSelection(selection);
                    syncSelectionOverlays();
                    syncUI();
                }
                return;
            }

            if (e.shiftKey) toggleFace(selection, hit.id);
            else replaceFaces(selection, [hit.id]);

            syncSelectionOverlays();
            syncUI();
            return;
        }

        // EDGE MODE
        if (mode === "edge") {
            const { dpr } = renderer.getViewportSizePx();
            const radius = (TOL as any).edgePickRadiusPx ?? TOL.vertexPickRadiusPx;
            const ehit = renderer.pickLine(ndcX, ndcY, radius * dpr);

            if (!ehit) {
                if (!e.shiftKey) {
                    clearSelection(selection);
                    syncSelectionOverlays();
                    syncUI();
                }
                return;
            }

            if (e.shiftKey) toggleEdge(selection, ehit.id);
            else replaceEdges(selection, [ehit.id]);

            syncSelectionOverlays();
            syncUI();
            return;
        }

        // VERTEX MODE
        {
            const { dpr } = renderer.getViewportSizePx();
            const vhit = renderer.pickVertex(ndcX, ndcY, TOL.vertexPickRadiusPx * dpr);

            if (!vhit) {
                if (!e.shiftKey) {
                    clearSelection(selection);
                    syncSelectionOverlays();
                    syncUI();
                }
                return;
            }

            if (e.shiftKey) toggleVertex(selection, vhit.id);
            else replaceVertices(selection, [vhit.id]);

            syncSelectionOverlays();
            syncUI();
        }
    });

    renderer.start();
}

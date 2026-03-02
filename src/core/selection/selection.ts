import type { Id } from "../ids/ids";

export type SelectionMode = "face" | "edge" | "vertex";

export type Selection = {
    mode: SelectionMode;
    faceIds: Set<Id>;
    edgeIds: Set<Id>;
    vertexIds: Set<Id>;
};

export type SelectionSnapshot = {
    faceIds: Id[];
    edgeIds: Id[];
    vertexIds: Id[];
};

export function makeSelection(): Selection {
    return {
        mode: "face",
        faceIds: new Set<Id>(),
        edgeIds: new Set<Id>(),
        vertexIds: new Set<Id>(),
    };
}

export function setSelectionMode(sel: Selection, mode: SelectionMode): void {
    sel.mode = mode;
    clearSelection(sel);
}

export function clearSelection(sel: Selection): void {
    sel.faceIds.clear();
    sel.edgeIds.clear();
    sel.vertexIds.clear();
}

// ------------------------
// Undo/redo snapshot helpers
// ------------------------

export function snapshotSelection(sel: Selection): SelectionSnapshot {
    return {
        faceIds: Array.from(sel.faceIds),
        edgeIds: Array.from(sel.edgeIds),
        vertexIds: Array.from(sel.vertexIds),
    };
}

export function applySelectionSnapshot(sel: Selection, snap: SelectionSnapshot): void {
    // IMPORTANT: We intentionally do NOT touch sel.mode here.
    // Mode switching is owned by the UI flow for now.
    sel.faceIds.clear();
    sel.edgeIds.clear();
    sel.vertexIds.clear();

    for (const id of snap.faceIds) sel.faceIds.add(id);
    for (const id of snap.edgeIds) sel.edgeIds.add(id);
    for (const id of snap.vertexIds) sel.vertexIds.add(id);
}

export function selectionSnapshotEquals(a: SelectionSnapshot, b: SelectionSnapshot): boolean {
    if (a.faceIds.length !== b.faceIds.length) return false;
    if (a.edgeIds.length !== b.edgeIds.length) return false;
    if (a.vertexIds.length !== b.vertexIds.length) return false;

    const af = new Set(a.faceIds);
    for (const id of b.faceIds) if (!af.has(id)) return false;

    const ae = new Set(a.edgeIds);
    for (const id of b.edgeIds) if (!ae.has(id)) return false;

    const av = new Set(a.vertexIds);
    for (const id of b.vertexIds) if (!av.has(id)) return false;

    return true;
}

// ------------------------
// Selection operations
// ------------------------

// Replace selection (no shift)
export function replaceFaces(sel: Selection, ids: Iterable<Id>): void {
    sel.faceIds.clear();
    for (const id of ids) sel.faceIds.add(id);
    sel.edgeIds.clear();
    sel.vertexIds.clear();
}

export function replaceEdges(sel: Selection, ids: Iterable<Id>): void {
    sel.edgeIds.clear();
    for (const id of ids) sel.edgeIds.add(id);
    sel.faceIds.clear();
    sel.vertexIds.clear();
}

export function replaceVertices(sel: Selection, ids: Iterable<Id>): void {
    sel.vertexIds.clear();
    for (const id of ids) sel.vertexIds.add(id);
    sel.faceIds.clear();
    sel.edgeIds.clear();
}

// Toggle selection (shift)
export function toggleFace(sel: Selection, id: Id): void {
    if (sel.faceIds.has(id)) sel.faceIds.delete(id);
    else sel.faceIds.add(id);
    sel.edgeIds.clear();
    sel.vertexIds.clear();
}

export function toggleEdge(sel: Selection, id: Id): void {
    if (sel.edgeIds.has(id)) sel.edgeIds.delete(id);
    else sel.edgeIds.add(id);
    sel.faceIds.clear();
    sel.vertexIds.clear();
}

export function toggleVertex(sel: Selection, id: Id): void {
    if (sel.vertexIds.has(id)) sel.vertexIds.delete(id);
    else sel.vertexIds.add(id);
    sel.faceIds.clear();
    sel.edgeIds.clear();
}

export function inferSelectionModeFromSelection(sel: Selection): SelectionMode | null {
    if (sel.faceIds.size > 0) return "face";
    if (sel.edgeIds.size > 0) return "edge";
    if (sel.vertexIds.size > 0) return "vertex";
    return null;
}

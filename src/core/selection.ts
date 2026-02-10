import type { Id } from "./ids";

export type SelectionMode = "face" | "edge" | "vertex";

export type Selection = {
    mode: SelectionMode;
    faceIds: Set<Id>;
    edgeIds: Set<Id>;
    vertexIds: Set<Id>;
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

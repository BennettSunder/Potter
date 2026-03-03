import type { Command } from "../command";
import type { Mesh, MeshSnapshot } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { Selection, SelectionSnapshot } from "../../selection/selection";
import { applySelectionSnapshot, snapshotSelection } from "../../selection/selection";

type DeleteSelectionContext = {
    selection: Selection;
};

function edgeKey(a: Id, b: Id): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function buildDeletedSnapshot(
    before: MeshSnapshot,
    selection: Selection,
    selectedEdgePairs: ReadonlySet<string>,
): MeshSnapshot {
    const facesToDelete = new Set<Id>();

    if (selection.mode === "face") {
        for (const faceId of selection.faceIds) facesToDelete.add(faceId);
    } else if (selection.mode === "edge") {
        for (const face of before.faces) {
            const n = face.verts.length;
            for (let i = 0; i < n; i++) {
                const a = face.verts[i]!;
                const b = face.verts[(i + 1) % n]!;
                if (selectedEdgePairs.has(edgeKey(a, b))) {
                    facesToDelete.add(face.id);
                    break;
                }
            }
        }
    } else {
        const selectedVertices = new Set(selection.vertexIds);
        for (const face of before.faces) {
            if (face.verts.some((id) => selectedVertices.has(id))) {
                facesToDelete.add(face.id);
            }
        }
    }

    const keptFaces = before.faces
        .filter((face) => !facesToDelete.has(face.id))
        .map((face) => ({ id: face.id, verts: [...face.verts], shading: face.shading }));

    const usedVertexIds = new Set<Id>();
    for (const face of keptFaces) {
        for (const vertexId of face.verts) usedVertexIds.add(vertexId);
    }

    const keptVertices = before.vertices
        .filter((vertex) => usedVertexIds.has(vertex.id))
        .map((vertex) => ({
            id: vertex.id,
            position: { ...vertex.position },
        }));

    return {
        vertices: keptVertices,
        faces: keptFaces,
    };
}

export class DeleteSelectionCommand implements Command<DeleteSelectionContext> {
    readonly name = "Delete Selection";

    private readonly mesh: Mesh;
    private readonly beforeMesh: MeshSnapshot;
    private readonly afterMesh: MeshSnapshot;
    private readonly beforeSelection: SelectionSnapshot;
    private readonly afterSelection: SelectionSnapshot;

    constructor(mesh: Mesh, selection: Selection) {
        this.mesh = mesh;
        this.beforeMesh = mesh.snapshot();
        const selectedEdgePairs = new Set<string>();
        if (selection.mode === "edge") {
            for (const edgeId of selection.edgeIds) {
                const edge = mesh.getEdgeById(edgeId);
                selectedEdgePairs.add(edgeKey(edge.a, edge.b));
            }
        }
        this.afterMesh = buildDeletedSnapshot(this.beforeMesh, selection, selectedEdgePairs);
        this.beforeSelection = snapshotSelection(selection);
        this.afterSelection = { faceIds: [], edgeIds: [], vertexIds: [] };
    }

    do(ctx: DeleteSelectionContext): void {
        this.mesh.restore(this.afterMesh);
        applySelectionSnapshot(ctx.selection, this.afterSelection);
    }

    undo(ctx: DeleteSelectionContext): void {
        this.mesh.restore(this.beforeMesh);
        applySelectionSnapshot(ctx.selection, this.beforeSelection);
    }
}

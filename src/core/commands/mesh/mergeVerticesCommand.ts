import type { Command } from "../command";
import type { Mesh, MeshSnapshot, Vec3 } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { Selection, SelectionSnapshot } from "../../selection/selection";
import { applySelectionSnapshot, snapshotSelection } from "../../selection/selection";

type MergeVerticesContext = {
    selection: Selection;
};

function averagePosition(mesh: Mesh, vertexIds: readonly Id[]): Vec3 {
    let sx = 0;
    let sy = 0;
    let sz = 0;

    for (const vertexId of vertexIds) {
        const p = mesh.getVertexPosition(vertexId);
        sx += p.x;
        sy += p.y;
        sz += p.z;
    }

    const count = vertexIds.length || 1;
    return { x: sx / count, y: sy / count, z: sz / count };
}

function collapseFaceVerts(verts: readonly Id[], replaceId: Id, mergedIds: ReadonlySet<Id>): Id[] {
    const mapped = verts.map((id) => (mergedIds.has(id) ? replaceId : id));
    const collapsed: Id[] = [];

    for (const id of mapped) {
        if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== id) {
            collapsed.push(id);
        }
    }

    while (collapsed.length > 1 && collapsed[0] === collapsed[collapsed.length - 1]) {
        collapsed.pop();
    }

    return collapsed;
}

function buildMergedSnapshot(mesh: Mesh, vertexIds: readonly Id[]): {
    snapshot: MeshSnapshot;
    survivorId: Id;
} {
    const before = mesh.snapshot();
    const survivorId = vertexIds[0]!;
    const mergedIds = new Set(vertexIds);
    const mergedPosition = averagePosition(mesh, vertexIds);

    const vertices = before.vertices
        .filter((vertex) => vertex.id === survivorId || !mergedIds.has(vertex.id))
        .map((vertex) => ({
            id: vertex.id,
            position: vertex.id === survivorId ? { ...mergedPosition } : { ...vertex.position },
        }));

    const faces = before.faces
        .map((face) => ({
            id: face.id,
            verts: collapseFaceVerts(face.verts, survivorId, mergedIds),
            shading: face.shading,
        }))
        .filter((face) => new Set(face.verts).size >= 3);

    return {
        snapshot: {
            vertices,
            faces,
        },
        survivorId,
    };
}

export class MergeVerticesCommand implements Command<MergeVerticesContext> {
    readonly name = "Merge Vertices";

    private readonly mesh: Mesh;
    private readonly beforeMesh: MeshSnapshot;
    private readonly afterMesh: MeshSnapshot;
    private readonly beforeSelection: SelectionSnapshot;
    private readonly afterSelection: SelectionSnapshot;

    constructor(mesh: Mesh, selection: Selection, vertexIds: readonly Id[]) {
        const { snapshot: afterMesh, survivorId } = buildMergedSnapshot(mesh, vertexIds);

        this.mesh = mesh;
        this.beforeMesh = mesh.snapshot();
        this.afterMesh = afterMesh;
        this.beforeSelection = snapshotSelection(selection);
        this.afterSelection = {
            faceIds: [],
            edgeIds: [],
            vertexIds: [survivorId],
        };
    }

    do(ctx: MergeVerticesContext): void {
        this.mesh.restore(this.afterMesh);
        applySelectionSnapshot(ctx.selection, this.afterSelection);
    }

    undo(ctx: MergeVerticesContext): void {
        this.mesh.restore(this.beforeMesh);
        applySelectionSnapshot(ctx.selection, this.beforeSelection);
    }
}

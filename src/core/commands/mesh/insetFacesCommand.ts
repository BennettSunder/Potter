import type { Command } from "../command";
import type { Mesh, MeshSnapshot, Vec3 } from "../../mesh";
import type { Id } from "../../ids/ids";
import { makeId } from "../../ids/ids";
import type { Selection, SelectionSnapshot } from "../../selection/selection";
import { applySelectionSnapshot, snapshotSelection } from "../../selection/selection";

type InsetFacesContext = {
    selection: Selection;
};

function add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function centroid(points: readonly Vec3[]): Vec3 {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const p of points) {
        sx += p.x;
        sy += p.y;
        sz += p.z;
    }
    const n = points.length || 1;
    return { x: sx / n, y: sy / n, z: sz / n };
}

export function buildInsetSnapshot(
    before: MeshSnapshot,
    faceIds: readonly Id[],
    amount: number,
): { snapshot: MeshSnapshot; insetFaceIds: Id[] } {
    const positions = new Map<Id, Vec3>();
    for (const vertex of before.vertices) positions.set(vertex.id, { ...vertex.position });

    const selected = new Set(faceIds);
    const vertices = before.vertices.map((vertex) => ({
        id: vertex.id,
        position: { ...vertex.position },
    }));
    const faces = before.faces
        .filter((face) => !selected.has(face.id))
        .map((face) => ({ id: face.id, verts: [...face.verts], shading: face.shading }));
    const insetFaceIds: Id[] = [];
    const clampedAmount = Math.max(0.001, Math.min(0.95, amount));

    for (const face of before.faces) {
        if (!selected.has(face.id)) continue;
        if (face.verts.length < 3) continue;

        const baseVerts = face.verts;
        const center = centroid(baseVerts.map((id) => positions.get(id)!));
        const insetVerts: Id[] = [];

        for (const vertexId of baseVerts) {
            const base = positions.get(vertexId)!;
            const offset = sub(base, center);
            const insetId = makeId("v");
            const insetPos = add(center, scale(offset, 1 - clampedAmount));
            insetVerts.push(insetId);
            vertices.push({
                id: insetId,
                position: insetPos,
            });
        }

        const insetFaceId = makeId("f");
        faces.push({
            id: insetFaceId,
            verts: insetVerts,
            shading: face.shading,
        });
        insetFaceIds.push(insetFaceId);

        for (let i = 0; i < baseVerts.length; i++) {
            const next = (i + 1) % baseVerts.length;
            faces.push({
                id: makeId("f"),
                verts: [
                    baseVerts[i]!,
                    baseVerts[next]!,
                    insetVerts[next]!,
                    insetVerts[i]!,
                ],
                shading: face.shading,
            });
        }
    }

    return {
        snapshot: {
            vertices,
            faces,
        },
        insetFaceIds,
    };
}

export class InsetFacesCommand implements Command<InsetFacesContext> {
    readonly name = "Inset Faces";

    private readonly mesh: Mesh;
    private readonly beforeMesh: MeshSnapshot;
    private readonly afterMesh: MeshSnapshot;
    private readonly beforeSelection: SelectionSnapshot;
    private readonly afterSelection: SelectionSnapshot;

    constructor(mesh: Mesh, selection: Selection, faceIds: readonly Id[], amount: number) {
        this.mesh = mesh;
        this.beforeMesh = mesh.snapshot();
        const { snapshot, insetFaceIds } = buildInsetSnapshot(this.beforeMesh, faceIds, amount);
        this.afterMesh = snapshot;
        this.beforeSelection = snapshotSelection(selection);
        this.afterSelection = {
            faceIds: insetFaceIds,
            edgeIds: [],
            vertexIds: [],
        };
    }

    do(ctx: InsetFacesContext): void {
        this.mesh.restore(this.afterMesh);
        applySelectionSnapshot(ctx.selection, this.afterSelection);
    }

    undo(ctx: InsetFacesContext): void {
        this.mesh.restore(this.beforeMesh);
        applySelectionSnapshot(ctx.selection, this.beforeSelection);
    }
}

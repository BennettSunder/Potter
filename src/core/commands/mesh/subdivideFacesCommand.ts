import type { Command } from "../command";
import type { Mesh, MeshSnapshot, Vec3 } from "../../mesh";
import type { Id } from "../../ids/ids";
import { makeId } from "../../ids/ids";
import type { Selection, SelectionSnapshot } from "../../selection/selection";
import { applySelectionSnapshot, snapshotSelection } from "../../selection/selection";

type SubdivideFacesContext = {
    selection: Selection;
};

function add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function midpoint(a: Vec3, b: Vec3): Vec3 {
    return scale(add(a, b), 0.5);
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

function edgeKey(a: Id, b: Id): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function expandFaceVertsWithMidpoints(
    verts: readonly Id[],
    midpointIdByEdge: ReadonlyMap<string, Id>,
): Id[] {
    const expanded: Id[] = [];
    const n = verts.length;

    for (let i = 0; i < n; i++) {
        const current = verts[i]!;
        const next = verts[(i + 1) % n]!;
        expanded.push(current);

        const midpointId = midpointIdByEdge.get(edgeKey(current, next));
        if (midpointId) expanded.push(midpointId);
    }

    return expanded;
}

function buildSubdividedSnapshot(
    before: MeshSnapshot,
    selectedFaceIds: ReadonlySet<Id>,
): { snapshot: MeshSnapshot; topFaceIds: Id[] } {
    const positions = new Map<Id, Vec3>();
    for (const vertex of before.vertices) positions.set(vertex.id, { ...vertex.position });

    const vertices = before.vertices.map((vertex) => ({
        id: vertex.id,
        position: { ...vertex.position },
    }));

    const midpointIdByEdge = new Map<string, Id>();
    const nextFaces: MeshSnapshot["faces"] = [];
    const topFaceIds: Id[] = [];

    const ensureMidpoint = (a: Id, b: Id): Id => {
        const key = edgeKey(a, b);
        const existing = midpointIdByEdge.get(key);
        if (existing) return existing;

        const pa = positions.get(a)!;
        const pb = positions.get(b)!;
        const id = makeId("v");
        const pos = midpoint(pa, pb);
        midpointIdByEdge.set(key, id);
        positions.set(id, pos);
        vertices.push({ id, position: { ...pos } });
        return id;
    };

    for (const face of before.faces) {
        if (!selectedFaceIds.has(face.id)) continue;

        const n = face.verts.length;
        if (n < 3) continue;

        for (let i = 0; i < n; i++) {
            ensureMidpoint(face.verts[i]!, face.verts[(i + 1) % n]!);
        }
    }

    for (const face of before.faces) {
        if (!selectedFaceIds.has(face.id)) {
            nextFaces.push({
                id: face.id,
                verts: expandFaceVertsWithMidpoints(face.verts, midpointIdByEdge),
                shading: face.shading,
            });
            continue;
        }

        const faceVerts = [...face.verts];
        const n = faceVerts.length;
        if (n < 3) continue;

        const mids = faceVerts.map((vId, i) => ensureMidpoint(vId, faceVerts[(i + 1) % n]!));

        if (n === 3) {
            const [a, b, c] = faceVerts;
            const [ab, bc, ca] = mids;
            const newFaces = [
                [a, ab, ca],
                [ab, b, bc],
                [ca, bc, c],
                [ab, bc, ca],
            ];
            for (const verts of newFaces) {
                const id = makeId("f");
                nextFaces.push({ id, verts, shading: face.shading });
                topFaceIds.push(id);
            }
            continue;
        }

        const centerPos = centroid(faceVerts.map((id) => positions.get(id)!));
        const centerId = makeId("v");
        positions.set(centerId, centerPos);
        vertices.push({ id: centerId, position: { ...centerPos } });

        for (let i = 0; i < n; i++) {
            const prevMid = mids[(i - 1 + n) % n]!;
            const nextMid = mids[i]!;
            const current = faceVerts[i]!;
            const id = makeId("f");
            nextFaces.push({
                id,
                verts: [current, nextMid, centerId, prevMid],
                shading: face.shading,
            });
            topFaceIds.push(id);
        }
    }

    return {
        snapshot: {
            vertices,
            faces: nextFaces,
        },
        topFaceIds,
    };
}

export class SubdivideFacesCommand implements Command<SubdivideFacesContext> {
    readonly name = "Subdivide Faces";

    private readonly mesh: Mesh;
    private readonly beforeMesh: MeshSnapshot;
    private readonly afterMesh: MeshSnapshot;
    private readonly beforeSelection: SelectionSnapshot;
    private readonly afterSelection: SelectionSnapshot;

    constructor(mesh: Mesh, selection: Selection, faceIds: readonly Id[]) {
        this.mesh = mesh;
        this.beforeMesh = mesh.snapshot();
        const { snapshot, topFaceIds } = buildSubdividedSnapshot(this.beforeMesh, new Set(faceIds));
        this.afterMesh = snapshot;
        this.beforeSelection = snapshotSelection(selection);
        this.afterSelection = {
            faceIds: topFaceIds,
            edgeIds: [],
            vertexIds: [],
        };
    }

    do(ctx: SubdivideFacesContext): void {
        this.mesh.restore(this.afterMesh);
        applySelectionSnapshot(ctx.selection, this.afterSelection);
    }

    undo(ctx: SubdivideFacesContext): void {
        this.mesh.restore(this.beforeMesh);
        applySelectionSnapshot(ctx.selection, this.beforeSelection);
    }
}

import type { Command } from "../command";
import type { Mesh, MeshSnapshot, Vec3, Face } from "../../mesh";
import type { Id } from "../../ids/ids";
import { makeId } from "../../ids/ids";
import type { Selection, SelectionSnapshot } from "../../selection/selection";
import { applySelectionSnapshot, snapshotSelection } from "../../selection/selection";

type KnifeFacesContext = {
    selection: Selection;
};

function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v: Vec3, s: number): Vec3 {
    return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function dist2(a: Vec3, b: Vec3): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    const dz = a.z - b.z;
    return dx * dx + dy * dy + dz * dz;
}

function closestPointOnSegment(point: Vec3, a: Vec3, b: Vec3): Vec3 {
    const ab = sub(b, a);
    const denom = dot(ab, ab);
    if (denom < 1e-12) return { ...a };
    const t = Math.max(0, Math.min(1, dot(sub(point, a), ab) / denom));
    return add(a, scale(ab, t));
}

function cloneSnapshot(snapshot: MeshSnapshot): MeshSnapshot {
    return {
        vertices: snapshot.vertices.map((vertex) => ({
            id: vertex.id,
            position: { ...vertex.position },
        })),
        faces: snapshot.faces.map((face) => ({
            id: face.id,
            verts: [...face.verts],
            shading: face.shading,
        })),
    };
}

function sliceLoop(verts: readonly Id[], startIndex: number, endIndex: number): Id[] {
    const out: Id[] = [verts[startIndex]!];
    let i = startIndex;
    while (i !== endIndex) {
        i = (i + 1) % verts.length;
        out.push(verts[i]!);
    }
    return out;
}

function getFaceById(snapshot: MeshSnapshot, faceId: Id): Face {
    const face = snapshot.faces.find((candidate) => candidate.id === faceId);
    if (!face) throw new Error(`KnifeFaceCommand: unknown face id ${faceId}`);
    return face;
}

function buildKnifeSnapshot(
    before: MeshSnapshot,
    faceId: Id,
    firstWorldPos: Vec3,
    secondWorldPos: Vec3,
): { snapshot: MeshSnapshot; newFaceIds: Id[] } {
    const face = getFaceById(before, faceId);
    if (face.verts.length < 3) {
        return { snapshot: cloneSnapshot(before), newFaceIds: [faceId] };
    }

    const positions = new Map<Id, Vec3>();
    for (const vertex of before.vertices) positions.set(vertex.id, { ...vertex.position });

    let firstEdgeIndex = -1;
    let secondEdgeIndex = -1;
    let firstCutPos = firstWorldPos;
    let secondCutPos = secondWorldPos;
    let firstBestDist2 = Infinity;
    let secondBestDist2 = Infinity;

    for (let i = 0; i < face.verts.length; i++) {
        const a = positions.get(face.verts[i]!)!;
        const b = positions.get(face.verts[(i + 1) % face.verts.length]!)!;

        const firstCandidate = closestPointOnSegment(firstWorldPos, a, b);
        const firstCandidateDist2 = dist2(firstWorldPos, firstCandidate);
        if (firstCandidateDist2 < firstBestDist2) {
            firstBestDist2 = firstCandidateDist2;
            firstEdgeIndex = i;
            firstCutPos = firstCandidate;
        }

        const secondCandidate = closestPointOnSegment(secondWorldPos, a, b);
        const secondCandidateDist2 = dist2(secondWorldPos, secondCandidate);
        if (secondCandidateDist2 < secondBestDist2) {
            secondBestDist2 = secondCandidateDist2;
            secondEdgeIndex = i;
            secondCutPos = secondCandidate;
        }
    }

    if (firstEdgeIndex < 0 || secondEdgeIndex < 0 || firstEdgeIndex === secondEdgeIndex) {
        return { snapshot: cloneSnapshot(before), newFaceIds: [faceId] };
    }

    const snapshot = cloneSnapshot(before);
    const newFirstVertexId = makeId("v");
    const newSecondVertexId = makeId("v");
    snapshot.vertices.push({ id: newFirstVertexId, position: { ...firstCutPos } });
    snapshot.vertices.push({ id: newSecondVertexId, position: { ...secondCutPos } });

    const expanded: Id[] = [];
    let firstCutIndex = -1;
    let secondCutIndex = -1;

    for (let i = 0; i < face.verts.length; i++) {
        expanded.push(face.verts[i]!);
        if (i === firstEdgeIndex) {
            expanded.push(newFirstVertexId);
            firstCutIndex = expanded.length - 1;
        }
        if (i === secondEdgeIndex) {
            expanded.push(newSecondVertexId);
            secondCutIndex = expanded.length - 1;
        }
    }

    if (firstCutIndex < 0 || secondCutIndex < 0) {
        return { snapshot: cloneSnapshot(before), newFaceIds: [faceId] };
    }

    const loopA = sliceLoop(expanded, firstCutIndex, secondCutIndex);
    const loopB = sliceLoop(expanded, secondCutIndex, firstCutIndex);

    if (loopA.length < 3 || loopB.length < 3) {
        return { snapshot: cloneSnapshot(before), newFaceIds: [faceId] };
    }

    snapshot.faces = snapshot.faces.flatMap((candidate) => {
        if (candidate.id !== faceId) return [{ id: candidate.id, verts: [...candidate.verts], shading: candidate.shading }];
        const firstFaceId = faceId;
        const secondFaceId = makeId("f");
        return [
            { id: firstFaceId, verts: loopA, shading: candidate.shading },
            { id: secondFaceId, verts: loopB, shading: candidate.shading },
        ];
    });

    return {
        snapshot,
        newFaceIds: snapshot.faces
            .filter((candidate) => candidate.verts.includes(newFirstVertexId) && candidate.verts.includes(newSecondVertexId))
            .map((candidate) => candidate.id)
            .filter((id, index, ids) => ids.indexOf(id) === index),
    };
}

export class KnifeFaceCommand implements Command<KnifeFacesContext> {
    readonly name = "Knife Face";

    private readonly mesh: Mesh;
    private readonly beforeMesh: MeshSnapshot;
    private readonly afterMesh: MeshSnapshot;
    private readonly beforeSelection: SelectionSnapshot;
    private readonly afterSelection: SelectionSnapshot;

    constructor(mesh: Mesh, selection: Selection, faceId: Id, firstWorldPos: Vec3, secondWorldPos: Vec3) {
        this.mesh = mesh;
        this.beforeMesh = mesh.snapshot();
        const { snapshot, newFaceIds } = buildKnifeSnapshot(this.beforeMesh, faceId, firstWorldPos, secondWorldPos);
        this.afterMesh = snapshot;
        this.beforeSelection = snapshotSelection(selection);
        this.afterSelection = {
            faceIds: newFaceIds,
            edgeIds: [],
            vertexIds: [],
        };
    }

    do(ctx: KnifeFacesContext): void {
        this.mesh.restore(this.afterMesh);
        applySelectionSnapshot(ctx.selection, this.afterSelection);
    }

    undo(ctx: KnifeFacesContext): void {
        this.mesh.restore(this.beforeMesh);
        applySelectionSnapshot(ctx.selection, this.beforeSelection);
    }
}

import type { Command } from "../command";
import type { Mesh, Vec3 } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { SelectionContext } from "../selectionCommands/setSelectionCommand";

type PosMap = Map<Id, Vec3>;

function cloneVec3(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

function average(points: readonly Vec3[]): Vec3 {
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

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
    return {
        x: a.x + (b.x - a.x) * t,
        y: a.y + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
    };
}

function buildNeighbors(mesh: Mesh): Map<Id, Set<Id>> {
    const neighbors = new Map<Id, Set<Id>>();

    const ensure = (id: Id): Set<Id> => {
        const existing = neighbors.get(id);
        if (existing) return existing;
        const created = new Set<Id>();
        neighbors.set(id, created);
        return created;
    };

    for (const face of mesh.getFaces()) {
        const verts = face.verts;
        const n = verts.length;
        for (let i = 0; i < n; i++) {
            const a = verts[i]!;
            const b = verts[(i + 1) % n]!;
            ensure(a).add(b);
            ensure(b).add(a);
        }
    }

    return neighbors;
}

export class SmoothVerticesCommand implements Command<SelectionContext> {
    readonly name = "Smooth Vertices";

    private readonly mesh: Mesh;
    private readonly vertexIds: readonly Id[];
    private readonly strength: number;
    private before: PosMap | null = null;
    private allBefore: PosMap | null = null;

    constructor(mesh: Mesh, vertexIds: readonly Id[], strength = 0.5) {
        this.mesh = mesh;
        this.vertexIds = vertexIds;
        this.strength = Math.max(0, Math.min(1, strength));
    }

    do(_ctx: SelectionContext): void {
        if (!this.before) {
            const before = new Map<Id, Vec3>();
            for (const id of this.vertexIds) {
                before.set(id, cloneVec3(this.mesh.getVertexPosition(id)));
            }
            this.before = before;
        }
        if (!this.allBefore) {
            const allBefore = new Map<Id, Vec3>();
            for (const vertex of this.mesh.getVertices()) {
                allBefore.set(vertex.id, cloneVec3(vertex.position));
            }
            this.allBefore = allBefore;
        }

        const neighbors = buildNeighbors(this.mesh);
        const next = new Map<Id, Vec3>();

        for (const id of this.vertexIds) {
            const current = this.before.get(id);
            if (!current) continue;

            const adjacent = Array.from(neighbors.get(id) ?? []);
            if (adjacent.length === 0) {
                next.set(id, cloneVec3(current));
                continue;
            }

            const avg = average(adjacent.map((neighborId) => this.allBefore?.get(neighborId) ?? cloneVec3(this.mesh.getVertexPosition(neighborId))));
            next.set(id, lerp(current, avg, this.strength));
        }

        for (const [id, pos] of next.entries()) {
            this.mesh.setVertexPosition(id, cloneVec3(pos));
        }
    }

    undo(_ctx: SelectionContext): void {
        if (!this.before) return;

        for (const [id, pos] of this.before.entries()) {
            this.mesh.setVertexPosition(id, cloneVec3(pos));
        }
    }
}

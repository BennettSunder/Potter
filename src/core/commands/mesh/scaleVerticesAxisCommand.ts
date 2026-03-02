import type { Command } from "../command";
import type { Mesh, Vec3 } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { SelectionContext } from "../selectionCommands/setSelectionCommand";

type PosMap = Map<Id, Vec3>;

function cloneVec3(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

function normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len < 1e-8) return { x: 0, y: 0, z: 1 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function scaleAlongAxis(pos: Vec3, center: Vec3, axis: Vec3, factor: number): Vec3 {
    const unit = normalize(axis);
    const rel = {
        x: pos.x - center.x,
        y: pos.y - center.y,
        z: pos.z - center.z,
    };
    const dot = rel.x * unit.x + rel.y * unit.y + rel.z * unit.z;
    const parallel = {
        x: unit.x * dot,
        y: unit.y * dot,
        z: unit.z * dot,
    };
    const perp = {
        x: rel.x - parallel.x,
        y: rel.y - parallel.y,
        z: rel.z - parallel.z,
    };

    return {
        x: center.x + perp.x + parallel.x * factor,
        y: center.y + perp.y + parallel.y * factor,
        z: center.z + perp.z + parallel.z * factor,
    };
}

export class ScaleVerticesAxisCommand implements Command<SelectionContext> {
    readonly name = "Scale Vertices Axis";

    private readonly mesh: Mesh;
    private readonly vertexIds: readonly Id[];
    private readonly center: Vec3;
    private readonly axis: Vec3;
    private readonly factor: number;
    private before: PosMap | null = null;

    constructor(mesh: Mesh, vertexIds: readonly Id[], center: Vec3, axis: Vec3, factor: number) {
        this.mesh = mesh;
        this.vertexIds = vertexIds;
        this.center = center;
        this.axis = axis;
        this.factor = factor;
    }

    do(_ctx: SelectionContext): void {
        if (!this.before) {
            const before = new Map<Id, Vec3>();
            for (const id of this.vertexIds) {
                before.set(id, cloneVec3(this.mesh.getVertexPosition(id)));
            }
            this.before = before;
        }

        for (const id of this.vertexIds) {
            const base = this.before.get(id);
            if (!base) continue;
            this.mesh.setVertexPosition(id, scaleAlongAxis(base, this.center, this.axis, this.factor));
        }
    }

    undo(_ctx: SelectionContext): void {
        if (!this.before) return;

        for (const [id, pos] of this.before.entries()) {
            this.mesh.setVertexPosition(id, cloneVec3(pos));
        }
    }
}

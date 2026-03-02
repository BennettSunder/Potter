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

function rotateAroundAxis(pos: Vec3, center: Vec3, axis: Vec3, angle: number): Vec3 {
    const unit = normalize(axis);
    const px = pos.x - center.x;
    const py = pos.y - center.y;
    const pz = pos.z - center.z;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const dot = px * unit.x + py * unit.y + pz * unit.z;
    const crossX = unit.y * pz - unit.z * py;
    const crossY = unit.z * px - unit.x * pz;
    const crossZ = unit.x * py - unit.y * px;

    return {
        x: center.x + px * cos + crossX * sin + unit.x * dot * (1 - cos),
        y: center.y + py * cos + crossY * sin + unit.y * dot * (1 - cos),
        z: center.z + pz * cos + crossZ * sin + unit.z * dot * (1 - cos),
    };
}

export class RotateVerticesCommand implements Command<SelectionContext> {
    readonly name = "Rotate Vertices";

    private readonly mesh: Mesh;
    private readonly vertexIds: readonly Id[];
    private readonly center: Vec3;
    private readonly axis: Vec3;
    private readonly angle: number;
    private before: PosMap | null = null;

    constructor(mesh: Mesh, vertexIds: readonly Id[], center: Vec3, axis: Vec3, angle: number) {
        this.mesh = mesh;
        this.vertexIds = vertexIds;
        this.center = center;
        this.axis = axis;
        this.angle = angle;
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
            this.mesh.setVertexPosition(id, rotateAroundAxis(base, this.center, this.axis, this.angle));
        }
    }

    undo(_ctx: SelectionContext): void {
        if (!this.before) return;

        for (const [id, pos] of this.before.entries()) {
            this.mesh.setVertexPosition(id, cloneVec3(pos));
        }
    }
}

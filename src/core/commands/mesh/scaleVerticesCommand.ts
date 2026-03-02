import type { Command } from "../command";
import type { Mesh, Vec3 } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { SelectionContext } from "../selectionCommands/setSelectionCommand";

type PosMap = Map<Id, Vec3>;

function cloneVec3(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

function scaleAroundCenter(pos: Vec3, center: Vec3, factor: number): Vec3 {
    return {
        x: center.x + (pos.x - center.x) * factor,
        y: center.y + (pos.y - center.y) * factor,
        z: center.z + (pos.z - center.z) * factor,
    };
}

export class ScaleVerticesCommand implements Command<SelectionContext> {
    readonly name = "Scale Vertices";

    private readonly mesh: Mesh;
    private readonly vertexIds: readonly Id[];
    private readonly center: Vec3;
    private readonly factor: number;
    private before: PosMap | null = null;

    constructor(mesh: Mesh, vertexIds: readonly Id[], center: Vec3, factor: number) {
        this.mesh = mesh;
        this.vertexIds = vertexIds;
        this.center = center;
        this.factor = factor;
        this.before = null;
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
            this.mesh.setVertexPosition(id, scaleAroundCenter(base, this.center, this.factor));
        }
    }

    undo(_ctx: SelectionContext): void {
        if (!this.before) return;

        for (const [id, pos] of this.before.entries()) {
            this.mesh.setVertexPosition(id, cloneVec3(pos));
        }
    }
}

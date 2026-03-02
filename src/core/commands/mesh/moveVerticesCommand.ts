import type { Command } from "../command";
import type { Mesh, Vec3 } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { SelectionContext } from "../selectionCommands/setSelectionCommand";

type PosMap = Map<Id, Vec3>;

function cloneVec3(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

export class MoveVerticesCommand implements Command<SelectionContext> {
    readonly name = "Move Vertices";

    private readonly mesh: Mesh;
    private readonly vertexIds: readonly Id[];
    private readonly delta: Vec3;
    private before: PosMap | null = null;

    constructor(mesh: Mesh, vertexIds: readonly Id[], delta: Vec3) {
        this.mesh = mesh;
        this.vertexIds = vertexIds;
        this.delta = delta;
    }

    do(_ctx: SelectionContext): void {
        if (!this.before) {
            const before = new Map<Id, Vec3>();
            for (const id of this.vertexIds) {
                before.set(id, cloneVec3(this.mesh.getVertexPosition(id)));
            }
            this.before = before;
        }

        this.mesh.applyVertexDelta(this.vertexIds, this.delta);
    }

    undo(_ctx: SelectionContext): void {
        if (!this.before) return;

        for (const [id, pos] of this.before.entries()) {
            this.mesh.setVertexPosition(id, cloneVec3(pos));
        }
    }
}

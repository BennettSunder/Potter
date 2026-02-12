// import type { Id } from "../../ids";
import type { Mesh, Vec3 } from "../../mesh";

// Adapt this import to your command interface location:
import type { Command } from "../Command"; // <-- change if your repo uses a different path/name

type PosMap = Map<Id, Vec3>;

function cloneVec3(v: Vec3): Vec3 {
    return { x: v.x, y: v.y, z: v.z };
}

/**
 * Translates a set of vertices by a delta.
 * Stores minimal "before" positions for undo.
 */
export class MoveVerticesCommand implements Command {
    readonly name = "Move Vertices";

    private before: PosMap | null = null;

    constructor(
        private readonly mesh: Mesh,
            private readonly vertexIds: readonly Id[],
                private readonly delta: Vec3,
    ) {}

    do(): void {
        if (!this.before) {
            const m: PosMap = new Map();
            for (const id of this.vertexIds) {
                m.set(id, cloneVec3(this.mesh.getVertexPosition(id)));
            }
            this.before = m;
        }

        this.mesh.applyVertexDelta(this.vertexIds, this.delta);
    }

    undo(): void {
        if (!this.before) return;

        for (const [id, pos] of this.before.entries()) {
            this.mesh.setVertexPosition(id, cloneVec3(pos));
        }
    }
}

import type { Command } from "../command";
import type { Mesh } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { SelectionContext } from "../selectionCommands/setSelectionCommand";

type FaceVertsMap = Map<Id, Id[]>;

export class FlipFacesCommand implements Command<SelectionContext> {
    readonly name = "Flip Faces";

    private readonly mesh: Mesh;
    private readonly faceIds: readonly Id[];
    private before: FaceVertsMap | null = null;

    constructor(mesh: Mesh, faceIds: readonly Id[]) {
        this.mesh = mesh;
        this.faceIds = faceIds;
    }

    do(_ctx: SelectionContext): void {
        if (!this.before) {
            const before = new Map<Id, Id[]>();
            for (const faceId of this.faceIds) {
                before.set(faceId, [...this.mesh.getFaceById(faceId).verts]);
            }
            this.before = before;
        }

        for (const faceId of this.faceIds) {
            const verts = this.before.get(faceId);
            if (!verts) continue;
            this.mesh.setFaceVerts(faceId, [...verts].reverse());
        }
    }

    undo(_ctx: SelectionContext): void {
        if (!this.before) return;

        for (const [faceId, verts] of this.before.entries()) {
            this.mesh.setFaceVerts(faceId, verts);
        }
    }
}

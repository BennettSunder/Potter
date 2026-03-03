import type { Command } from "../command";
import type { Mesh } from "../../mesh";
import type { Id } from "../../ids/ids";
import type { FaceShading } from "../../mesh";

type SetFaceShadingContext = object;

export class SetFaceShadingCommand implements Command<SetFaceShadingContext> {
    readonly name = "Set Face Shading";

    private readonly mesh: Mesh;
    private readonly before = new Map<Id, FaceShading>();
    private readonly after: FaceShading;

    constructor(mesh: Mesh, faceIds: readonly Id[], shading: FaceShading) {
        this.mesh = mesh;
        this.after = shading;

        for (const faceId of faceIds) {
            this.before.set(faceId, mesh.getFaceById(faceId).shading);
        }
    }

    do(): void {
        for (const faceId of this.before.keys()) {
            this.mesh.setFaceShading(faceId, this.after);
        }
    }

    undo(): void {
        for (const [faceId, shading] of this.before.entries()) {
            this.mesh.setFaceShading(faceId, shading);
        }
    }
}

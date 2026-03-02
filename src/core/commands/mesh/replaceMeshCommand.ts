import type { Command } from "../command";
import type { Mesh, MeshSnapshot } from "../../mesh";
import type { Selection, SelectionSnapshot } from "../../selection/selection";
import { applySelectionSnapshot } from "../../selection/selection";

export type ReplaceMeshContext = {
    selection: Selection;
};

export class ReplaceMeshCommand implements Command<ReplaceMeshContext> {
    readonly name = "Replace Mesh";
    private readonly mesh: Mesh;
    private readonly beforeMesh: MeshSnapshot;
    private readonly afterMesh: MeshSnapshot;
    private readonly beforeSelection: SelectionSnapshot;
    private readonly afterSelection: SelectionSnapshot;

    constructor(
        mesh: Mesh,
        beforeMesh: MeshSnapshot,
        afterMesh: MeshSnapshot,
        beforeSelection: SelectionSnapshot,
        afterSelection: SelectionSnapshot,
    ) {
        this.mesh = mesh;
        this.beforeMesh = beforeMesh;
        this.afterMesh = afterMesh;
        this.beforeSelection = beforeSelection;
        this.afterSelection = afterSelection;
    }

    do(ctx: ReplaceMeshContext): void {
        this.mesh.restore(this.afterMesh);
        applySelectionSnapshot(ctx.selection, this.afterSelection);
    }

    undo(ctx: ReplaceMeshContext): void {
        this.mesh.restore(this.beforeMesh);
        applySelectionSnapshot(ctx.selection, this.beforeSelection);
    }
}

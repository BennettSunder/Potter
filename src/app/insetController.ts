import type { Mesh, MeshSnapshot } from "../core/mesh";
import type { CommandManager } from "../core/commands/commandManager";
import type { SelectionContext } from "../core/commands/selectionCommands/setSelectionCommand";
import { ReplaceMeshCommand } from "../core/commands/mesh/replaceMeshCommand";
import { buildInsetSnapshot } from "../core/commands/mesh/insetFacesCommand";
import { makeSelection, snapshotSelection, type SelectionSnapshot } from "../core/selection/selection";

export class InsetController {
    private active = false;
    private lastAmount = 0;
    private beforeMesh: MeshSnapshot | null = null;
    private afterMesh: MeshSnapshot | null = null;
    private beforeSelection: SelectionSnapshot = { faceIds: [], edgeIds: [], vertexIds: [] };
    private afterSelection: SelectionSnapshot = { faceIds: [], edgeIds: [], vertexIds: [] };
    private startClientX = 0;

    private readonly mesh: Mesh;
    private readonly selection: ReturnType<typeof makeSelection>;
    private readonly commands: CommandManager<SelectionContext>;
    private readonly cmdCtx: SelectionContext;
    private readonly getPointerClientPos: () => { x: number; y: number };
    private readonly requestRenderSync: () => void;

    constructor(
        mesh: Mesh,
        selection: ReturnType<typeof makeSelection>,
        commands: CommandManager<SelectionContext>,
        cmdCtx: SelectionContext,
        getPointerClientPos: () => { x: number; y: number },
        requestRenderSync: () => void,
    ) {
        this.mesh = mesh;
        this.selection = selection;
        this.commands = commands;
        this.cmdCtx = cmdCtx;
        this.getPointerClientPos = getPointerClientPos;
        this.requestRenderSync = requestRenderSync;
    }

    isActive(): boolean {
        return this.active;
    }

    beginFromKey(): void {
        if (this.active) return;
        if (this.selection.mode !== "face" || this.selection.faceIds.size === 0) return;

        this.beforeMesh = this.mesh.snapshot();
        this.afterMesh = this.beforeMesh;
        this.beforeSelection = snapshotSelection(this.selection);
        this.afterSelection = { faceIds: [], edgeIds: [], vertexIds: [] };
        this.lastAmount = 0;
        this.startClientX = this.getPointerClientPos().x;
        this.active = true;
    }

    onPointerMove(): void {
        if (!this.active || !this.beforeMesh) return;

        const dx = this.getPointerClientPos().x - this.startClientX;
        const amount = Math.max(0, Math.min(0.95, dx / 220));
        this.lastAmount = amount;

        const { snapshot, insetFaceIds } = buildInsetSnapshot(
            this.beforeMesh,
            Array.from(this.selection.faceIds),
            amount,
        );
        this.afterMesh = snapshot;
        this.afterSelection = { faceIds: insetFaceIds, edgeIds: [], vertexIds: [] };
        this.mesh.restore(snapshot);
        this.requestRenderSync();
    }

    cancel(): void {
        if (!this.active || !this.beforeMesh) return;
        this.mesh.restore(this.beforeMesh);
        this.requestRenderSync();
        this.reset();
    }

    commit(): void {
        if (!this.active || !this.beforeMesh || !this.afterMesh) return;

        if (this.lastAmount <= 1e-4) {
            this.mesh.restore(this.beforeMesh);
            this.requestRenderSync();
            this.reset();
            return;
        }

        this.commands.execute(
            this.cmdCtx,
            new ReplaceMeshCommand(
                this.mesh,
                this.beforeMesh,
                this.afterMesh,
                this.beforeSelection,
                this.afterSelection,
            ),
        );
        this.requestRenderSync();
        this.reset();
    }

    private reset(): void {
        this.active = false;
        this.lastAmount = 0;
        this.beforeMesh = null;
        this.afterMesh = null;
        this.beforeSelection = { faceIds: [], edgeIds: [], vertexIds: [] };
        this.afterSelection = { faceIds: [], edgeIds: [], vertexIds: [] };
    }
}

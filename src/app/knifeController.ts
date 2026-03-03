import type { Mesh, Vec3 } from "../core/mesh";
import type { Selection } from "../core/selection/selection";
import type { CommandManager } from "../core/commands/commandManager";
import type { SelectionContext } from "../core/commands/selectionCommands/setSelectionCommand";
import { KnifeFaceCommand } from "../core/commands/mesh/knifeFaceCommand";
import type { PickHit } from "../renderer/picking";
import type { Id } from "../core/ids/ids";

type KnifePoint = {
    faceId: Id;
    worldPos: Vec3;
};

export class KnifeController {
    private active = false;
    private firstPoint: KnifePoint | null = null;

    private readonly mesh: Mesh;
    private readonly selection: Selection;
    private readonly commands: CommandManager<SelectionContext>;
    private readonly cmdCtx: SelectionContext;
    private readonly requestRenderSync: () => void;

    constructor(
        mesh: Mesh,
        selection: Selection,
        commands: CommandManager<SelectionContext>,
        cmdCtx: SelectionContext,
        requestRenderSync: () => void,
    ) {
        this.mesh = mesh;
        this.selection = selection;
        this.commands = commands;
        this.cmdCtx = cmdCtx;
        this.requestRenderSync = requestRenderSync;
    }

    isActive(): boolean {
        return this.active;
    }

    begin(): void {
        if (this.active) return;
        this.active = true;
        this.firstPoint = null;
    }

    cancel(): void {
        this.active = false;
        this.firstPoint = null;
    }

    handlePick(hit: PickHit): boolean {
        if (!this.active || !hit || hit.type !== "face") return false;

        const nextPoint: KnifePoint = {
            faceId: hit.id,
            worldPos: { ...hit.worldPos },
        };

        if (!this.firstPoint) {
            this.firstPoint = nextPoint;
            return true;
        }

        if (this.firstPoint.faceId !== nextPoint.faceId) {
            this.firstPoint = nextPoint;
            return true;
        }

        this.commands.execute(
            this.cmdCtx,
            new KnifeFaceCommand(
                this.mesh,
                this.selection,
                this.firstPoint.faceId,
                this.firstPoint.worldPos,
                nextPoint.worldPos,
            ),
        );
        this.requestRenderSync();
        this.cancel();
        return true;
    }
}

import type { Command } from "./command";

export class CommandManager<Ctx> {
    private undoStack: Command<Ctx>[] = [];
    private redoStack: Command<Ctx>[] = [];

    constructor(private readonly maxHistory: number | null = null) {}

    execute(ctx: Ctx, cmd: Command<Ctx>): void {
        cmd.do(ctx);
        this.undoStack.push(cmd);
        this.redoStack.length = 0;

        // Enforce history limit (if enabled)
        if (this.maxHistory != null && this.undoStack.length > this.maxHistory) {
            // Remove oldest command
            this.undoStack.shift();
        }
    }

    undo(ctx: Ctx): void {
        const cmd = this.undoStack.pop();
        if (!cmd) return;
        cmd.undo(ctx);
        this.redoStack.push(cmd);
    }

    redo(ctx: Ctx): void {
        const cmd = this.redoStack.pop();
        if (!cmd) return;
        cmd.do(ctx);
        this.undoStack.push(cmd);
    }

    canUndo(): boolean { return this.undoStack.length > 0; }
    canRedo(): boolean { return this.redoStack.length > 0; }

    clear(): void {
        this.undoStack.length = 0;
        this.redoStack.length = 0;
    }
}

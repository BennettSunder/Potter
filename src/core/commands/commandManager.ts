import type { Command } from "./command";

export class CommandManager<Ctx> {
    private undoStack: Command<Ctx>[] = [];
    private redoStack: Command<Ctx>[] = [];

    execute(ctx: Ctx, cmd: Command<Ctx>) {
        cmd.do(ctx);
        this.undoStack.push(cmd);
        this.redoStack.length = 0;
    }

    undo(ctx: Ctx) {
        const cmd = this.undoStack.pop();
        if (!cmd) return;
        cmd.undo(ctx);
        this.redoStack.push(cmd);
    }

    redo(ctx: Ctx) {
        const cmd = this.redoStack.pop();
        if (!cmd) return;
        cmd.do(ctx);
        this.undoStack.push(cmd);
    }

    canUndo() { return this.undoStack.length > 0; }
    canRedo() { return this.redoStack.length > 0; }
}

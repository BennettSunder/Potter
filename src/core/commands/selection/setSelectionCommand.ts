import type { Command } from "../command";
import type { SelectionSnapshot, Selection } from "../../selection/selection";
import { applySelectionSnapshot } from "../../selection/selection";

export type SelectionContext = {
    selection: Selection;
};

export class SetSelectionCommand implements Command<SelectionContext> {
    readonly name = "Set Selection";

    constructor(
        private readonly before: SelectionSnapshot,
            private readonly after: SelectionSnapshot
    ) {}

    do(ctx: SelectionContext): void {
        applySelectionSnapshot(ctx.selection, this.after);
    }

    undo(ctx: SelectionContext): void {
        applySelectionSnapshot(ctx.selection, this.before);
    }
}

export interface Command<Ctx> {
    readonly name: string;
    do(ctx: Ctx): void;
    undo(ctx: Ctx): void;
}

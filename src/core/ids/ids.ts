export type Id = string;

export function makeId(prefix: string): Id {
    return `${prefix}_${crypto.randomUUID()}`;
}

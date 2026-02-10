import type { Id } from "./ids";
import { makeId } from "./ids";

export type Vec3 = { x: number; y: number; z: number };

export type Vertex = {
    id: Id;
    position: Vec3;
};

export type Face = {
    id: Id;
    verts: [Id, Id, Id];
};

export class Mesh {
    private vertices: Vertex[] = [];
    private faces: Face[] = [];

    private vIndexById = new Map<Id, number>();
    private fIndexById = new Map<Id, number>();

    addVertex(pos: Vec3): Id {
        const id = makeId("v");
        this.vertices.push({ id, position: pos });
        this.rebuildMaps();
        return id;
    }

    addFace(verts: [Id, Id, Id]): Id {
        const id = makeId("f");
        this.faces.push({ id, verts });
        this.rebuildMaps();
        return id;
    }

    getVertices() {
        return this.vertices;
    }

    getFaces() {
        return this.faces;
    }

    getVertexIndex(id: Id): number {
        const idx = this.vIndexById.get(id);
        if (idx === undefined) throw new Error("Bad vertex id");
        return idx;
    }

    rebuildMaps() {
        this.vIndexById.clear();
        this.fIndexById.clear();
        this.vertices.forEach((v, i) => this.vIndexById.set(v.id, i));
        this.faces.forEach((f, i) => this.fIndexById.set(f.id, i));
    }
}

export function makeUnitCubeMesh(): Mesh {
    const m = new Mesh();

    const v = [
        m.addVertex({ x:  0.5, y:  0.5, z:  0.5 }),
        m.addVertex({ x: -0.5, y:  0.5, z:  0.5 }),
        m.addVertex({ x:  0.5, y: -0.5, z:  0.5 }),
        m.addVertex({ x: -0.5, y: -0.5, z:  0.5 }),
        m.addVertex({ x:  0.5, y:  0.5, z: -0.5 }),
        m.addVertex({ x: -0.5, y:  0.5, z: -0.5 }),
        m.addVertex({ x:  0.5, y: -0.5, z: -0.5 }),
        m.addVertex({ x: -0.5, y: -0.5, z: -0.5 }),
    ];

    // const v = [
    //     m.addVertex({ x:  0.5, y:  0.5, z:  0.5 }),
    //     m.addVertex({ x:  0.0, y:  0.6, z:  0.6 }),
    //     m.addVertex({ x:  -0.5, y:  0.5, z:  0.5 }),
    //     m.addVertex({ x:  -0.5, y:  0.6, z:  0.0 }),
    //     m.addVertex({ x:  -0.5, y:  0.5, z:  -0.5 }),
    //     m.addVertex({ x:  0.0, y:  0.6, z:  0.5 }),
    // ];

    const f = (a: number, b: number, c: number) => m.addFace([v[a], v[b], v[c]]);

    f(0, 1, 2); f(1, 3, 2);
    f(4, 6, 5); f(5, 6, 7);
    f(0, 4, 1); f(1, 4, 5);
    f(2, 3, 6); f(3, 7, 6);
    f(0, 2, 4); f(2, 6, 4);
    f(1, 5, 3); f(3, 5, 7);

    return m;
}

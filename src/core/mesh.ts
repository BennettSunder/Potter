// src/core/mesh.ts
//
// Core mesh data model (pure logic; no Three.js).
//
// Key properties:
//
// - Stable IDs for vertices/faces/edges (IDs are identity; array indices are storage detail)
// - Faces are POLYGONS: verts: Id[] with length >= 3
// - Renderer triangulates polygons for display, but selection stores IDs (stable)
//
// For now, we keep this simple (no deletion, no adjacency cache, no topology structure).
// As we add modeling tools, we’ll add command-based edits + adjacency later.

import type { Id } from "./ids/ids";
import { makeId } from "./ids/ids";

export type Vec3 = { x: number; y: number; z: number };

export type Vertex = {
    id: Id;
    position: Vec3;
};

export type Face = {
    id: Id;
    // Polygon face: 3..N vertex IDs.
    // Winding order matters (should be consistent for normals / picking expectations).
    verts: Id[]; // length >= 3
};

/**
 * Stable edge identity.
 * Undirected: {a,b} is the same as {b,a}.
 * We keep a canonical ordering inside the Edge record.
 */
export type Edge = {
    id: Id;
    a: Id; // canonical: a < b (string compare)
    b: Id;
};

function edgeKey(a: Id, b: Id): string {
    // Deterministic undirected key
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export class Mesh {
    // Storage arrays (indices are NOT stable identity)
    private vertices: Vertex[] = [];
    private faces: Face[] = [];

    // Derived edges (rebuilt from faces)
    private edges: Edge[] = [];

    // Rebuildable maps: id -> index (fast lookup; selection never stores indices)
    private vIndexById = new Map<Id, number>();
    private fIndexById = new Map<Id, number>();
    private eIndexById = new Map<Id, number>();

    // Keep edge IDs stable across rebuilds by remembering key -> edgeId
    private edgeIdByKey = new Map<string, Id>();

    // -------------
    // Creation API
    // -------------

    addVertex(pos: Vec3): Id {
        const id = makeId("v");
        this.vertices.push({ id, position: pos });
        this.rebuildMaps();
        return id;
    }

    /**
     * Adds a polygon face. Must have at least 3 verts.
     * NOTE: we do not validate planarity/convexity here (renderer triangulates with a fan).
     */
    addFace(verts: Id[]): Id {
        if (verts.length < 3) throw new Error("Face must have at least 3 verts.");
        const id = makeId("f");
        this.faces.push({ id, verts: [...verts] });
        this.rebuildMaps();
        return id;
    }

    // ----------------
    // Read-only access
    // ----------------

    getVertices(): ReadonlyArray<Vertex> {
        return this.vertices;
    }

    getFaces(): ReadonlyArray<Face> {
        return this.faces;
    }

    getEdges(): ReadonlyArray<Edge> {
        return this.edges;
    }

    // ----------------
    // Lookup utilities
    // ----------------

    /**
     * Converts a vertexId -> current storage index.
     * Used by renderer when building index buffers.
     */
    getVertexIndex(id: Id): number {
        const idx = this.vIndexById.get(id);
        if (idx === undefined) throw new Error(`Mesh.getVertexIndex: unknown vertex id ${id}`);
        return idx;
    }

    /**
     * Direct lookup: vertexId -> Vertex
     * Useful for UI formatting (“show selected vertex positions”) without leaking array indexing.
     */
    getVertexById(id: Id): Vertex {
        const idx = this.getVertexIndex(id);
        const v = this.vertices[idx];
        if (!v) throw new Error(`Mesh.getVertexById: unknown vertex id ${id}`);
        return v;
    }

    /**
     * Direct lookup: faceId -> Face
     */
    getFaceById(id: Id): Face {
        const idx = this.fIndexById.get(id);
        if (idx === undefined) throw new Error(`Mesh.getFaceById: unknown face id ${id}`);
        const f = this.faces[idx];
        if (!f) throw new Error(`Mesh.getFaceById: unknown face id ${id}`);
        return f;
    }

    /**
     * Direct lookup: edgeId -> Edge
     */
    getEdgeById(id: Id): Edge {
        const idx = this.eIndexById.get(id);
        if (idx === undefined) throw new Error(`Mesh.getEdgeById: unknown edge id ${id}`);
        const e = this.edges[idx];
        if (!e) throw new Error(`Mesh.getEdgeById: unknown edge id ${id}`);
        return e;
    }

    // ----------------
    // Maps + derived data rebuild
    // ----------------

    /**
     * Rebuild id->index maps + derived edges.
     * In early MVP we call this after each edit.
     * Later: commands store deltas and we can update maps incrementally if needed.
     */
    rebuildMaps(): void {
        this.vIndexById.clear();
        this.fIndexById.clear();
        this.eIndexById.clear();

        this.vertices.forEach((v, i) => this.vIndexById.set(v.id, i));
        this.faces.forEach((f, i) => this.fIndexById.set(f.id, i));

        // Rebuild edges from faces
        this.edges.length = 0;

        const seenKeys = new Set<string>();

        for (const f of this.faces) {
            const vs = f.verts;
            const n = vs.length;
            if (n < 3) continue;

            for (let i = 0; i < n; i++) {
                const a0 = vs[i]!;
                const b0 = vs[(i + 1) % n]!;
                const key = edgeKey(a0, b0);

                if (seenKeys.has(key)) continue;
                seenKeys.add(key);

                // Stable edge ID: reuse if this key existed before
                let eid = this.edgeIdByKey.get(key);
                if (!eid) {
                    eid = makeId("e");
                    this.edgeIdByKey.set(key, eid);
                }

                const a = a0 < b0 ? a0 : b0;
                const b = a0 < b0 ? b0 : a0;

                this.edges.push({ id: eid, a, b });
            }
        }

        this.edges.forEach((e, i) => this.eIndexById.set(e.id, i));
    }

    // ----------------
    // Vertex edit helpers (used by commands)
    // ----------------

    getVertexPosition(id: Id): Vec3 {
        const i = this.vIndexById.get(id);
        if (i === undefined) throw new Error(`Mesh.getVertexPosition: unknown vertex id ${id}`);
        return this.vertices[i].position;
    }

    setVertexPosition(id: Id, pos: Vec3): void {
        const i = this.vIndexById.get(id);
        if (i === undefined) throw new Error(`Mesh.setVertexPosition: unknown vertex id ${id}`);
        this.vertices[i].position = pos;
    }

    /** Convenience: translate a set of vertices by delta. */
    applyVertexDelta(vertexIds: readonly Id[], delta: Vec3): void {
        for (const id of vertexIds) {
            const p = this.getVertexPosition(id);
            this.setVertexPosition(id, {
                x: p.x + delta.x,
                y: p.y + delta.y,
                z: p.z + delta.z,
            });
        }
    }
}

// ------------------------------
// Example primitive: unit cube
// ------------------------------

export function makeUnitCubeMesh(): Mesh {
    const m = new Mesh();

    const v = [
        m.addVertex({ x: 0.5, y: 0.5, z: 0.5 }), // 0
        m.addVertex({ x: -0.5, y: 0.5, z: 0.5 }), // 1
        m.addVertex({ x: 0.5, y: -0.5, z: 0.5 }), // 2
        m.addVertex({ x: -0.5, y: -0.5, z: 0.5 }), // 3
        m.addVertex({ x: 0.5, y: 0.5, z: -0.5 }), // 4
        m.addVertex({ x: -0.5, y: 0.5, z: -0.5 }), // 5
        m.addVertex({ x: 0.5, y: -0.5, z: -0.5 }), // 6
        m.addVertex({ x: -0.5, y: -0.5, z: -0.5 }), // 7
    ];

    const q = (a: number, b: number, c: number, d: number) => m.addFace([v[a], v[b], v[c], v[d]]);

    // Front  (z +0.5)
    q(0, 1, 3, 2);

    // Back   (z -0.5)
    q(4, 6, 7, 5);

    // Top    (y +0.5)
    q(0, 4, 5, 1);

    // Bottom (y -0.5)
    q(2, 3, 7, 6);

    // Right  (x +0.5)
    q(0, 2, 6, 4);

    // Left   (x -0.5)
    q(1, 5, 7, 3);

    return m;
}

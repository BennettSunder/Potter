// src/core/mesh.ts
//
// Core mesh data model (pure logic; no Three.js).
//
// Key properties:
//
// - Stable IDs for vertices/faces (IDs are identity; array indices are storage detail)
// - Faces are POLYGONS: verts: Id[] with length >= 3
// - Renderer triangulates polygons for display, but selection stores faceId (stable)
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

export class Mesh {
    // Storage arrays (indices are NOT stable identity)
    private vertices: Vertex[] = [];
    private faces: Face[] = [];

    // Rebuildable maps: id -> index (fast lookup; selection never stores indices)
    private vIndexById = new Map<Id, number>();
    private fIndexById = new Map<Id, number>();

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

    // ----------------
    // Lookup utilities
    // ----------------

    /**
     * Converts a vertexId -> current storage index.
     * Used by renderer when building index buffers.
     */
    getVertexIndex(id: Id): number {
        const idx = this.vIndexById.get(id);
        if (idx === undefined) throw new Error("Bad vertex id");
        return idx;
    }

    /**
     * Direct lookup: vertexId -> Vertex
     * Useful for UI formatting (“show selected vertex positions”) without leaking array indexing.
     */
    getVertexById(id: Id): Vertex {
        const idx = this.getVertexIndex(id);
        const v = this.vertices[idx];
        if (!v) throw new Error("Bad vertex id");
        return v;
    }

    /**
     * Direct lookup: faceId -> Face
     * (Not required yet, but symmetrical and useful later.)
     */
    getFaceById(id: Id): Face {
        const idx = this.fIndexById.get(id);
        if (idx === undefined) throw new Error("Bad face id");
        const f = this.faces[idx];
        if (!f) throw new Error("Bad face id");
        return f;
    }

    /**
     * Rebuild id->index maps.
     * In early MVP we call this after each edit.
     * Later: commands store deltas and we can update maps incrementally if needed.
     */
    rebuildMaps(): void {
        this.vIndexById.clear();
        this.fIndexById.clear();
        this.vertices.forEach((v, i) => this.vIndexById.set(v.id, i));
        this.faces.forEach((f, i) => this.fIndexById.set(f.id, i));
    }
}

// ------------------------------
// Example primitive: unit cube
// ------------------------------
//
// This cube is authored as 6 QUADS (not 12 tris).
// Renderer triangulates each quad into 2 triangles, but both tris map to the same faceId,
// which is what gives you “select whole cube side” behavior.
//
// NOTE: I removed your extra debug vertex (index 8) because it changes vertex count and
// can confuse early edge/vertex picking expectations. Add it back later when you’re
// intentionally testing non-cube topology.

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

    // Helper to add a quad face by vertex indices
    const q = (a: number, b: number, c: number, d: number) =>
    m.addFace([v[a], v[b], v[c], v[d]]);

    // Faces are defined as QUADS (winding should be consistent).
    // These are ordered so the outside should be the “front” side.

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

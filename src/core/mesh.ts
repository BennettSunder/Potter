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

export type MeshSnapshot = {
    vertices: Vertex[];
    faces: Face[];
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

    snapshot(): MeshSnapshot {
        return {
            vertices: this.vertices.map((v) => ({
                id: v.id,
                position: { ...v.position },
            })),
            faces: this.faces.map((f) => ({
                id: f.id,
                verts: [...f.verts],
            })),
        };
    }

    restore(snapshot: MeshSnapshot): void {
        this.vertices = snapshot.vertices.map((v) => ({
            id: v.id,
            position: { ...v.position },
        }));
        this.faces = snapshot.faces.map((f) => ({
            id: f.id,
            verts: [...f.verts],
        }));
        this.rebuildMaps();
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

function makeMeshFromIndexedPolygons(
    positions: readonly Vec3[],
    polygons: readonly (readonly number[])[]
): Mesh {
    const m = new Mesh();
    const ids = positions.map((p) => m.addVertex({ x: p.x, y: p.y, z: p.z }));
    for (const poly of polygons) {
        m.addFace(poly.map((i) => ids[i]!));
    }
    return m;
}

function normalizePositionsToHalfExtent(positions: Vec3[]): Vec3[] {
    let maxAbs = 0;
    for (const p of positions) {
        maxAbs = Math.max(maxAbs, Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    }
    if (maxAbs <= 1e-9) return positions.map((p) => ({ ...p }));
    const s = 0.5 / maxAbs;
    return positions.map((p) => ({ x: p.x * s, y: p.y * s, z: p.z * s }));
}

function makeIcosahedronData(): { positions: Vec3[]; faces: number[][] } {
    const phi = (1 + Math.sqrt(5)) * 0.5;

    const positions: Vec3[] = [
        { x: -1, y: phi, z: 0 },
        { x: 1, y: phi, z: 0 },
        { x: -1, y: -phi, z: 0 },
        { x: 1, y: -phi, z: 0 },
        { x: 0, y: -1, z: phi },
        { x: 0, y: 1, z: phi },
        { x: 0, y: -1, z: -phi },
        { x: 0, y: 1, z: -phi },
        { x: phi, y: 0, z: -1 },
        { x: phi, y: 0, z: 1 },
        { x: -phi, y: 0, z: -1 },
        { x: -phi, y: 0, z: 1 },
    ];

    const faces: number[][] = [
        [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
        [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
        [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
        [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
    ];

    return { positions, faces };
}

function vecSub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function vecDot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecCross(a: Vec3, b: Vec3): Vec3 {
    return {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
    };
}

function vecScale(a: Vec3, s: number): Vec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function vecLen(a: Vec3): number {
    return Math.sqrt(vecDot(a, a));
}

function vecNormalize(a: Vec3): Vec3 {
    const len = vecLen(a);
    if (len <= 1e-9) return { x: 0, y: 0, z: 0 };
    return vecScale(a, 1 / len);
}

function faceNormal(indices: readonly number[], positions: readonly Vec3[]): Vec3 {
    if (indices.length < 3) return { x: 0, y: 0, z: 0 };
    const a = positions[indices[0]]!;
    const b = positions[indices[1]]!;
    const c = positions[indices[2]]!;
    return vecCross(vecSub(b, a), vecSub(c, a));
}

function faceCentroid(indices: readonly number[], positions: readonly Vec3[]): Vec3 {
    let x = 0;
    let y = 0;
    let z = 0;
    for (const i of indices) {
        const p = positions[i]!;
        x += p.x;
        y += p.y;
        z += p.z;
    }
    const n = indices.length || 1;
    return { x: x / n, y: y / n, z: z / n };
}

function ensureOutward(indices: number[], positions: readonly Vec3[]): number[] {
    const n = faceNormal(indices, positions);
    const c = faceCentroid(indices, positions);
    if (vecDot(n, c) < 0) return [...indices].reverse();
    return indices;
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

export function makeCubeMesh(): Mesh {
    return makeUnitCubeMesh();
}

export function makeIcosahedronMesh(): Mesh {
    const { positions, faces } = makeIcosahedronData();
    const normalized = normalizePositionsToHalfExtent(positions);
    return makeMeshFromIndexedPolygons(normalized, faces);
}

export function makeTruncatedIcosahedronMesh(): Mesh {
    const { positions: icoPositions, faces: icoFaces } = makeIcosahedronData();

    const outPositions: Vec3[] = [];
    const orientedIndex = new Map<string, number>();

    const key = (a: number, b: number) => `${a}->${b}`;
    const getOrientedIndex = (a: number, b: number): number => {
        const k = key(a, b);
        const found = orientedIndex.get(k);
        if (found !== undefined) return found;

        const pa = icoPositions[a]!;
        const pb = icoPositions[b]!;
        const p = {
            x: (2 * pa.x + pb.x) / 3,
            y: (2 * pa.y + pb.y) / 3,
            z: (2 * pa.z + pb.z) / 3,
        };
        const idx = outPositions.length;
        outPositions.push(p);
        orientedIndex.set(k, idx);
        return idx;
    };

    const hexFaces: number[][] = icoFaces.map(([a, b, c]) => [
        getOrientedIndex(a, b),
        getOrientedIndex(b, a),
        getOrientedIndex(b, c),
        getOrientedIndex(c, b),
        getOrientedIndex(c, a),
        getOrientedIndex(a, c),
    ]);

    const neighborsByVertex = new Map<number, Set<number>>();
    for (const [a, b, c] of icoFaces) {
        if (!neighborsByVertex.has(a)) neighborsByVertex.set(a, new Set<number>());
        if (!neighborsByVertex.has(b)) neighborsByVertex.set(b, new Set<number>());
        if (!neighborsByVertex.has(c)) neighborsByVertex.set(c, new Set<number>());

        neighborsByVertex.get(a)!.add(b);
        neighborsByVertex.get(a)!.add(c);
        neighborsByVertex.get(b)!.add(a);
        neighborsByVertex.get(b)!.add(c);
        neighborsByVertex.get(c)!.add(a);
        neighborsByVertex.get(c)!.add(b);
    }

    const pentFaces: number[][] = [];
    for (let i = 0; i < icoPositions.length; i++) {
        const neighbors = Array.from(neighborsByVertex.get(i) ?? []);
        if (neighbors.length !== 5) continue;

        const center = vecNormalize(icoPositions[i]!);
        const first = vecNormalize(vecSub(icoPositions[neighbors[0]]!, vecScale(center, vecDot(icoPositions[neighbors[0]]!, center))));
        const tangent = vecNormalize(vecCross(center, first));

        neighbors.sort((u, v) => {
            const pu = vecNormalize(vecSub(icoPositions[u]!, vecScale(center, vecDot(icoPositions[u]!, center))));
            const pv = vecNormalize(vecSub(icoPositions[v]!, vecScale(center, vecDot(icoPositions[v]!, center))));
            const au = Math.atan2(vecDot(pu, tangent), vecDot(pu, first));
            const av = Math.atan2(vecDot(pv, tangent), vecDot(pv, first));
            return au - av;
        });

        pentFaces.push(neighbors.map((n) => getOrientedIndex(i, n)));
    }

    const allFaces = [...hexFaces, ...pentFaces].map((f) => ensureOutward(f, outPositions));
    const normalized = normalizePositionsToHalfExtent(outPositions);
    return makeMeshFromIndexedPolygons(normalized, allFaces);
}

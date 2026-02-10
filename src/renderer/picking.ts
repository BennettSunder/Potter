// src/renderer/picking.ts
import * as THREE from "three";
import type { Id } from "../core/ids";
import type { Id } from "../core/ids";
import type { Face } from "../core/mesh";

export type PickHit =
| {
    type: "face" | "edge" | "vertex";
    id: Id;
    depth: number;
    worldPos: { x: number; y: number; z: number };
}
| null;

export type PickState = {
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    raycaster: THREE.Raycaster;
    meshObj?: THREE.Mesh;

    // Stable-ID bridges / caches
    triToFaceId: Id[];
    indexToVertId: Id[];

    // Fast lookups / caches
    vertIndexById: Map<Id, number>;
    edgeKeys: string[];
};


/**
 * Build unique undirected edge keys ("aId|bId") from core polygon faces.
 * This uses ONLY polygon boundary edges (no triangulation diagonals).
 */
export function buildEdgeKeysFromFaces(faces: ReadonlyArray<Face>): string[] {
    const edgeSet = new Set<string>();

    const addUndirected = (a: Id, b: Id) => {
        // normalize so edge A|B == B|A
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edgeSet.add(key);
    };

    for (const f of faces) {
        const vs = f.verts;
        if (vs.length < 2) continue;

        for (let i = 0; i < vs.length; i++) {
            const a = vs[i];
            const b = vs[(i + 1) % vs.length];
            addUndirected(a, b);
        }
    }

    return Array.from(edgeSet);
}


/**
 * ndcX/ndcY are normalized device coordinates in [-1, 1]
 */
export function pickFace(state: PickState, ndcX: number, ndcY: number): PickHit {
    if (!state.meshObj) return null;

    state.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), state.camera);
    const hits = state.raycaster.intersectObject(state.meshObj, false);
    if (hits.length === 0) return null;

    const h = hits[0];
    if (h.faceIndex == null) return null;

    const tri = h.faceIndex;
    const faceId = state.triToFaceId[tri];
    if (!faceId) return null;

    return {
        type: "face",
        id: faceId,
        depth: h.distance,
        worldPos: { x: h.point.x, y: h.point.y, z: h.point.z },
    };
}

export function pickEdge(
    state: PickState,
    ndcX: number,
    ndcY: number,
    radiusPx: number
): PickHit {
    if (!state.meshObj) return null;

    state.camera.updateMatrixWorld(true);
    state.meshObj.updateMatrixWorld(true);

    const geo = state.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;

    // Renderer buffer size (accounts for devicePixelRatio)
    const size = new THREE.Vector2();
    state.renderer.getSize(size);
    const dpr = state.renderer.getPixelRatio();
    const w = size.x * dpr;
    const h = size.y * dpr;

    // Mouse in pixel coords
    const mx = (ndcX * 0.5 + 0.5) * w;
    const my = (-ndcY * 0.5 + 0.5) * h;

    let bestKey: string | null = null;
    let bestD2 = radiusPx * radiusPx;

    const worldMat = state.meshObj.matrixWorld;
    const aWorld = new THREE.Vector3();
    const bWorld = new THREE.Vector3();
    const aNdc = new THREE.Vector3();
    const bNdc = new THREE.Vector3();
    const bestWorld = new THREE.Vector3();
    let bestDepth = Infinity;

    for (const key of state.edgeKeys) {
        const [aIdRaw, bIdRaw] = key.split("|");
        const aId = aIdRaw as unknown as Id;
        const bId = bIdRaw as unknown as Id;

        const ia = state.vertIndexById.get(aId);
        const ib = state.vertIndexById.get(bId);
        if (ia == null || ib == null) continue;

        // World endpoints
        aWorld
        .set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia))
        .applyMatrix4(worldMat);
        bWorld
        .set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib))
        .applyMatrix4(worldMat);

        // Project to NDC
        aNdc.copy(aWorld).project(state.camera);
        bNdc.copy(bWorld).project(state.camera);

        const aOk = aNdc.z >= -1 && aNdc.z <= 1;
        const bOk = bNdc.z >= -1 && bNdc.z <= 1;
        if (!aOk && !bOk) continue;

        // Convert to pixel coords
        const ax = (aNdc.x * 0.5 + 0.5) * w;
        const ay = (-aNdc.y * 0.5 + 0.5) * h;
        const bx = (bNdc.x * 0.5 + 0.5) * w;
        const by = (-bNdc.y * 0.5 + 0.5) * h;

        // Distance from mouse point to segment AB in pixel space
        const abx = bx - ax;
        const aby = by - ay;
        const apx = mx - ax;
        const apy = my - ay;

        const denom = abx * abx + aby * aby;
        if (denom < 1e-8) continue;

        let tSeg = (apx * abx + apy * aby) / denom;
        if (tSeg < 0) tSeg = 0;
        else if (tSeg > 1) tSeg = 1;

        const cx = ax + abx * tSeg;
        const cy = ay + aby * tSeg;

        const dx = mx - cx;
        const dy = my - cy;
        const d2 = dx * dx + dy * dy;

        if (d2 <= bestD2) {
            bestD2 = d2;
            bestKey = key;

            bestWorld.copy(aWorld).lerp(bWorld, tSeg);
            bestDepth = bestWorld.distanceTo(state.camera.position);
        }
    }

    if (!bestKey) return null;

    return {
        type: "edge",
        id: bestKey as unknown as Id,
        depth: bestDepth,
        worldPos: { x: bestWorld.x, y: bestWorld.y, z: bestWorld.z },
    };
}

export function pickVertex(
    state: PickState,
    ndcX: number,
    ndcY: number,
    radiusPx: number
): PickHit {
    if (!state.meshObj) return null;

    state.camera.updateMatrixWorld(true);
    state.meshObj.updateMatrixWorld(true);

    const geo = state.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;

    const size = new THREE.Vector2();
    state.renderer.getSize(size);
    const dpr = state.renderer.getPixelRatio();
    const w = size.x * dpr;
    const h = size.y * dpr;

    let bestI = -1;
    let bestDist2 = radiusPx * radiusPx;
    const bestWorld = new THREE.Vector3();

    const worldMat = state.meshObj.matrixWorld;
    const tmpWorld = new THREE.Vector3();
    const projected = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
        tmpWorld
        .set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
        .applyMatrix4(worldMat);

        projected.copy(tmpWorld).project(state.camera);

        if (projected.z < -1 || projected.z > 1) continue;

        const dx = (projected.x - ndcX) * (w * 0.5);
        const dy = (projected.y - ndcY) * (h * 0.5);
        const d2 = dx * dx + dy * dy;

        if (d2 <= bestDist2) {
            bestDist2 = d2;
            bestI = i;
            bestWorld.copy(tmpWorld);
        }
    }

    if (bestI < 0) return null;

    const vId = state.indexToVertId[bestI];
    if (!vId) return null;

    return {
        type: "vertex",
        id: vId,
        depth: bestWorld.distanceTo(state.camera.position),
        worldPos: { x: bestWorld.x, y: bestWorld.y, z: bestWorld.z },
    };
}

export function getViewportSizePx(renderer: THREE.WebGLRenderer): {
    w: number;
    h: number;
    dpr: number;
} {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    const dpr = renderer.getPixelRatio();
    return { w: size.x * dpr, h: size.y * dpr, dpr };
}

export function getCanvasRectCssPx(renderer: THREE.WebGLRenderer): DOMRect {
    return renderer.domElement.getBoundingClientRect();
}

/**
 * Builds unique undirected edges as "aId|bId".
 * Pass in the *current* indexToVertId mapping that matches the geometry's vertex order.
 */
export function buildEdgeKeys(
    geo: THREE.BufferGeometry,
    indexToVertId: Id[]
): string[] {
    const indexAttr = geo.getIndex();
    if (!indexAttr) return [];

    const edgeSet = new Set<string>();

    const addEdge = (ia: number, ib: number) => {
        const aId = indexToVertId[ia];
        const bId = indexToVertId[ib];
        if (!aId || !bId) return;
        const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
        edgeSet.add(key);
    };

    for (let t = 0; t < indexAttr.count; t += 3) {
        const i0 = indexAttr.getX(t + 0);
        const i1 = indexAttr.getX(t + 1);
        const i2 = indexAttr.getX(t + 2);
        addEdge(i0, i1);
        addEdge(i1, i2);
        addEdge(i2, i0);
    }

    return Array.from(edgeSet);
}

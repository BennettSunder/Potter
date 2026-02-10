// src/renderer/overlays.ts
//
// This module owns all *overlay* rendering:
//
// 1) Base overlays
//    - edges overlay (wireframe-like)
//    - vertex overlay (points)
//
// 2) Selection overlays
//    - selected faces highlight (filled translucent mesh)
//    - selected vertices highlight (bigger points)
//    - selected edges highlight (bright line segments)
//
// IMPORTANT DESIGN NOTE
// - The renderer's main mesh geometry is always TRIANGLES.
// - Core faces may be quads/ngons; the renderer triangulates them.
// - For selection highlighting we want the WHOLE core face highlighted,
//   so setSelectedFaces takes:
//     triIndicesByFaceId: Map<faceId, number[]>
//   where the number[] is all triangle indices that belong to that face.
//
// This keeps selection identity stable (faceId) while rendering stays triangle-based.

import * as THREE from "three";
import type { Id } from "../core/ids";

export type DisplayMode = "face" | "edge" | "vertex";

export type OverlayMaterials = {
    // base overlays
    edgesMat: THREE.LineBasicMaterial;
    vertsMat: THREE.PointsMaterial;

    // selection overlays
    selectedFacesMat: THREE.MeshStandardMaterial;
    selectedVertsMat: THREE.PointsMaterial;
    selectedEdgesMat: THREE.LineBasicMaterial;
};

export type OverlayObjects = {
    // base overlays
    edgesObj?: THREE.LineSegments;
    vertsObj?: THREE.Points;

    // selection overlays
    selectedFacesObj?: THREE.Mesh;
    selectedVertsObj?: THREE.Points;
    selectedEdgesObj?: THREE.LineSegments;
};

export function createDefaultOverlayMaterials(): OverlayMaterials {
    // Base edge overlay (opacity is adjusted by setDisplayMode)
    const edgesMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });

    // Base vertex overlay (only visible in vertex mode)
    const vertsMat = new THREE.PointsMaterial({
        size: 6, // pixels (sizeAttenuation: false)
    sizeAttenuation: false,
    color: 0x55aa88,
    depthTest: true,
    });

    // Selected face highlight (slightly offset to reduce z-fighting)
    const selectedFacesMat = new THREE.MeshBasicMaterial({
        color: 0x00ffaa,
        transparent: true,
        opacity: 0.35,      // <- mostly transparent
        side: THREE.DoubleSide,
        depthTest: true,   // <- draw on top of mesh
    });


    // Selected vertex highlight
    const selectedVertsMat = new THREE.PointsMaterial({
        size: 10,
        sizeAttenuation: false,
        color: 0x00ffaa,
        depthTest: true,
    });

    // Selected edge highlight
    const selectedEdgesMat = new THREE.LineBasicMaterial({
        transparent: true,
        opacity: 1.0,
        color: 0xffcc00,
        depthTest: false,
    });

    return {
        edgesMat,
        vertsMat,
        selectedFacesMat,
        selectedVertsMat,
        selectedEdgesMat,
    };
}

export function disposeOverlayMaterials(m: OverlayMaterials): void {
    m.edgesMat.dispose();
    m.vertsMat.dispose();
    m.selectedFacesMat.dispose();
    m.selectedVertsMat.dispose();
    m.selectedEdgesMat.dispose();
}

// -----------------------------------------
// Base overlays (edges + verts display modes)
// -----------------------------------------

/**
 * (Re)builds base overlays for the current mesh geometry.
 * Call this whenever the mesh BufferGeometry changes.
 */
export function rebuildBaseOverlays(
    scene: THREE.Scene,
    meshGeo: THREE.BufferGeometry,
    mats: OverlayMaterials,
    objs: OverlayObjects
): void {
    // --- Edges overlay ---
    if (objs.edgesObj) {
        scene.remove(objs.edgesObj);
        objs.edgesObj.geometry.dispose();
        objs.edgesObj = undefined;
    }
    const edgesGeo = new THREE.EdgesGeometry(meshGeo, 1);
    objs.edgesObj = new THREE.LineSegments(edgesGeo, mats.edgesMat);
    scene.add(objs.edgesObj);

    // --- Vertex overlay (Points) ---
    if (objs.vertsObj) {
        scene.remove(objs.vertsObj);
        objs.vertsObj.geometry.dispose();
        objs.vertsObj = undefined;
    }
    const vertsGeo = new THREE.BufferGeometry();
    // share the position attribute with the mesh geometry (no copy)
    vertsGeo.setAttribute("position", meshGeo.getAttribute("position"));
    objs.vertsObj = new THREE.Points(vertsGeo, mats.vertsMat);
    scene.add(objs.vertsObj);
}

/**
 * Changes visibility/opacity of base overlays based on the active selection mode.
 */
export function setDisplayMode(mode: DisplayMode, mats: OverlayMaterials, objs: OverlayObjects): void {
    const isVertex = mode === "vertex";

    // Edges always visible; stronger in edge mode, lighter in vertex mode
    if (objs.edgesObj) {
        objs.edgesObj.visible = true;
        mats.edgesMat.opacity = isVertex ? 0.35 : mode === "edge" ? 0.95 : 0.6;
    }

    // Vertices only visible in vertex mode
    if (objs.vertsObj) {
        objs.vertsObj.visible = isVertex;
    }
}

// --------------------
// Selection overlay API
// --------------------

/**
 * Disposes and removes all selection overlay objects.
 * Useful when swapping mesh geometry or clearing selection.
 */
export function clearSelectionOverlays(scene: THREE.Scene, objs: OverlayObjects): void {
    if (objs.selectedFacesObj) {
        scene.remove(objs.selectedFacesObj);
        objs.selectedFacesObj.geometry.dispose();
        objs.selectedFacesObj = undefined;
    }
    if (objs.selectedVertsObj) {
        scene.remove(objs.selectedVertsObj);
        objs.selectedVertsObj.geometry.dispose();
        objs.selectedVertsObj = undefined;
    }
    if (objs.selectedEdgesObj) {
        scene.remove(objs.selectedEdgesObj);
        objs.selectedEdgesObj.geometry.dispose();
        objs.selectedEdgesObj = undefined;
    }
}

/**
 * Helper: copy position/rotation/scale so overlays stay aligned
 * with the render mesh if it is moved/rotated/scaled.
 */
function matchTransform(dst: THREE.Object3D, src: THREE.Object3D): void {
    dst.position.copy(src.position);
    dst.quaternion.copy(src.quaternion);
    dst.scale.copy(src.scale);
}

/**
 * Highlights selected faces.
 *
 * KEY BEHAVIOR:
 * - We accept triIndicesByFaceId: Map<faceId, triangleIndices[]>
 * - This allows one core face (quad/ngon) to highlight fully
 *   even though render geometry is triangulated.
 */
export function setSelectedFaces(
    scene: THREE.Scene,
    meshObj: THREE.Mesh | undefined,
    faceIds: Iterable<Id>,
    triIndicesByFaceId: Map<Id, number[]>,
    mats: OverlayMaterials,
    objs: OverlayObjects
): void {
    // Dispose previous selection object
    if (objs.selectedFacesObj) {
        scene.remove(objs.selectedFacesObj);
        objs.selectedFacesObj.geometry.dispose();
        objs.selectedFacesObj = undefined;
    }

    if (!meshObj) return;

    const ids = Array.from(faceIds);
    if (ids.length === 0) return;

    const srcGeo = meshObj.geometry as THREE.BufferGeometry;
    const posAttr = srcGeo.getAttribute("position") as THREE.BufferAttribute;
    const indexAttr = srcGeo.getIndex();
    if (!indexAttr) return;

    // Count total triangles across all selected faces so we can preallocate exactly.
    let triCount = 0;
    for (const faceId of ids) {
        const tris = triIndicesByFaceId.get(faceId);
        if (tris) triCount += tris.length;
    }
    if (triCount === 0) return;

    // Each triangle contributes 3 vertices => 9 floats.
    const outPos = new Float32Array(triCount * 9);
    // Each triangle contributes 3 indices.
    const outIdx: number[] = new Array(triCount * 3);

    let vOut = 0; // float cursor in outPos
    let tOut = 0; // triangle cursor (0..triCount)

    for (const faceId of ids) {
        const tris = triIndicesByFaceId.get(faceId);
        if (!tris || tris.length === 0) continue;

        for (const tri of tris) {
            const i0 = indexAttr.getX(tri * 3 + 0);
            const i1 = indexAttr.getX(tri * 3 + 1);
            const i2 = indexAttr.getX(tri * 3 + 2);

            // Write three positions (unindexed output geometry)
            outPos[vOut + 0] = posAttr.getX(i0);
            outPos[vOut + 1] = posAttr.getY(i0);
            outPos[vOut + 2] = posAttr.getZ(i0);

            outPos[vOut + 3] = posAttr.getX(i1);
            outPos[vOut + 4] = posAttr.getY(i1);
            outPos[vOut + 5] = posAttr.getZ(i1);

            outPos[vOut + 6] = posAttr.getX(i2);
            outPos[vOut + 7] = posAttr.getY(i2);
            outPos[vOut + 8] = posAttr.getZ(i2);

            // Indices in the output geometry are just 0..N-1 (since we duplicated vertices)
            const base = (vOut / 3) | 0;
            outIdx[tOut * 3 + 0] = base + 0;
            outIdx[tOut * 3 + 1] = base + 1;
            outIdx[tOut * 3 + 2] = base + 2;

            vOut += 9;
            tOut += 1;
        }
    }

    if (tOut === 0) return;

    // vOut should equal outPos.length, but slice defensively anyway
    const finalPos = vOut === outPos.length ? outPos : outPos.slice(0, vOut);
    const finalIdx = tOut * 3 === outIdx.length ? outIdx : outIdx.slice(0, tOut * 3);

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));
    outGeo.setIndex(finalIdx);
    outGeo.computeVertexNormals();

    objs.selectedFacesObj = new THREE.Mesh(outGeo, mats.selectedFacesMat);
    matchTransform(objs.selectedFacesObj, meshObj);
    scene.add(objs.selectedFacesObj);
}

/**
 * Highlights selected vertices as larger points.
 */
export function setSelectedVertices(
    scene: THREE.Scene,
    meshObj: THREE.Mesh | undefined,
    vertexIds: Iterable<Id>,
    vertIndexById: Map<Id, number>,
    mats: OverlayMaterials,
    objs: OverlayObjects
): void {
    if (objs.selectedVertsObj) {
        scene.remove(objs.selectedVertsObj);
        objs.selectedVertsObj.geometry.dispose();
        objs.selectedVertsObj = undefined;
    }

    if (!meshObj) return;

    const ids = Array.from(vertexIds);
    if (ids.length === 0) return;

    const srcGeo = meshObj.geometry as THREE.BufferGeometry;
    const posAttr = srcGeo.getAttribute("position") as THREE.BufferAttribute;

    const outPos = new Float32Array(ids.length * 3);
    let wOut = 0;

    for (const vId of ids) {
        const vi = vertIndexById.get(vId);
        if (vi == null) continue;

        outPos[wOut + 0] = posAttr.getX(vi);
        outPos[wOut + 1] = posAttr.getY(vi);
        outPos[wOut + 2] = posAttr.getZ(vi);
        wOut += 3;
    }

    if (wOut === 0) return;

    const finalPos = wOut === outPos.length ? outPos : outPos.slice(0, wOut);

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));

    objs.selectedVertsObj = new THREE.Points(outGeo, mats.selectedVertsMat);
    matchTransform(objs.selectedVertsObj, meshObj);
    scene.add(objs.selectedVertsObj);
}

/**
 * Highlights selected edges as bright line segments.
 * edgeIds are expected to be strings shaped like "aId|bId".
 */
export function setSelectedEdges(
    scene: THREE.Scene,
    meshObj: THREE.Mesh | undefined,
    edgeIds: Iterable<Id>,
    vertIndexById: Map<Id, number>,
    mats: OverlayMaterials,
    objs: OverlayObjects
): void {
    if (objs.selectedEdgesObj) {
        scene.remove(objs.selectedEdgesObj);
        objs.selectedEdgesObj.geometry.dispose();
        objs.selectedEdgesObj = undefined;
    }

    if (!meshObj) return;

    const ids = Array.from(edgeIds);
    if (ids.length === 0) return;

    const srcGeo = meshObj.geometry as THREE.BufferGeometry;
    const posAttr = srcGeo.getAttribute("position") as THREE.BufferAttribute;

    // Each edge contributes 2 vertices = 6 floats
    const outPos = new Float32Array(ids.length * 6);
    let o = 0;

    for (const edgeId of ids) {
        const key = String(edgeId);
        const parts = key.split("|");
        if (parts.length !== 2) continue;

        const aId = parts[0] as unknown as Id;
        const bId = parts[1] as unknown as Id;

        const ia = vertIndexById.get(aId);
        const ib = vertIndexById.get(bId);
        if (ia == null || ib == null) continue;

        outPos[o + 0] = posAttr.getX(ia);
        outPos[o + 1] = posAttr.getY(ia);
        outPos[o + 2] = posAttr.getZ(ia);

        outPos[o + 3] = posAttr.getX(ib);
        outPos[o + 4] = posAttr.getY(ib);
        outPos[o + 5] = posAttr.getZ(ib);

        o += 6;
    }

    if (o === 0) return;

    const finalPos = o === outPos.length ? outPos : outPos.slice(0, o);

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));

    objs.selectedEdgesObj = new THREE.LineSegments(outGeo, mats.selectedEdgesMat);
    matchTransform(objs.selectedEdgesObj, meshObj);
    scene.add(objs.selectedEdgesObj);
}

// --------------------------------------
// Back-compat single-selection wrappers
// --------------------------------------

/**
 * Convenience wrapper: highlight a single faceId (or clear if null).
 */
export function setSelectedFace(
    scene: THREE.Scene,
    meshObj: THREE.Mesh | undefined,
    faceId: Id | null,
    triIndicesByFaceId: Map<Id, number[]>,
    mats: OverlayMaterials,
    objs: OverlayObjects
): void {
    setSelectedFaces(scene, meshObj, faceId ? [faceId] : [], triIndicesByFaceId, mats, objs);
}

/**
 * Convenience wrapper: highlight a single vertexId (or clear if null).
 */
export function setSelectedVertex(
    scene: THREE.Scene,
    meshObj: THREE.Mesh | undefined,
    vertexId: Id | null,
    vertIndexById: Map<Id, number>,
    mats: OverlayMaterials,
    objs: OverlayObjects
): void {
    setSelectedVertices(scene, meshObj, vertexId ? [vertexId] : [], vertIndexById, mats, objs);
}

/**
 * Convenience wrapper: highlight a single edgeId (or clear if null).
 */
export function setSelectedEdge(
    scene: THREE.Scene,
    meshObj: THREE.Mesh | undefined,
    edgeId: Id | null,
    vertIndexById: Map<Id, number>,
    mats: OverlayMaterials,
    objs: OverlayObjects
): void {
    setSelectedEdges(scene, meshObj, edgeId ? [edgeId] : [], vertIndexById, mats, objs);
}

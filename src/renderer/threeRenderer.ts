import * as THREE from "three";
import type { Mesh } from "../core/mesh";
import type { Id } from "../core/ids";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type PickHit =
  | {
      type: "face" | "edge" | "vertex";
      id: Id;
      depth: number;
      worldPos: { x: number; y: number; z: number };
    }
  | null;

export class ThreeRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  private controls: OrbitControls;

  private meshObj?: THREE.Mesh;
  private backfaceObj?: THREE.Mesh;
  private raycaster = new THREE.Raycaster();

  // Stable-ID bridges
  private triToFaceId: Id[] = [];
  private indexToVertId: Id[] = [];

  // Fast lookups
  private triIndexByFaceId = new Map<Id, number>();
  private vertIndexById = new Map<Id, number>();

  // Cached unique undirected edges as "aId|bId"
  private edgeKeys: string[] = [];

  // Overlays
  private edgesObj?: THREE.LineSegments;
  private vertsObj?: THREE.Points;

  // Selection overlays (multi-select capable)
  private selectedFacesObj?: THREE.Mesh;
  private selectedVertsObj?: THREE.Points;
  private selectedEdgesObj?: THREE.LineSegments;

  // Materials (reused)
  private edgesMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.9 });
  private vertsMat = new THREE.PointsMaterial({
    size: 6, // pixels (sizeAttenuation: false)
    sizeAttenuation: false,
    color: 0x55aa88,
    depthTest: true,
  });

  private selectedFacesMat = new THREE.MeshStandardMaterial({
    color: 0x00ffaa,
    transparent: true,
    opacity: 0.55,
    side: THREE.DoubleSide,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  private selectedVertsMat = new THREE.PointsMaterial({
    size: 10,
    sizeAttenuation: false,
    color: 0x00ffaa,
    depthTest: true,
  });

  private selectedEdgesMat = new THREE.LineBasicMaterial({
    transparent: true,
    opacity: 1.0,
    color: 0xffcc00,
    depthTest: false,
  });

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);

    this.scene.background = new THREE.Color(0x1e1e1e);

    this.camera.position.set(1.5, 1.2, 1.5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Mouse button mapping
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
    };

    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;

    // NOTE: OrbitControls “keys” only affects keyboard panning/rotation, not modifier keys.
    // If you want Shift to be multi-select, avoid binding Shift to pan behavior.

    this.controls.target.set(0, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.18;
    this.controls.update();

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
    this.scene.add(new THREE.GridHelper(10, 10));

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  setDisplayMode(mode: "face" | "edge" | "vertex"): void {
    const isVertex = mode === "vertex";

    // Edges always visible; stronger in edge mode, lighter in vertex mode
    if (this.edgesObj) {
      this.edgesObj.visible = true;
      this.edgesMat.opacity = isVertex ? 0.35 : mode === "edge" ? 0.95 : 0.6;
      // no stray line here; opacity update is enough
    }

    // Vertices only visible in vertex mode
    if (this.vertsObj) {
      this.vertsObj.visible = isVertex;
    }

    // If you leave vertex mode, keep selectedVerts overlay if you want,
    // but if you prefer “only show selection for active mode”, uncomment:
    // if (!isVertex) this.setSelectedVertices([]);

    // If you leave edge mode, same idea:
    // if (mode !== "edge") this.setSelectedEdges([]);
  }

  setMesh(mesh: Mesh) {
    const verts = mesh.getVertices();
    const faces = mesh.getFaces();

    // Positions
    const pos = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => {
      pos[i * 3 + 0] = v.position.x;
      pos[i * 3 + 1] = v.position.y;
      pos[i * 3 + 2] = v.position.z;
    });

    this.indexToVertId = verts.map((v) => v.id);

    // Build vertIndexById
    this.vertIndexById.clear();
    for (let i = 0; i < this.indexToVertId.length; i++) {
      this.vertIndexById.set(this.indexToVertId[i], i);
    }

    // Indices (triangles)
    const idx = new Uint32Array(faces.length * 3);
    this.triToFaceId = new Array<Id>(faces.length);
    this.triIndexByFaceId.clear();

    faces.forEach((f, tri) => {
      idx[tri * 3 + 0] = mesh.getVertexIndex(f.verts[0]);
      idx[tri * 3 + 1] = mesh.getVertexIndex(f.verts[1]);
      idx[tri * 3 + 2] = mesh.getVertexIndex(f.verts[2]);

      this.triToFaceId[tri] = f.id;
      this.triIndexByFaceId.set(f.id, tri);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();

    // Build edge cache ONCE per mesh
    this.edgeKeys = this.buildEdgeKeys(geo);

    // --- Edges overlay ---
    if (this.edgesObj) {
      this.scene.remove(this.edgesObj);
      this.edgesObj.geometry.dispose();
      this.edgesObj = undefined;
    }
    const edgesGeo = new THREE.EdgesGeometry(geo, 1);
    this.edgesObj = new THREE.LineSegments(edgesGeo, this.edgesMat);
    this.scene.add(this.edgesObj);

    // --- Vertex overlay (Points) ---
    if (this.vertsObj) {
      this.scene.remove(this.vertsObj);
      this.vertsObj.geometry.dispose();
      this.vertsObj = undefined;
    }
    const vertsGeo = new THREE.BufferGeometry();
    vertsGeo.setAttribute("position", geo.getAttribute("position")); // shares attribute
    this.vertsObj = new THREE.Points(vertsGeo, this.vertsMat);
    this.scene.add(this.vertsObj);

    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });

    const backMat = new THREE.MeshBasicMaterial({
      color: 0x55aa88,
      transparent: true,
      opacity: 0.5,
      side: THREE.BackSide,
      depthWrite: false,
    });

    // Replace existing objects (IMPORTANT: geo is shared between meshObj/backfaceObj)
    if (this.meshObj || this.backfaceObj) {
      // Remove old selection overlays (they reference old geometry)
      this.setSelectedFaces([]);
      this.setSelectedVertices([]);
      this.setSelectedEdges([]);

      if (this.backfaceObj) {
        this.scene.remove(this.backfaceObj);
        // do NOT dispose geometry here (shared)
        (this.backfaceObj.material as THREE.Material).dispose();
        this.backfaceObj = undefined;
      }

      if (this.meshObj) {
        this.scene.remove(this.meshObj);
        // dispose geometry ONCE here
        this.meshObj.geometry.dispose();
        (this.meshObj.material as THREE.Material).dispose();
        this.meshObj = undefined;
      }
    }

    this.meshObj = new THREE.Mesh(geo, mat);
    this.scene.add(this.meshObj);

    this.backfaceObj = new THREE.Mesh(geo, backMat);
    this.scene.add(this.backfaceObj);

    // Default visuals
    this.setDisplayMode("face");
  }

  /**
   * ndcX/ndcY are normalized device coordinates in [-1, 1]
   */
  pick(ndcX: number, ndcY: number): PickHit {
    if (!this.meshObj) return null;

    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hits = this.raycaster.intersectObject(this.meshObj, false);
    if (hits.length === 0) return null;

    const h = hits[0];
    if (h.faceIndex == null) return null;

    const tri = h.faceIndex;
    const faceId = this.triToFaceId[tri];
    if (!faceId) return null;

    return {
      type: "face",
      id: faceId,
      depth: h.distance,
      worldPos: { x: h.point.x, y: h.point.y, z: h.point.z },
    };
  }

  pickLine(ndcX: number, ndcY: number, radiusPx: number): PickHit {
    if (!this.meshObj) return null;

    this.camera.updateMatrixWorld(true);
    this.meshObj.updateMatrixWorld(true);

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;

    // Renderer buffer size (accounts for devicePixelRatio)
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const dpr = this.renderer.getPixelRatio();
    const w = size.x * dpr;
    const h = size.y * dpr;

    // Mouse in pixel coords
    const mx = (ndcX * 0.5 + 0.5) * w;
    const my = (-ndcY * 0.5 + 0.5) * h;

    let bestKey: string | null = null;
    let bestD2 = radiusPx * radiusPx;

    const worldMat = this.meshObj.matrixWorld;
    const aWorld = new THREE.Vector3();
    const bWorld = new THREE.Vector3();
    const aNdc = new THREE.Vector3();
    const bNdc = new THREE.Vector3();
    const bestWorld = new THREE.Vector3();
    let bestDepth = Infinity;

    for (const key of this.edgeKeys) {
      const [aIdRaw, bIdRaw] = key.split("|");
      const aId = aIdRaw as unknown as Id;
      const bId = bIdRaw as unknown as Id;

      const ia = this.vertIndexById.get(aId);
      const ib = this.vertIndexById.get(bId);
      if (ia == null || ib == null) continue;

      // World endpoints
      aWorld
        .set(posAttr.getX(ia), posAttr.getY(ia), posAttr.getZ(ia))
        .applyMatrix4(worldMat);
      bWorld
        .set(posAttr.getX(ib), posAttr.getY(ib), posAttr.getZ(ib))
        .applyMatrix4(worldMat);

      // Project to NDC
      aNdc.copy(aWorld).project(this.camera);
      bNdc.copy(bWorld).project(this.camera);

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
        bestDepth = bestWorld.distanceTo(this.camera.position);
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

  pickVertex(ndcX: number, ndcY: number, radiusPx: number): PickHit {
    if (!this.meshObj) return null;

    this.camera.updateMatrixWorld(true);
    this.meshObj.updateMatrixWorld(true);

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute;

    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const dpr = this.renderer.getPixelRatio();
    const w = size.x * dpr;
    const h = size.y * dpr;

    let bestI = -1;
    let bestDist2 = radiusPx * radiusPx;
    const bestWorld = new THREE.Vector3();

    const worldMat = this.meshObj.matrixWorld;
    const tmpWorld = new THREE.Vector3();
    const projected = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      tmpWorld
        .set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i))
        .applyMatrix4(worldMat);

      projected.copy(tmpWorld).project(this.camera);

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

    const vId = this.indexToVertId[bestI];
    if (!vId) return null;

    return {
      type: "vertex",
      id: vId,
      depth: bestWorld.distanceTo(this.camera.position),
      worldPos: { x: bestWorld.x, y: bestWorld.y, z: bestWorld.z },
    };
  }

  getViewportSizePx(): { w: number; h: number; dpr: number } {
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    const dpr = this.renderer.getPixelRatio();
    return { w: size.x * dpr, h: size.y * dpr, dpr };
  }

  getCanvasRectCssPx(): DOMRect {
    return this.renderer.domElement.getBoundingClientRect();
  }

  // -----------------------------
  // Multi-select selection visuals
  // -----------------------------

  setSelectedFaces(faceIds: Iterable<Id>): void {
    if (this.selectedFacesObj) {
      this.scene.remove(this.selectedFacesObj);
      this.selectedFacesObj.geometry.dispose();
      this.selectedFacesObj = undefined;
    }

    if (!this.meshObj) return;

    const ids = Array.from(faceIds);
    if (ids.length === 0) return;

    const srcGeo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = srcGeo.getAttribute("position") as THREE.BufferAttribute;
    const indexAttr = srcGeo.getIndex();
    if (!indexAttr) return;

    // Build a single geometry containing all selected triangles
    const outPos = new Float32Array(ids.length * 9);
    const outIdx: number[] = new Array(ids.length * 3);

    let vOut = 0;
    for (let t = 0; t < ids.length; t++) {
      const faceId = ids[t];
      const tri = this.triIndexByFaceId.get(faceId);
      if (tri == null) continue;

      const i0 = indexAttr.getX(tri * 3 + 0);
      const i1 = indexAttr.getX(tri * 3 + 1);
      const i2 = indexAttr.getX(tri * 3 + 2);

      // write three vertices
      outPos[vOut + 0] = posAttr.getX(i0);
      outPos[vOut + 1] = posAttr.getY(i0);
      outPos[vOut + 2] = posAttr.getZ(i0);

      outPos[vOut + 3] = posAttr.getX(i1);
      outPos[vOut + 4] = posAttr.getY(i1);
      outPos[vOut + 5] = posAttr.getZ(i1);

      outPos[vOut + 6] = posAttr.getX(i2);
      outPos[vOut + 7] = posAttr.getY(i2);
      outPos[vOut + 8] = posAttr.getZ(i2);

      const base = (vOut / 3) | 0; // vertex index in this new geometry
      outIdx[t * 3 + 0] = base + 0;
      outIdx[t * 3 + 1] = base + 1;
      outIdx[t * 3 + 2] = base + 2;

      vOut += 9;
    }

    // If some ids were invalid, vOut may be less than full length
    const finalPos = vOut === outPos.length ? outPos : outPos.slice(0, vOut);

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));
    outGeo.setIndex(outIdx);
    outGeo.computeVertexNormals();

    this.selectedFacesObj = new THREE.Mesh(outGeo, this.selectedFacesMat);

    // Match transforms so selection stays aligned with future object transforms
    this.selectedFacesObj.position.copy(this.meshObj.position);
    this.selectedFacesObj.quaternion.copy(this.meshObj.quaternion);
    this.selectedFacesObj.scale.copy(this.meshObj.scale);

    this.scene.add(this.selectedFacesObj);
  }

  setSelectedVertices(vertexIds: Iterable<Id>): void {
    if (this.selectedVertsObj) {
      this.scene.remove(this.selectedVertsObj);
      this.selectedVertsObj.geometry.dispose();
      this.selectedVertsObj = undefined;
    }

    if (!this.meshObj) return;

    const ids = Array.from(vertexIds);
    if (ids.length === 0) return;

    const srcGeo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = srcGeo.getAttribute("position") as THREE.BufferAttribute;

    const outPos = new Float32Array(ids.length * 3);
    let wOut = 0;

    for (const vId of ids) {
      const vi = this.vertIndexById.get(vId);
      if (vi == null) continue;

      outPos[wOut + 0] = posAttr.getX(vi);
      outPos[wOut + 1] = posAttr.getY(vi);
      outPos[wOut + 2] = posAttr.getZ(vi);
      wOut += 3;
    }

    const finalPos = wOut === outPos.length ? outPos : outPos.slice(0, wOut);

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));

    this.selectedVertsObj = new THREE.Points(outGeo, this.selectedVertsMat);

    this.selectedVertsObj.position.copy(this.meshObj.position);
    this.selectedVertsObj.quaternion.copy(this.meshObj.quaternion);
    this.selectedVertsObj.scale.copy(this.meshObj.scale);

    this.scene.add(this.selectedVertsObj);
  }

  setSelectedEdges(edgeIds: Iterable<Id>): void {
    if (this.selectedEdgesObj) {
      this.scene.remove(this.selectedEdgesObj);
      this.selectedEdgesObj.geometry.dispose();
      this.selectedEdgesObj = undefined;
    }

    if (!this.meshObj) return;

    const ids = Array.from(edgeIds);
    if (ids.length === 0) return;

    const srcGeo = this.meshObj.geometry as THREE.BufferGeometry;
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

      const ia = this.vertIndexById.get(aId);
      const ib = this.vertIndexById.get(bId);
      if (ia == null || ib == null) continue;

      outPos[o + 0] = posAttr.getX(ia);
      outPos[o + 1] = posAttr.getY(ia);
      outPos[o + 2] = posAttr.getZ(ia);

      outPos[o + 3] = posAttr.getX(ib);
      outPos[o + 4] = posAttr.getY(ib);
      outPos[o + 5] = posAttr.getZ(ib);

      o += 6;
    }

    const finalPos = o === outPos.length ? outPos : outPos.slice(0, o);

    const outGeo = new THREE.BufferGeometry();
    outGeo.setAttribute("position", new THREE.BufferAttribute(finalPos, 3));

    this.selectedEdgesObj = new THREE.LineSegments(outGeo, this.selectedEdgesMat);

    this.selectedEdgesObj.position.copy(this.meshObj.position);
    this.selectedEdgesObj.quaternion.copy(this.meshObj.quaternion);
    this.selectedEdgesObj.scale.copy(this.meshObj.scale);

    this.scene.add(this.selectedEdgesObj);
  }

  // Backwards compatible single-selection wrappers:
  setSelectedFace(faceId: Id | null): void {
    this.setSelectedFaces(faceId ? [faceId] : []);
  }

  setSelectedVertex(vertexId: Id | null): void {
    this.setSelectedVertices(vertexId ? [vertexId] : []);
  }

  setSelectedEdge(edgeId: Id | null): void {
    this.setSelectedEdges(edgeId ? [edgeId] : []);
  }

  start() {
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildEdgeKeys(geo: THREE.BufferGeometry): string[] {
    const indexAttr = geo.getIndex();
    if (!indexAttr) return [];

    const edgeSet = new Set<string>();

    const addEdge = (ia: number, ib: number) => {
      const aId = this.indexToVertId[ia];
      const bId = this.indexToVertId[ib];
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
}

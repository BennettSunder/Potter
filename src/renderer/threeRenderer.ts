// src/renderer/threeRenderer.ts
//
// ThreeRenderer is the “orchestrator” for the renderer layer.
// It owns the Three.js scene/camera, builds render geometry from the core Mesh,
// and delegates specific jobs to small modules:
//
// - picking.ts   : raycasting + screen-space picking (face/edge/vertex)
// - overlays.ts  : edges/verts overlays + selection highlight geometry
// - gizmos.ts    : transform gizmo visuals + drag delta math (no core mutation)
//
// IMPORTANT: Renderer never mutates the core Mesh directly.
// It only visualizes core state and returns pick hits / drag deltas.
// (We temporarily apply gizmo moves to meshObj position for MVP visuals;
// later this becomes a Command that updates core transforms.)

import * as THREE from "three";
import type { Mesh } from "../core/mesh";
import type { Id } from "../core/ids/ids";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SelectionMode } from "../core/selection/selection";


import {
  type PickHit,
  // pickFace,
  // pickEdge,
  // pickVertex,
  // buildEdgeKeys,
  // buildEdgeKeysFromFaces,
  getViewportSizePx,
  getCanvasRectCssPx,
} from "./picking";

import {
  type OverlayMaterials,
  type OverlayObjects,
  type DisplayMode,
  createDefaultOverlayMaterials,
  rebuildBaseOverlays,
  setDisplayMode,
  clearSelectionOverlays,
  setSelectedFaces,
  setSelectedVertices,
  setSelectedEdges,
  setSelectedFace,
  setSelectedVertex,
  setSelectedEdge,
} from "./overlays";

import { TransformGizmos, type GizmoDragEvent } from "./gizmos";

export class ThreeRenderer {
  // -----------------------------
  // Three.js "engine" primitives
  // -----------------------------
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.01, 100);
  private controls: OrbitControls;

  // The main visible mesh and a backface visualization mesh.
  // (Both share the same BufferGeometry.)
  private meshObj?: THREE.Mesh;
  private backfaceObj?: THREE.Mesh;

  // Shared raycaster used by face picking; edge/vertex picking is screen-space.
  private raycaster = new THREE.Raycaster();

  // -----------------------------------------
  // Stable-ID bridges (core IDs -> render data)
  // -----------------------------------------
  //
  // triToFaceId:
  //   Render geometry is always triangles.
  //   Even when a core face is a quad/ngon, we triangulate it.
  //   Each output triangle index maps back to the "core faceId" here.
  private triToFaceId: Id[] = [];

  // indexToVertId:
  //   Render vertices are in an array; selection uses stable vertex IDs.
  //   This maps render position index -> vertexId.
  private indexToVertId: Id[] = [];

  // ----------------
  // Fast lookup maps
  // ----------------
  //
  // triIndexByFaceId:
  //   Representative triangle index for a given faceId (useful sometimes).
  //   NOTE: for polygon faces, a face generates multiple triangles.
  private triIndexByFaceId = new Map<Id, number>();

  // triIndicesByFaceId:
  //   Full list of triangle indices for a given faceId.
  //   This is what lets selection overlays highlight the *entire* face.
  private triIndicesByFaceId = new Map<Id, number[]>();

  // vertIndexById:
  //   vertexId -> render position index
  private vertIndexById = new Map<Id, number>();


  private vertexPoints: THREE.Points | null = null;
  private edgeLines: THREE.LineSegments | null = null;

  private indexToVertexId: Id[] = [];
  private segmentToEdgeId: Id[] = [];

  // --------------------------
  // Cached edges for edge mode
  // --------------------------
  //
  // Unique undirected edges as "aId|bId"
  // Used by screen-space edge picking and edge selection overlay.
  // private edgeKeys: string[] = [];

  // ----------------
  // Overlay subsystem
  // ----------------
  //
  // Base overlays: edges + verts.
  // Selection overlays: selected faces/edges/verts highlights.
  private overlayMats: OverlayMaterials = createDefaultOverlayMaterials();
  private overlayObjs: OverlayObjects = {};

  // ------------
  // Gizmo system
  // ------------
  //
  // Gizmo emits deltas; renderer may apply them visually for MVP.
  // The app can subscribe to deltas to convert into Commands later.
  private gizmos: TransformGizmos;
  private gizmoActive = false;
  private onGizmoDragCb?: (e: GizmoDragEvent) => void;

  constructor(canvas: HTMLCanvasElement) {
    // --- Renderer setup ---
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.background = new THREE.Color(0x1e1e1e);

    // --- Camera / controls ---
    this.camera.position.set(1.5, 1.2, 1.5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    // Mouse mapping: we intentionally disable left-click rotation
    // so left-click can be used for selection/dragging tools.
    this.controls.mouseButtons = {
      LEFT: null as unknown as THREE.MOUSE,
      MIDDLE: THREE.MOUSE.ROTATE,
    };

    this.controls.enablePan = true;
    this.controls.enableRotate = true;
    this.controls.enableZoom = true;

    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.18;
    this.controls.target.set(0, 0, 0);
    this.controls.update();

    // --- Scene helpers ---
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1));
    this.scene.add(new THREE.GridHelper(10, 10));

    // --- Gizmo setup (translate-only for now) ---
    // NOTE: this is VISUAL-ONLY movement right now: we move meshObj position.
    // Later: appShell converts drag into a Command that updates core transforms.
    this.gizmos = new TransformGizmos(this.scene, this.camera, {
      onDrag: (e) => {
        if (this.meshObj && this.gizmoActive) {
          this.meshObj.position.add(e.deltaWorldStep);
          this.syncAllObjectTransformsToMesh();
          this.gizmos.update();
        }
        this.onGizmoDragCb?.(e);
      },
    });

    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  // -----------------
  // Public API
  // -----------------

  /**
   * Controls how base overlays look:
   * - face mode: edges visible but subtle
   * - edge mode: edges strong
   * - vertex mode: edges faint + vertex points visible
   */
  setDisplayMode(mode: DisplayMode): void {
    setDisplayMode(mode, this.overlayMats, this.overlayObjs);
  }


  /**
   * Exposes the camera to allow for other parts of the app
   * to use it and its properties
   */
  getCamera() {
    return this.camera;
  }


  /**
   * Turn gizmo visibility on/off.
   * Typical usage: enable when something is selected.
   */
  setGizmoActive(active: boolean): void {
    this.gizmoActive = active;

    if (!active) {
      this.gizmos.detach();
      return;
    }

    // Attach to current render object (for now we only have one object)
    this.gizmos.attach(this.meshObj ?? null);
  }

  /**
   * Subscribe to gizmo deltas.
   * Use this to convert drag movement into undoable Commands later.
   */
  onGizmoDrag(cb: ((e: GizmoDragEvent) => void) | undefined): void {
    this.onGizmoDragCb = cb;
  }

  /**
   * Pointer input pipeline:
   * Call this on pointerdown BEFORE doing selection picks.
   * Returns true if gizmo "captured" the drag, meaning
   * you should NOT perform normal selection picking.
   */
  gizmoPointerDown(ndcX: number, ndcY: number): boolean {
    if (!this.gizmoActive) return false;
    if (this.meshObj) this.gizmos.attach(this.meshObj);
    return this.gizmos.beginDrag(ndcX, ndcY);
  }

  /** Call this on pointermove while dragging. */
  gizmoPointerMove(ndcX: number, ndcY: number): void {
    if (!this.gizmoActive) return;
    this.gizmos.updateDrag(ndcX, ndcY);
  }

  /** Call this on pointerup. */
  gizmoPointerUp(): void {
    if (!this.gizmoActive) return;
    this.gizmos.endDrag();
  }

  /**
   * Convert core Mesh -> render buffers + overlays.
   *
   * BIG IDEA:
   * - Core faces are polygons (3..N vertex IDs).
   * - Renderer always needs triangles -> we triangulate per face.
   * - Every output triangle maps back to the originating faceId
   *   so picking returns the whole face identity, not a single tri.
   */
  setMesh(mesh: Mesh): void {
    const verts = mesh.getVertices();
    const faces = mesh.getFaces();

    // -----------------
    // 1) Vertex buffers
    // -----------------
    const pos = new Float32Array(verts.length * 3);
    verts.forEach((v, i) => {
      pos[i * 3 + 0] = v.position.x;
      pos[i * 3 + 1] = v.position.y;
      pos[i * 3 + 2] = v.position.z;
    });

    // Stable ID bridge: render index -> vertexId
    this.indexToVertId = verts.map((v) => v.id);

    // Fast lookup: vertexId -> render index
    this.vertIndexById.clear();
    this.indexToVertId.forEach((id, i) => this.vertIndexById.set(id, i));

    // -----------------------
    // 2) Index buffer (tris)
    // -----------------------
    //
    // Triangulate polygon faces with a fan:
    //  (v0, v1, v2), (v0, v2, v3), ...
    //
    // Assumes convex + consistent winding (fine for cube / early ops).

    this.triToFaceId = [];
    this.triIndexByFaceId.clear();
    this.triIndicesByFaceId.clear();

    const idx: number[] = [];
    let triOut = 0;

    for (const f of faces) {
      if (f.verts.length < 3) continue;

      // Convert face vertex IDs -> render indices (IMPORTANT: use renderer's map)
      const vidx: number[] = [];
      for (const vId of f.verts) {
        const ri = this.vertIndexById.get(vId);
        if (ri === undefined) {
          // Face references a missing vertex (shouldn't happen in MVP); skip this face
          vidx.length = 0;
          break;
        }
        vidx.push(ri);
      }
      if (vidx.length < 3) continue;

      const faceTriIndices: number[] = [];

      for (let i = 1; i + 1 < vidx.length; i++) {
        const i0 = vidx[0];
        const i1 = vidx[i];
        const i2 = vidx[i + 1];

        idx.push(i0, i1, i2);

        // triangle index -> faceId mapping (critical for face picking)
        this.triToFaceId[triOut] = f.id;
        faceTriIndices.push(triOut);

        triOut++;
      }

      if (faceTriIndices.length > 0) {
        // Representative tri (kept for back-compat / convenience)
        this.triIndexByFaceId.set(f.id, faceTriIndices[0]);

        // Full list (used by selection overlay to highlight whole face)
        this.triIndicesByFaceId.set(f.id, faceTriIndices);
      }
    }

    // Use 32-bit indices only when needed
    const IndexArray = verts.length > 65535 ? Uint32Array : Uint16Array;
    const idxTyped = new IndexArray(idx);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex(new THREE.BufferAttribute(idxTyped, 1));
    geo.computeVertexNormals();
    geo.computeBoundingSphere(); // helps raycasting + culling

    // -----------------------------
    // 3) Tear down old render state
    // -----------------------------
    clearSelectionOverlays(this.scene, this.overlayObjs);

    // Dispose old pick helpers (if present)
    if (this.vertexPoints) {
      this.scene.remove(this.vertexPoints);
      this.vertexPoints.geometry.dispose();
      (this.vertexPoints.material as THREE.Material).dispose();
      this.vertexPoints = null;
    }
    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      (this.edgeLines.material as THREE.Material).dispose();
      this.edgeLines = null;
    }

    if (this.backfaceObj) {
      this.scene.remove(this.backfaceObj);
      (this.backfaceObj.material as THREE.Material).dispose();
      this.backfaceObj = undefined;
    }

    if (this.meshObj) {
      this.scene.remove(this.meshObj);
      // geometry is shared with backface; dispose ONCE here
      this.meshObj.geometry.dispose();
      (this.meshObj.material as THREE.Material).dispose();
      this.meshObj = undefined;
    }

    // ----------------
    // 4) Main mesh objs
    // ----------------
    const mat = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    this.meshObj = new THREE.Mesh(geo, mat);
    this.scene.add(this.meshObj);

    const backMat = new THREE.MeshBasicMaterial({
      color: 0x55aa88,
      transparent: true,
      opacity: 0.5,
      side: THREE.BackSide,
      depthWrite: false,
    });

    this.backfaceObj = new THREE.Mesh(geo, backMat);
    this.scene.add(this.backfaceObj);

    // ----------------
    // 5) Base overlays
    // ----------------
    rebuildBaseOverlays(this.scene, geo, this.overlayMats, this.overlayObjs);
    this.syncAllObjectTransformsToMesh();

    // Reattach gizmo if it's active
    if (this.gizmoActive) this.gizmos.attach(this.meshObj);

    // IMPORTANT: do NOT force display mode here.
    // setMesh() can be called during drag/preview; forcing "face" breaks edge/vertex mode.
    // Whatever code manages mode (main.ts) should call setDisplayMode(mode) once.

    // Build pick helpers AFTER mesh objects are replaced
    this.buildVertexPoints(mesh);
    this.buildEdgeLines(mesh);
  }


  // -----------------------
  // Picking (selection input)
  // -----------------------

  /** Face picking: raycast -> triangle index -> faceId via triToFaceId */
  /** Unified picking: vertex/edge via helper objects, face via main mesh triangles */
  pick(ndcX: number, ndcY: number, mode: SelectionMode): PickHit | null {
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY } as any, this.camera);

    // ---------- Vertex ----------
    if (mode === "vertex" && this.vertexPoints) {
      // threshold is in WORLD units for Points raycast
      this.raycaster.params.Points = this.raycaster.params.Points ?? { threshold: 0.1 };
      this.raycaster.params.Points.threshold = 0.1;

      const hits = this.raycaster.intersectObject(this.vertexPoints, false);
      const h = hits[0];
      if (h) {
        const idx = (h as any).index as number | undefined;
        if (idx != null) {
          const vid = this.indexToVertexId[idx];
          if (vid) return { type: "vertex", id: vid, depth: h.distance, worldPos: h.point };
        }
      }
      return null;
    }

    // ---------- Edge ----------
    if (mode === "edge" && this.edgeLines) {
      // threshold is in WORLD units for Line raycast
      this.raycaster.params.Line = this.raycaster.params.Line ?? { threshold: 0.1 };
      this.raycaster.params.Line.threshold = 0.1;

      const hits = this.raycaster.intersectObject(this.edgeLines, false);
      const h = hits[0];
      if (h) {
        // For LineSegments, Three returns .index as a vertex index into the line geometry
        const lineVertIndex = (h as any).index as number | undefined;
        if (lineVertIndex != null) {
          const segmentIndex = Math.floor(lineVertIndex / 2);
          const eid = this.segmentToEdgeId[segmentIndex];
          if (eid) return { type: "edge", id: eid, depth: h.distance, worldPos: h.point };
        }
      }
      return null;
    }

    // ---------- Face ----------
    if (!this.meshObj) return null;

    const hits = this.raycaster.intersectObject(this.meshObj, false);
    const h = hits[0];
    if (!h) return null;

    // Three provides triangle index for BufferGeometry meshes
    const triIndex = (h as any).faceIndex as number | undefined;
    if (triIndex == null) return null;

    const faceId = this.triToFaceId[triIndex];
    if (!faceId) return null;

    return { type: "face", id: faceId, depth: h.distance, worldPos: h.point };
  }



  // /** Edge picking: screen-space distance-to-segment against cached edges */
  // pickLine(ndcX: number, ndcY: number, radiusPx: number): PickHit {
  //   return pickEdge(
  //     {
  //       renderer: this.renderer,
  //       camera: this.camera,
  //       raycaster: this.raycaster,
  //       meshObj: this.meshObj,
  //       triToFaceId: this.triToFaceId,
  //       indexToVertId: this.indexToVertId,
  //       vertIndexById: this.vertIndexById,
  //       edgeKeys: this.edgeKeys,
  //     },
  //     ndcX,
  //     ndcY,
  //     radiusPx
  //   );
  // }

  // /** Vertex picking: screen-space nearest point within radius */
  // pickVertex(ndcX: number, ndcY: number, radiusPx: number): PickHit {
  //   return pickVertex(
  //     {
  //       renderer: this.renderer,
  //       camera: this.camera,
  //       raycaster: this.raycaster,
  //       meshObj: this.meshObj,
  //       triToFaceId: this.triToFaceId,
  //       indexToVertId: this.indexToVertId,
  //       vertIndexById: this.vertIndexById,
  //       edgeKeys: this.edgeKeys,
  //     },
  //     ndcX,
  //     ndcY,
  //     radiusPx
  //   );
  // }



  private buildVertexPoints(mesh: Mesh) {
    const verts = mesh.getVertices();

    const pos = new Float32Array(verts.length * 3);
    this.indexToVertexId = new Array<Id>(verts.length);

    for (let i = 0; i < verts.length; i++) {
      const v = verts[i]!;
      pos[i * 3 + 0] = v.position.x;
      pos[i * 3 + 1] = v.position.y;
      pos[i * 3 + 2] = v.position.z;
      this.indexToVertexId[i] = v.id;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.PointsMaterial({
      size: 8,              // screen-space-ish; tweak
      sizeAttenuation: false,
      depthTest: true,
      transparent: true,
      opacity: 0.0,         // invisible but still raycastable
    });

    if (this.vertexPoints) {
      this.scene.remove(this.vertexPoints);
      this.vertexPoints.geometry.dispose();
      (this.vertexPoints.material as THREE.Material).dispose();
    }

    this.vertexPoints = new THREE.Points(geo, mat);
    this.vertexPoints.frustumCulled = false;
    this.scene.add(this.vertexPoints);
  }

  private buildEdgeLines(mesh: Mesh) {
    const edges = mesh.getEdges();

    const pos = new Float32Array(edges.length * 2 * 3);
    this.segmentToEdgeId = new Array<Id>(edges.length);

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      const a = mesh.getVertexPosition(e.a);
      const b = mesh.getVertexPosition(e.b);

      // segment i occupies vertices (2*i) and (2*i+1)
      const base = i * 6;
      pos[base + 0] = a.x;
      pos[base + 1] = a.y;
      pos[base + 2] = a.z;
      pos[base + 3] = b.x;
      pos[base + 4] = b.y;
      pos[base + 5] = b.z;

      this.segmentToEdgeId[i] = e.id;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

    const mat = new THREE.LineBasicMaterial({
      transparent: true,
      opacity: 0.0,   // invisible but raycastable
      depthTest: true,
    });

    if (this.edgeLines) {
      this.scene.remove(this.edgeLines);
      this.edgeLines.geometry.dispose();
      (this.edgeLines.material as THREE.Material).dispose();
    }

    this.edgeLines = new THREE.LineSegments(geo, mat);
    this.edgeLines.frustumCulled = false;
    this.scene.add(this.edgeLines);
  }


  // ---------------------------------------
  // Selection visualization (highlighting)
  // ---------------------------------------

  /**
   * Highlight selected faces.
   * IMPORTANT: we pass triIndicesByFaceId so each polygon highlights fully.
   *
   * NOTE: This requires overlays.ts to accept Map<Id, number[]> (not Map<Id, number>).
   */
  setSelectedFaces(ids: Iterable<Id>): void {
    setSelectedFaces(
      this.scene,
      this.meshObj,
      ids,
      this.triIndicesByFaceId,
      this.overlayMats,
      this.overlayObjs
    );
    this.syncAllObjectTransformsToMesh();
  }

  /** Highlight selected vertices (points) */
  setSelectedVertices(ids: Iterable<Id>): void {
    setSelectedVertices(
      this.scene,
      this.meshObj,
      ids,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.syncAllObjectTransformsToMesh();
  }

  /** Highlight selected edges (line segments) */
  setSelectedEdges(ids: Iterable<Id>): void {
    setSelectedEdges(
      this.scene,
      this.meshObj,
      ids,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.syncAllObjectTransformsToMesh();
  }

  // ----------------------------
  // Back-compat single wrappers
  // ----------------------------

  setSelectedFace(id: Id | null): void {
    setSelectedFace(
      this.scene,
      this.meshObj,
      id,
      this.triIndicesByFaceId,
      this.overlayMats,
      this.overlayObjs
    );
    this.syncAllObjectTransformsToMesh();
  }

  setSelectedVertex(id: Id | null): void {
    setSelectedVertex(
      this.scene,
      this.meshObj,
      id,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.syncAllObjectTransformsToMesh();
  }

  setSelectedEdge(id: Id | null): void {
    setSelectedEdge(
      this.scene,
      this.meshObj,
      id,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.syncAllObjectTransformsToMesh();
  }

  // -----------------
  // Utility accessors
  // -----------------

  /** Renderer viewport size in *device pixels* (CSS px * dpr) */
  getViewportSizePx() {
    return getViewportSizePx(this.renderer);
  }

  /** Canvas rect in *CSS pixels* (useful to convert mouse coords -> NDC) */
  getCanvasRectCssPx() {
    return getCanvasRectCssPx(this.renderer);
  }

  // --------------
  // Render loop
  // --------------

  start(): void {
    const loop = () => {
      this.controls.update();
      this.gizmos.update(); // keep gizmo snapped + sized to screen
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  // -------------------------
  // Internal: resize handling
  // -------------------------
  private resize(): void {
    const w = this.renderer.domElement.clientWidth || window.innerWidth;
    const h = this.renderer.domElement.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------
  // Internal: keep overlays aligned to mesh transforms
  // ---------------------------------------------------
  //
  // Because overlays are separate objects, they don't automatically inherit transforms.
  // Minimal MVP approach: copy meshObj transform into everything.
  // Later improvement: put meshObj + overlays under a single parent group.
  private syncAllObjectTransformsToMesh(): void {
    if (!this.meshObj) return;

    const src = this.meshObj;

    const sync = (o?: THREE.Object3D) => {
      if (!o) return;
      o.position.copy(src.position);
      o.quaternion.copy(src.quaternion);
      o.scale.copy(src.scale);
    };

    sync(this.backfaceObj);
    sync(this.overlayObjs.edgesObj);
    sync(this.overlayObjs.vertsObj);
    sync(this.overlayObjs.selectedFacesObj);
    sync(this.overlayObjs.selectedVertsObj);
    sync(this.overlayObjs.selectedEdgesObj);
  }
}


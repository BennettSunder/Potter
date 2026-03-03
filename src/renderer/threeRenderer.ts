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

import { TransformGizmos, type GizmoDragEvent, type GizmoInteractionResult, type GizmoMode } from "./gizmos";

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
  private gizmoAnchor = new THREE.Object3D();
  private extrudeArrow: THREE.ArrowHelper | null = null;
  private extrudeArrowPickObjects: THREE.Object3D[] = [];
  private extrudeArrowShaftCollider: THREE.Mesh | null = null;
  private extrudeArrowHeadCollider: THREE.Mesh | null = null;

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
  private vertIndicesById = new Map<Id, number[]>();


  private vertexPoints: THREE.Points | null = null;
  private edgeLines: THREE.LineSegments | null = null;

  private indexToVertexId: Id[] = [];
  private segmentToEdgeId: Id[] = [];
  private segmentToVertIndices: Array<[number, number]> = [];
  private faceVertexIdsByFaceId = new Map<Id, Id[]>();
  private edgeVertexIdsByEdgeId = new Map<Id, [Id, Id]>();

  private selectedFaceIds = new Set<Id>();
  private selectedEdgeIds = new Set<Id>();
  private selectedVertexIds = new Set<Id>();

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

  // -------------------------
  // Vertex position preview
  // -------------------------
  //
  // Used for "drag preview" without touching core mesh:
  // - begin: snapshot baseline positions + which render indices to move
  // - apply: write into BufferAttribute.position in-place
  // - end: restore baseline (if cancel) or clear state (if commit)
  private vertexPreview = {
    active: false,
    indices: [] as number[],              // render indices to modify
    basePos: null as Float32Array | null, // snapshot of position buffer
  };

  // ----------------------
  // Render pump
  // ----------------------
  //
  // Primary mode is continuous rendering after start().
  // requestRender() is retained as a pre-start fallback for initial frames.
  private running = false;
  private renderPending = false;

  private renderFrame(): void {
    // Ensure camera matrices / controls are up-to-date
    this.controls.update();
    this.camera.updateMatrixWorld(true);

    this.gizmos.update(); // keep gizmo snapped/sized correctly
    this.renderer.render(this.scene, this.camera);
  }

  public requestRender(): void {
    if (this.running) return;
    if (this.renderPending) return;
    this.renderPending = true;

    requestAnimationFrame(() => {
      this.renderPending = false;
      this.renderFrame();
    });
  }


  // ------------
  // Gizmo system
  // ------------
  //
  // Gizmo emits deltas; renderer may apply them visually for MVP.
  // The app can subscribe to deltas to convert into Commands later.
  private gizmos: TransformGizmos;
  private gizmoActive = false;
  private gizmoMode: GizmoMode = "translate";
  private onGizmoDragCb?: (e: GizmoDragEvent) => void;
  private onGizmoModalTriggerCb?: (e: { mode: GizmoMode }) => void;

  constructor(canvas: HTMLCanvasElement) {
    // --- Renderer setup ---
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.background = new THREE.Color(0x1e1e1e);

    // --- Camera / controls ---
    this.camera.position.set(1.5, 1.2, 1.5);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    this.controls.addEventListener("change", () => this.requestRender());

    // Mouse mapping: we intentionally disable left-click rotation
    // during normal interaction; ui/bindings.ts blocks standard left clicks
    // and only lets them through for explicit camera-drag modifiers.
    this.controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
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
    this.scene.add(this.gizmoAnchor);
    this.gizmos = new TransformGizmos(this.scene, this.camera, {
      onDrag: (e) => this.onGizmoDragCb?.(e),
      onModalTrigger: (e) => this.onGizmoModalTriggerCb?.(e),
    });
    this.gizmos.setMode(this.gizmoMode);

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.requestRender(); // render the first frame
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
    this.requestRender();
  }

  /**
   * Begin an in-place preview of vertex movement.
   * This snapshots the current render geometry positions.
   *
   * Call on pointerdown when starting a vertex/edge/face drag (preview).
   */
  beginVertexPositionPreview(vertexIds: Id[]): void {
    if (!this.meshObj) return;

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const arr = posAttr.array as Float32Array;

    // Convert core vertex IDs -> render indices using vertIndexById
    const indices: number[] = [];
    const seen = new Set<number>();
    for (const id of vertexIds) {
      const renderIndices = this.vertIndicesById.get(id);
      if (!renderIndices) continue;
      for (const ri of renderIndices) {
        if (seen.has(ri)) continue;
        seen.add(ri);
        indices.push(ri);
      }
    }

    // Snapshot baseline positions so preview is reversible and stable
    this.vertexPreview.active = true;
    this.vertexPreview.indices = indices;
    this.vertexPreview.basePos = new Float32Array(arr); // clone baseline
  }

  /**
   * Apply a world-space delta to the preview vertices by editing the GPU buffer in-place.
   * Call on pointermove while dragging.
   */
  applyVertexPositionPreview(delta: { x: number; y: number; z: number }): void {
    if (!this.vertexPreview.active || !this.meshObj || !this.vertexPreview.basePos) return;

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const arr = posAttr.array as Float32Array;
    const base = this.vertexPreview.basePos;

    for (const i of this.vertexPreview.indices) {
      arr[i * 3 + 0] = base[i * 3 + 0] + delta.x;
      arr[i * 3 + 1] = base[i * 3 + 1] + delta.y;
      arr[i * 3 + 2] = base[i * 3 + 2] + delta.z;
    }

    posAttr.needsUpdate = true;

    // Keep raycasting/bounds sane during preview
    geo.computeBoundingSphere();

    // OPTIONAL: if you want lighting to look correct during drag, uncomment
    // geo.computeVertexNormals();

    this.syncPreviewHelpersAndOverlays();

    this.requestRender();
  }

  /**
   * Apply explicit preview positions for a subset of vertices.
   * This is used by non-translation tools such as scale.
   */
  applyVertexPositionsPreview(positions: ReadonlyMap<Id, { x: number; y: number; z: number }>): void {
    if (!this.vertexPreview.active || !this.meshObj) return;

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return;

    const arr = posAttr.array as Float32Array;

    for (const [id, pos] of positions.entries()) {
      const renderIndices = this.vertIndicesById.get(id);
      if (!renderIndices) continue;
      for (const i of renderIndices) {
        arr[i * 3 + 0] = pos.x;
        arr[i * 3 + 1] = pos.y;
        arr[i * 3 + 2] = pos.z;
      }
    }

    posAttr.needsUpdate = true;
    geo.computeBoundingSphere();

    this.syncPreviewHelpersAndOverlays();
    this.requestRender();
  }

  /**
   * End the preview.
   * - commit=true: we assume the app will apply a Command to the core mesh and then call setMesh(mesh).
   * - commit=false: restore baseline render positions (cancel).
   */
  endVertexPositionPreview(opts: { commit: boolean }): void {
    if (!this.vertexPreview.active || !this.meshObj) {
      this.vertexPreview.active = false;
      this.vertexPreview.indices = [];
      this.vertexPreview.basePos = null;
      return;
    }

    if (!opts.commit && this.vertexPreview.basePos) {
      const geo = this.meshObj.geometry as THREE.BufferGeometry;
      const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;

      if (posAttr) {
        const arr = posAttr.array as Float32Array;
        arr.set(this.vertexPreview.basePos);
        posAttr.needsUpdate = true;
        geo.computeBoundingSphere();
      }
    }

    this.syncPreviewHelpersAndOverlays();

    this.vertexPreview.active = false;
    this.vertexPreview.indices = [];
    this.vertexPreview.basePos = null;

    this.requestRender();
  }



  /**
   * Exposes the camera to allow for other parts of the app
   * to use it and its properties
   */
  getCamera(): THREE.PerspectiveCamera {
    return this.camera;
  }

  forceCameraUpdate(): void {
    this.controls?.update?.();
    this.camera.updateMatrixWorld(true);
  }

  setLeftMouseCameraAction(action: THREE.MOUSE): void {
    this.controls.mouseButtons.LEFT = action;
  }

  setExtrudePreviewArrow(opts: {
    origin: { x: number; y: number; z: number };
    direction: { x: number; y: number; z: number };
    length: number;
  }): void {
    const dir = new THREE.Vector3(opts.direction.x, opts.direction.y, opts.direction.z);
    if (dir.lengthSq() < 1e-8) {
      this.clearExtrudePreviewArrow();
      return;
    }

    dir.normalize();
    const origin = new THREE.Vector3(opts.origin.x, opts.origin.y, opts.origin.z);
    const length = Math.max(0.001, opts.length);

    if (!this.extrudeArrow) {
      this.extrudeArrow = new THREE.ArrowHelper(dir, origin, length, 0xffffff, 0.12, 0.08);
      const lineMat = this.extrudeArrow.line.material as THREE.LineBasicMaterial;
      const coneMat = this.extrudeArrow.cone.material as THREE.MeshBasicMaterial;
      lineMat.depthTest = false;
      lineMat.depthWrite = false;
      coneMat.depthTest = false;
      coneMat.depthWrite = false;
      lineMat.color.setHex(0xffffff);
      coneMat.color.setHex(0xffffff);
      this.extrudeArrow.renderOrder = 1000;
      this.extrudeArrow.line.renderOrder = 1000;
      this.extrudeArrow.cone.renderOrder = 1000;

      const colliderMat = new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      this.extrudeArrowShaftCollider = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1, 12),
        colliderMat.clone(),
      );
      this.extrudeArrowHeadCollider = new THREE.Mesh(
        new THREE.ConeGeometry(0.2, 0.4, 16),
        colliderMat.clone(),
      );
      this.extrudeArrowShaftCollider.renderOrder = 1000;
      this.extrudeArrowHeadCollider.renderOrder = 1000;
      this.extrudeArrow.add(this.extrudeArrowShaftCollider, this.extrudeArrowHeadCollider);
      this.extrudeArrowPickObjects = [this.extrudeArrowShaftCollider, this.extrudeArrowHeadCollider];
      this.scene.add(this.extrudeArrow);
    }

    this.extrudeArrow.position.copy(origin);
    this.extrudeArrow.setDirection(dir);
    const headLength = Math.min(0.18, length * 0.35);
    const headWidth = Math.min(0.12, length * 0.24);
    const shaftLength = Math.max(0.001, length - headLength);
    this.extrudeArrow.setLength(length, headLength, headWidth);
    if (this.extrudeArrowShaftCollider) {
      this.extrudeArrowShaftCollider.scale.set(1, shaftLength, 1);
      this.extrudeArrowShaftCollider.position.set(0, shaftLength * 0.5, 0);
    }
    if (this.extrudeArrowHeadCollider) {
      this.extrudeArrowHeadCollider.scale.set(
        Math.max(0.7, headWidth / 0.2),
        Math.max(0.7, headLength / 0.4),
        Math.max(0.7, headWidth / 0.2),
      );
      this.extrudeArrowHeadCollider.position.set(0, shaftLength + headLength * 0.5, 0);
    }
    this.requestRender();
  }

  extrudeArrowPointerDown(ndcX: number, ndcY: number): boolean {
    if (!this.extrudeArrow || this.extrudeArrowPickObjects.length === 0) return false;
    this.raycaster.setFromCamera({ x: ndcX, y: ndcY } as any, this.camera);
    return this.raycaster.intersectObjects(this.extrudeArrowPickObjects, true).length > 0;
  }

  clearExtrudePreviewArrow(): void {
    if (!this.extrudeArrow) return;
    this.scene.remove(this.extrudeArrow);
    this.extrudeArrow.line.geometry.dispose();
    this.extrudeArrow.cone.geometry.dispose();
    (this.extrudeArrow.line.material as THREE.LineBasicMaterial).dispose();
    (this.extrudeArrow.cone.material as THREE.MeshBasicMaterial).dispose();
    this.extrudeArrowShaftCollider?.geometry.dispose();
    (this.extrudeArrowShaftCollider?.material as THREE.MeshBasicMaterial | undefined)?.dispose();
    this.extrudeArrowHeadCollider?.geometry.dispose();
    (this.extrudeArrowHeadCollider?.material as THREE.MeshBasicMaterial | undefined)?.dispose();
    this.extrudeArrow = null;
    this.extrudeArrowPickObjects = [];
    this.extrudeArrowShaftCollider = null;
    this.extrudeArrowHeadCollider = null;
    this.requestRender();
  }
//


  /**
   * Turn gizmo visibility on/off.
   * Typical usage: enable when something is selected.
   */
  setGizmoActive(active: boolean): void {
    this.gizmoActive = active;
    this.refreshGizmoTarget();
    this.requestRender();
  }

  setGizmoMode(mode: GizmoMode): void {
    this.gizmoMode = mode;
    this.gizmos.setMode(mode);
    this.refreshGizmoTarget();
    this.requestRender();
  }

  /**
   * Subscribe to gizmo deltas.
   * Use this to convert drag movement into undoable Commands later.
   */
  onGizmoDrag(cb: ((e: GizmoDragEvent) => void) | undefined): void {
    this.onGizmoDragCb = cb;
  }

  onGizmoModalTrigger(cb: ((e: { mode: GizmoMode }) => void) | undefined): void {
    this.onGizmoModalTriggerCb = cb;
  }

  /**
   * Pointer input pipeline:
   * Call this on pointerdown BEFORE doing selection picks.
   * Returns true if gizmo "captured" the drag, meaning
   * you should NOT perform normal selection picking.
   */
  gizmoPointerDown(ndcX: number, ndcY: number): GizmoInteractionResult {
    if (!this.gizmoActive) return "none";
    return this.gizmos.beginDrag(ndcX, ndcY);
  }

  /** Call this on pointermove while dragging. */
  gizmoPointerMove(ndcX: number, ndcY: number): void {
    if (!this.gizmoActive) return;
    this.gizmos.updateDrag(ndcX, ndcY);
  }

  /** Call this on pointermove when not dragging so handle hover stays in sync. */
  gizmoPointerHover(ndcX: number, ndcY: number): void {
    if (!this.gizmoActive) return;
    this.gizmos.hover(ndcX, ndcY);
  }

  /** Call this on pointerup. */
  gizmoPointerUp(): void {
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
    const vertexPosById = new Map<Id, THREE.Vector3>();
    verts.forEach((v) => {
      vertexPosById.set(v.id, new THREE.Vector3(v.position.x, v.position.y, v.position.z));
    });

    const smoothNormalById = new Map<Id, THREE.Vector3>();
    for (const v of verts) smoothNormalById.set(v.id, new THREE.Vector3());

    const faceNormalById = new Map<Id, THREE.Vector3>();
    for (const f of faces) {
      if (f.verts.length < 3) continue;
      const a = vertexPosById.get(f.verts[0])!;
      const b = vertexPosById.get(f.verts[1])!;
      const c = vertexPosById.get(f.verts[2])!;
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a));
      if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
      else normal.normalize();
      faceNormalById.set(f.id, normal);
      if (f.shading === "smooth") {
        for (const vId of f.verts) smoothNormalById.get(vId)?.add(normal);
      }
    }
    for (const normal of smoothNormalById.values()) {
      if (normal.lengthSq() < 1e-12) normal.set(0, 0, 1);
      else normal.normalize();
    }

    // -----------------------
    // 2) Index buffer (tris)
    // -----------------------
    this.triToFaceId = [];
    this.triIndexByFaceId.clear();
    this.triIndicesByFaceId.clear();
    this.faceVertexIdsByFaceId.clear();
    this.edgeVertexIdsByEdgeId.clear();
    this.indexToVertId = [];
    this.vertIndexById.clear();
    this.vertIndicesById.clear();

    const positionsOut: number[] = [];
    const normalsOut: number[] = [];
    let triOut = 0;

    for (const f of faces) {
      if (f.verts.length < 3) continue;
      this.faceVertexIdsByFaceId.set(f.id, [...f.verts]);

      const faceTriIndices: number[] = [];
      const faceNormal = faceNormalById.get(f.id) ?? new THREE.Vector3(0, 0, 1);

      for (let i = 1; i + 1 < f.verts.length; i++) {
        const triVerts = [f.verts[0]!, f.verts[i]!, f.verts[i + 1]!];
        for (const vId of triVerts) {
          const pos = vertexPosById.get(vId);
          if (!pos) continue;
          positionsOut.push(pos.x, pos.y, pos.z);
          const normal = f.shading === "flat" ? faceNormal : (smoothNormalById.get(vId) ?? faceNormal);
          normalsOut.push(normal.x, normal.y, normal.z);
          const renderIndex = this.indexToVertId.length;
          this.indexToVertId.push(vId);
          if (!this.vertIndexById.has(vId)) this.vertIndexById.set(vId, renderIndex);
          const renderIndices = this.vertIndicesById.get(vId);
          if (renderIndices) renderIndices.push(renderIndex);
          else this.vertIndicesById.set(vId, [renderIndex]);
        }

        this.triToFaceId[triOut] = f.id;
        faceTriIndices.push(triOut);
        triOut++;
      }

      if (faceTriIndices.length > 0) {
        this.triIndexByFaceId.set(f.id, faceTriIndices[0]);
        this.triIndicesByFaceId.set(f.id, faceTriIndices);
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positionsOut, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normalsOut, 3));
    geo.computeBoundingSphere();

    // -----------------------------
    // 3) Tear down old render state
    // -----------------------------
    clearSelectionOverlays(this.scene, this.overlayObjs);

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

    if (this.gizmoActive) this.gizmos.attach(this.meshObj);

    // Build pick helpers AFTER mesh objects are replaced
    this.buildVertexPoints(mesh);
    this.buildEdgeLines(mesh);
    this.refreshGizmoTarget();

    // -----------------------------
    // 6) Request refresh
    // -----------------------------
    this.requestRender();
  }



  // -----------------------
  // Picking (selection input)
  // -----------------------

  /** Face picking: raycast -> triangle index -> faceId via triToFaceId */
  /** Unified picking: vertex/edge via helper objects, face via main mesh triangles */
  pick(ndcX: number, ndcY: number, mode: SelectionMode): PickHit | null {
    // Keep click-picking in sync with the latest camera pose, even if the user
    // changes selection mode or clicks before the next render frame lands.
    this.forceCameraUpdate();

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

  boxSelect(startCss: { x: number; y: number }, endCss: { x: number; y: number }, mode: SelectionMode): Id[] {
    if (!this.meshObj) return [];

    this.forceCameraUpdate();
    this.meshObj.updateMatrixWorld(true);

    const rect = this.getCanvasRectCssPx();
    const left = Math.min(startCss.x, endCss.x) - rect.left;
    const right = Math.max(startCss.x, endCss.x) - rect.left;
    const top = Math.min(startCss.y, endCss.y) - rect.top;
    const bottom = Math.max(startCss.y, endCss.y) - rect.top;

    if (right - left < 1 || bottom - top < 1) return [];

    if (mode === "vertex") return this.boxSelectVertices(left, top, right, bottom);
    if (mode === "edge") return this.boxSelectEdges(left, top, right, bottom);
    return this.boxSelectFaces(left, top, right, bottom);
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
    this.segmentToVertIndices = new Array<[number, number]>(edges.length);

    for (let i = 0; i < edges.length; i++) {
      const e = edges[i]!;
      const a = mesh.getVertexPosition(e.a);
      const b = mesh.getVertexPosition(e.b);

      const ia = this.vertIndexById.get(e.a);
      const ib = this.vertIndexById.get(e.b);
      if (ia == null || ib == null) continue;

      // segment i occupies vertices (2*i) and (2*i+1)
      const base = i * 6;
      pos[base + 0] = a.x;
      pos[base + 1] = a.y;
      pos[base + 2] = a.z;
      pos[base + 3] = b.x;
      pos[base + 4] = b.y;
      pos[base + 5] = b.z;

      this.segmentToEdgeId[i] = e.id;
      this.segmentToVertIndices[i] = [ia, ib];
      this.edgeVertexIdsByEdgeId.set(e.id, [e.a, e.b]);
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

  private boxSelectVertices(left: number, top: number, right: number, bottom: number): Id[] {
    if (!this.meshObj) return [];

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return [];

    const selected = new Set<Id>();
    const worldMat = this.meshObj.matrixWorld;
    const world = new THREE.Vector3();
    const projected = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      world.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(worldMat);
      const screen = this.projectWorldToCanvasCss(world, projected);
      if (!screen) continue;

      if (screen.x >= left && screen.x <= right && screen.y >= top && screen.y <= bottom) {
        const id = this.indexToVertId[i];
        if (id) selected.add(id);
      }
    }

    return Array.from(selected);
  }

  private boxSelectEdges(left: number, top: number, right: number, bottom: number): Id[] {
    if (!this.meshObj) return [];

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return [];

    const selected = new Set<Id>();
    const worldMat = this.meshObj.matrixWorld;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const projectedA = new THREE.Vector3();
    const projectedB = new THREE.Vector3();

    for (let i = 0; i < this.segmentToEdgeId.length; i++) {
      const edgeId = this.segmentToEdgeId[i];
      const pair = this.segmentToVertIndices[i];
      if (!edgeId || !pair) continue;

      a.set(posAttr.getX(pair[0]), posAttr.getY(pair[0]), posAttr.getZ(pair[0])).applyMatrix4(worldMat);
      b.set(posAttr.getX(pair[1]), posAttr.getY(pair[1]), posAttr.getZ(pair[1])).applyMatrix4(worldMat);

      const screenA = this.projectWorldToCanvasCss(a, projectedA);
      const screenB = this.projectWorldToCanvasCss(b, projectedB);
      if (!screenA || !screenB) continue;

      const edgeLeft = Math.min(screenA.x, screenB.x);
      const edgeRight = Math.max(screenA.x, screenB.x);
      const edgeTop = Math.min(screenA.y, screenB.y);
      const edgeBottom = Math.max(screenA.y, screenB.y);

      if (edgeRight < left || edgeLeft > right || edgeBottom < top || edgeTop > bottom) continue;

      selected.add(edgeId);
    }

    return Array.from(selected);
  }

  private boxSelectFaces(left: number, top: number, right: number, bottom: number): Id[] {
    if (!this.meshObj) return [];

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return [];

    const selected = new Set<Id>();
    const worldMat = this.meshObj.matrixWorld;
    const world = new THREE.Vector3();
    const projected = new THREE.Vector3();

    for (const [faceId, vertexIds] of this.faceVertexIdsByFaceId.entries()) {
      let fullyInside = true;

      for (const vertexId of vertexIds) {
        const index = this.vertIndexById.get(vertexId);
        if (index === undefined) {
          fullyInside = false;
          break;
        }

        world.set(posAttr.getX(index), posAttr.getY(index), posAttr.getZ(index)).applyMatrix4(worldMat);
        const screen = this.projectWorldToCanvasCss(world, projected);
        if (!screen || screen.x < left || screen.x > right || screen.y < top || screen.y > bottom) {
          fullyInside = false;
          break;
        }
      }

      if (fullyInside) selected.add(faceId);
    }

    return Array.from(selected);
  }

  private projectWorldToCanvasCss(
    world: THREE.Vector3,
    projected: THREE.Vector3
  ): { x: number; y: number } | null {
    projected.copy(world).project(this.camera);
    if (projected.z < -1 || projected.z > 1) return null;

    const rect = this.getCanvasRectCssPx();
    return {
      x: (projected.x * 0.5 + 0.5) * rect.width,
      y: (-projected.y * 0.5 + 0.5) * rect.height,
    };
  }

  /**
   * OPTIONAL:
   * Copies the meshObj geometry's position buffer into the pick helper buffers
   * so vertex/edge raycasting stays aligned during preview.
   *
   * Call from applyVertexPositionPreview/endVertexPositionPreview if needed.
   */
  private syncPickHelpersToMeshGeometry(): void {
    if (!this.meshObj) return;

    const meshGeo = this.meshObj.geometry as THREE.BufferGeometry;
    const meshPosAttr = meshGeo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!meshPosAttr) return;

    const meshArr = meshPosAttr.array as Float32Array;

    // ---- Vertex points (mesh vertices -> first matching render vertex)
    if (this.vertexPoints) {
      const vGeo = this.vertexPoints.geometry as THREE.BufferGeometry;
      const vPosAttr = vGeo.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (vPosAttr) {
        const vArr = vPosAttr.array as Float32Array;
        for (let i = 0; i < this.indexToVertexId.length; i++) {
          const vertexId = this.indexToVertexId[i];
          const renderIndex = this.vertIndexById.get(vertexId);
          if (renderIndex == null) continue;
          vArr[i * 3 + 0] = meshArr[renderIndex * 3 + 0];
          vArr[i * 3 + 1] = meshArr[renderIndex * 3 + 1];
          vArr[i * 3 + 2] = meshArr[renderIndex * 3 + 2];
        }
        vPosAttr.needsUpdate = true;
        vGeo.computeBoundingSphere();
      }
    }

    if (this.edgeLines) {
      const eGeo = this.edgeLines.geometry as THREE.BufferGeometry;
      const ePosAttr = eGeo.getAttribute("position") as THREE.BufferAttribute | undefined;
      if (ePosAttr) {
        const eArr = ePosAttr.array as Float32Array;

        for (let seg = 0; seg < this.segmentToVertIndices.length; seg++) {
          const pair = this.segmentToVertIndices[seg];
          if (!pair) continue;

          const [ia, ib] = pair;
          const base = seg * 6;

          eArr[base + 0] = meshArr[ia * 3 + 0];
          eArr[base + 1] = meshArr[ia * 3 + 1];
          eArr[base + 2] = meshArr[ia * 3 + 2];

          eArr[base + 3] = meshArr[ib * 3 + 0];
          eArr[base + 4] = meshArr[ib * 3 + 1];
          eArr[base + 5] = meshArr[ib * 3 + 2];
        }

        ePosAttr.needsUpdate = true;
        eGeo.computeBoundingSphere();
      }
    }
  }

  private syncPreviewHelpersAndOverlays(): void {
    if (!this.meshObj) return;

    if (this.overlayObjs.edgesObj) {
      const oldGeo = this.overlayObjs.edgesObj.geometry;
      this.overlayObjs.edgesObj.geometry = new THREE.EdgesGeometry(
        this.meshObj.geometry as THREE.BufferGeometry,
        1
      );
      oldGeo.dispose();
    }

    this.syncPickHelpersToMeshGeometry();

    setSelectedFaces(
      this.scene,
      this.meshObj,
      this.selectedFaceIds,
      this.triIndicesByFaceId,
      this.overlayMats,
      this.overlayObjs
    );
    setSelectedVertices(
      this.scene,
      this.meshObj,
      this.selectedVertexIds,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    setSelectedEdges(
      this.scene,
      this.meshObj,
      this.selectedEdgeIds,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );

    this.refreshGizmoTarget();
    this.syncAllObjectTransformsToMesh();
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
    this.selectedFaceIds = new Set(ids);
    setSelectedFaces(
      this.scene,
      this.meshObj,
      this.selectedFaceIds,
      this.triIndicesByFaceId,
      this.overlayMats,
      this.overlayObjs
    );
    this.refreshGizmoTarget();
    this.syncAllObjectTransformsToMesh();
    this.requestRender();
  }

  /** Highlight selected vertices (points) */
  setSelectedVertices(ids: Iterable<Id>): void {
    this.selectedVertexIds = new Set(ids);
    setSelectedVertices(
      this.scene,
      this.meshObj,
      this.selectedVertexIds,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.refreshGizmoTarget();
    this.syncAllObjectTransformsToMesh();
    this.requestRender();
  }

  /** Highlight selected edges (line segments) */
  setSelectedEdges(ids: Iterable<Id>): void {
    this.selectedEdgeIds = new Set(ids);
    setSelectedEdges(
      this.scene,
      this.meshObj,
      this.selectedEdgeIds,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.refreshGizmoTarget();
    this.syncAllObjectTransformsToMesh();
    this.requestRender();
  }

  // ----------------------------
  // Back-compat single wrappers
  // ----------------------------

  setSelectedFace(id: Id | null): void {
    this.selectedFaceIds = id == null ? new Set<Id>() : new Set<Id>([id]);
    setSelectedFace(
      this.scene,
      this.meshObj,
      id,
      this.triIndicesByFaceId,
      this.overlayMats,
      this.overlayObjs
    );
    this.refreshGizmoTarget();
    this.syncAllObjectTransformsToMesh();
    this.requestRender();
  }

  setSelectedVertex(id: Id | null): void {
    this.selectedVertexIds = id == null ? new Set<Id>() : new Set<Id>([id]);
    setSelectedVertex(
      this.scene,
      this.meshObj,
      id,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.refreshGizmoTarget();
    this.syncAllObjectTransformsToMesh();
    this.requestRender();
  }

  setSelectedEdge(id: Id | null): void {
    this.selectedEdgeIds = id == null ? new Set<Id>() : new Set<Id>([id]);
    setSelectedEdge(
      this.scene,
      this.meshObj,
      id,
      this.vertIndexById,
      this.overlayMats,
      this.overlayObjs
    );
    this.refreshGizmoTarget();
    this.syncAllObjectTransformsToMesh();
    this.requestRender();
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
    if (this.running) return;
    this.running = true;

    const loop = () => {
      if (!this.running) return;
      this.renderFrame();
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
    this.requestRender();
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

  private refreshGizmoTarget(): void {
    if (!this.gizmoActive || !this.meshObj) {
      this.gizmos.detach();
      return;
    }

    const centroid = this.computeSelectionCentroidWorld();
    if (!centroid) {
      this.gizmos.detach();
      return;
    }

    this.gizmoAnchor.position.copy(centroid);
    this.gizmoAnchor.quaternion.identity();
    this.gizmoAnchor.scale.setScalar(1);
    this.gizmos.setMode(this.gizmoMode);
    this.gizmos.attach(this.gizmoAnchor);
    this.gizmos.update();
  }

  private computeSelectionCentroidWorld(): THREE.Vector3 | null {
    if (!this.meshObj) return null;

    const geo = this.meshObj.geometry as THREE.BufferGeometry;
    const posAttr = geo.getAttribute("position") as THREE.BufferAttribute | undefined;
    if (!posAttr) return null;

    const vertexIds = new Set<Id>();

    for (const vertexId of this.selectedVertexIds) vertexIds.add(vertexId);

    for (const edgeId of this.selectedEdgeIds) {
      const pair = this.edgeVertexIdsByEdgeId.get(edgeId);
      if (!pair) continue;
      vertexIds.add(pair[0]);
      vertexIds.add(pair[1]);
    }

    for (const faceId of this.selectedFaceIds) {
      const faceVertices = this.faceVertexIdsByFaceId.get(faceId);
      if (!faceVertices) continue;
      for (const vertexId of faceVertices) vertexIds.add(vertexId);
    }

    if (vertexIds.size === 0) return null;

    const sum = new THREE.Vector3();
    const world = new THREE.Vector3();
    const worldMat = this.meshObj.matrixWorld;
    let count = 0;

    for (const vertexId of vertexIds) {
      const index = this.vertIndexById.get(vertexId);
      if (index === undefined) continue;

      world
        .set(posAttr.getX(index), posAttr.getY(index), posAttr.getZ(index))
        .applyMatrix4(worldMat);
      sum.add(world);
      count++;
    }

    if (count === 0) return null;
    return sum.multiplyScalar(1 / count);
  }
}

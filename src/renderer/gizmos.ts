// src/renderer/gizmos.ts
import * as THREE from "three";

export type GizmoMode = "translate";
export type GizmoAxis = "x" | "y" | "z";

export type GizmoHit = {
    mode: GizmoMode;
    axis: GizmoAxis;
    worldPos: THREE.Vector3;
    distance: number;
};

export type GizmoDragEvent = {
    mode: GizmoMode;
    axis: GizmoAxis;

    /** Total delta from drag start, in WORLD space */
    deltaWorld: THREE.Vector3;

    /** Incremental delta since last onDrag call, in WORLD space */
    deltaWorldStep: THREE.Vector3;
};

export type GizmoCallbacks = {
    onDragStart?: (e: { mode: GizmoMode; axis: GizmoAxis }) => void;
    onDrag?: (e: GizmoDragEvent) => void;
    onDragEnd?: (e: { mode: GizmoMode; axis: GizmoAxis }) => void;
};

type AxisUserData = { kind: "gizmo"; mode: GizmoMode; axis: GizmoAxis };

function assertAxisUserData(x: unknown): asserts x is AxisUserData {
    // best-effort runtime check (no-throw in prod would be fine too)
    if (!x || typeof x !== "object") throw new Error("Bad gizmo userData");
    const o = x as any;
    if (o.kind !== "gizmo" || o.mode !== "translate") throw new Error("Bad gizmo userData");
    if (o.axis !== "x" && o.axis !== "y" && o.axis !== "z") throw new Error("Bad gizmo userData");
}

function safeNormalize(v: THREE.Vector3, fallback: THREE.Vector3): THREE.Vector3 {
    const len = v.length();
    if (len < 1e-8) return fallback.clone();
    return v.multiplyScalar(1 / len);
}

/**
 * Transform gizmos for the renderer layer.
 * - V1: translate-only
 * - Emits deltas; does NOT mutate core state.
 *
 * Usage pattern (in ThreeRenderer):
 * - gizmos.attach(meshObj) / gizmos.detach()
 * - on pointerdown: gizmos.beginDrag(ndcX, ndcY)
 * - on pointermove: gizmos.updateDrag(ndcX, ndcY)
 * - on pointerup:   gizmos.endDrag()
 * - in render loop: gizmos.update()
 */
export class TransformGizmos {
    readonly root = new THREE.Group();

    private mode: GizmoMode = "translate";
    private camera: THREE.Camera;
    private raycaster = new THREE.Raycaster();

    private target: THREE.Object3D | null = null;

    private callbacks: GizmoCallbacks = {};

    // translate gizmo visuals
    private handles: THREE.Object3D[] = [];

    // drag state
    private dragging = false;
    private dragAxis: GizmoAxis = "x";
    private dragPlane = new THREE.Plane();
    private dragStartHit = new THREE.Vector3();
    private dragStartTargetPos = new THREE.Vector3();
    private dragLastDelta = new THREE.Vector3();

    // cached temps
    private tmpRay = new THREE.Ray();
    private tmpV = new THREE.Vector3();
    private tmpV2 = new THREE.Vector3();
    private tmpMat4 = new THREE.Matrix4();

    constructor(scene: THREE.Scene, camera: THREE.Camera, callbacks?: GizmoCallbacks) {
        this.camera = camera;
        this.callbacks = callbacks ?? {};

        // The gizmo lives in the scene graph as renderer-owned visual state.
        scene.add(this.root);

        this.root.visible = false;

        // ALWAYS ON TOP: render after most scene objects
        this.root.renderOrder = 999;

        this.buildTranslateGizmo();

        // ALWAYS ON TOP: disable depth test/write for all gizmo materials we created
        // (keeps arrows visible even when behind geometry)
        this.root.traverse((o) => {
            const mesh = o as any;
            const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
            if (!mat) return;

            const apply = (m: any) => {
                m.depthTest = false;
                m.depthWrite = false;
                m.transparent = true;
            };

            if (Array.isArray(mat)) mat.forEach(apply);
            else apply(mat);

            // optional: ensure gizmo meshes sort late even if transparent sorting changes
            (o as any).renderOrder = 999;
        });
    }

    setCallbacks(cb: GizmoCallbacks): void {
        this.callbacks = cb;
    }

    setMode(mode: GizmoMode): void {
        this.mode = mode;
        // future: show/hide different handle sets
    }

    attach(target: THREE.Object3D | null): void {
        this.target = target;
        this.root.visible = !!target;
        if (target) {
            this.update(); // snap immediately
        }
    }

    detach(): void {
        this.endDrag(); // safe
        this.target = null;
        this.root.visible = false;
    }

    /**
     * Call every frame (or whenever camera/target changes)
     * Keeps gizmo positioned on the target and scaled to screen.
     */
    update(): void {
        if (!this.target) return;

        // Place at target world position
        const wp = this.target.getWorldPosition(this.tmpV);
        this.root.position.copy(wp);

        // Keep gizmo size roughly constant in screen space (simple distance scaling)
        const camPos = (this.camera as any).getWorldPosition
        ? (this.camera as any).getWorldPosition(this.tmpV2)
        : this.tmpV2.setFromMatrixPosition((this.camera as any).matrixWorld);

        const dist = camPos.distanceTo(wp);
        const s = Math.max(0.001, dist * 0.12);
        this.root.scale.setScalar(s);

        // Keep orientation aligned to world axes for now (classic world gizmo)
        this.root.quaternion.identity();
    }

    /**
     * Raycast against gizmo handles; returns which axis was hit.
     */
    pick(ndcX: number, ndcY: number): GizmoHit | null {
        if (!this.root.visible) return null;

        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        const hits = this.raycaster.intersectObjects(this.handles, true);
        if (hits.length === 0) return null;

        const h = hits[0];
        const ud = (h.object as any).userData as unknown;
        assertAxisUserData(ud);

        return {
            mode: ud.mode,
            axis: ud.axis,
            worldPos: h.point.clone(),
            distance: h.distance,
        };
    }

    /**
     * Begin drag if a gizmo handle is hit.
     * Returns true if drag started.
     */
    beginDrag(ndcX: number, ndcY: number): boolean {
        if (!this.target) return false;

        const hit = this.pick(ndcX, ndcY);
        if (!hit) return false;

        this.dragging = true;
        this.dragAxis = hit.axis;

        // Drag starts at target world position (not the exact handle hit point),
        // to make translation behave consistently.
        this.dragStartTargetPos.copy(this.target.getWorldPosition(this.tmpV));
        this.dragStartHit.copy(hit.worldPos);
        this.dragLastDelta.set(0, 0, 0);

        // Build a plane that:
        // - passes through dragStartTargetPos
        // - contains the axis direction
        // - is as facing the camera as possible (to make intersection stable)
        const axisDir = this.axisDirWorld(this.dragAxis);
        const camDir = this.cameraDirWorld(); // pointing forward from camera
        const n = new THREE.Vector3().crossVectors(axisDir, camDir);
        // If camera is parallel to axis, pick a stable fallback normal.
        const nSafe = safeNormalize(n, this.fallbackPlaneNormal(axisDir));
        const planeNormal = new THREE.Vector3().crossVectors(axisDir, nSafe);
        planeNormal.normalize();

        this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.dragStartTargetPos);

        this.callbacks.onDragStart?.({ mode: this.mode, axis: this.dragAxis });
        return true;
    }

    /**
     * Update drag given current mouse NDC.
     * Returns emitted event or null if not dragging / no hit.
     */
    updateDrag(ndcX: number, ndcY: number): GizmoDragEvent | null {
        if (!this.dragging || !this.target) return null;

        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

        // Intersect ray with drag plane
        this.tmpRay.copy(this.raycaster.ray);
        const p = new THREE.Vector3();
        const ok = this.tmpRay.intersectPlane(this.dragPlane, p);
        if (!ok) return null;

        const axisDir = this.axisDirWorld(this.dragAxis);
        // Total movement along axis = projection of (p - startPos) onto axisDir
        const v = p.sub(this.dragStartTargetPos);
        const t = v.dot(axisDir);

        const deltaWorld = axisDir.clone().multiplyScalar(t);

        const deltaWorldStep = deltaWorld.clone().sub(this.dragLastDelta);
        this.dragLastDelta.copy(deltaWorld);

        const e: GizmoDragEvent = {
            mode: this.mode,
            axis: this.dragAxis,
            deltaWorld,
            deltaWorldStep,
        };

        this.callbacks.onDrag?.(e);
        return e;
    }

    endDrag(): void {
        if (!this.dragging) return;
        this.dragging = false;
        this.callbacks.onDragEnd?.({ mode: this.mode, axis: this.dragAxis });
    }

    // -------------------------
    // Internals: visuals & math
    // -------------------------

    private buildTranslateGizmo(): void {
        // A simple arrow per axis: cylinder + cone, using MeshBasicMaterial (unlit).
        // (Colors are helpful for usability; feel free to theme later.)
        const mkAxis = (axis: GizmoAxis, color: number, dir: THREE.Vector3) => {
            const g = new THREE.Group();

            const shaft = new THREE.Mesh(
                new THREE.CylinderGeometry(0.03, 0.03, 0.7, 12),
                                         new THREE.MeshBasicMaterial({ color, depthTest: true })
            );
            const head = new THREE.Mesh(
                new THREE.ConeGeometry(0.07, 0.2, 16),
                                        new THREE.MeshBasicMaterial({ color, depthTest: true })
            );

            shaft.position.y = 0.35;
            head.position.y = 0.8;

            // Rotate from +Y into desired dir
            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            g.quaternion.copy(q);

            // Make selection easier: add an invisible thicker collider
            const collider = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 1.1, 8),
                                            new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthTest: false })
            );
            collider.position.y = 0.55;
            collider.quaternion.identity();
            collider.renderOrder = 999;

            // Tag userData on all pickable parts
            const ud: AxisUserData = { kind: "gizmo", mode: "translate", axis };
            (shaft as any).userData = ud;
            (head as any).userData = ud;
            (collider as any).userData = ud;

            g.add(shaft);
            g.add(head);
            g.add(collider);

            this.root.add(g);
            this.handles.push(shaft, head, collider);
        };

        mkAxis("x", 0xff5555, new THREE.Vector3(1, 0, 0));
        mkAxis("y", 0x55ff55, new THREE.Vector3(0, 1, 0));
        mkAxis("z", 0x5555ff, new THREE.Vector3(0, 0, 1));
    }

    private axisDirWorld(axis: GizmoAxis): THREE.Vector3 {
        // Gizmo is world-aligned (root quaternion identity), so axis is constant.
        if (axis === "x") return new THREE.Vector3(1, 0, 0);
        if (axis === "y") return new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3(0, 0, 1);
    }

    private cameraDirWorld(): THREE.Vector3 {
        // forward direction in world space
        const dir = new THREE.Vector3(0, 0, -1);
        dir.applyQuaternion(this.camera.quaternion);
        return dir.normalize();
    }

    private fallbackPlaneNormal(axisDir: THREE.Vector3): THREE.Vector3 {
        // choose a normal not parallel to axis
        const a = axisDir;
        // try world up first, else world right
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(a.dot(up)) < 0.95) return up;
        return new THREE.Vector3(1, 0, 0);
    }

    dispose(): void {
        // Remove from scene graph; dispose geometries/materials we created.
        // (Caller can also just let page reload in early MVP; but this is correct.)
        if (this.root.parent) this.root.parent.remove(this.root);

        this.root.traverse((o) => {
            const m = o as THREE.Mesh;
            if ((m as any).geometry) (m as any).geometry.dispose?.();
            if ((m as any).material) {
                const mat = (m as any).material as THREE.Material | THREE.Material[];
                if (Array.isArray(mat)) mat.forEach((mm) => mm.dispose());
                else mat.dispose();
            }
        });

        this.handles = [];
    }
}

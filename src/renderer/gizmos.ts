import * as THREE from "three";

export type GizmoMode = "translate" | "rotate" | "scale";
export type GizmoAxis = "x" | "y" | "z";
export type GizmoInteractionResult = "none" | "drag" | "modal";

export type GizmoHit = {
    kind: "axis" | "modal";
    mode: GizmoMode;
    axis?: GizmoAxis;
    worldPos: THREE.Vector3;
    distance: number;
};

export type GizmoDragEvent = {
    mode: GizmoMode;
    axis: GizmoAxis;
    deltaWorld: THREE.Vector3;
    deltaWorldStep: THREE.Vector3;
    angle: number;
    angleStep: number;
    factor: number;
    factorStep: number;
};

export type GizmoCallbacks = {
    onDragStart?: (e: { mode: GizmoMode; axis: GizmoAxis }) => void;
    onDrag?: (e: GizmoDragEvent) => void;
    onDragEnd?: (e: { mode: GizmoMode; axis: GizmoAxis }) => void;
    onModalTrigger?: (e: { mode: GizmoMode }) => void;
};

type GizmoUserData =
    | { kind: "gizmo-axis"; mode: GizmoMode; axis: GizmoAxis }
    | { kind: "gizmo-modal"; mode: GizmoMode };
type HandleVisual = {
    mode: GizmoMode;
    kind: "axis" | "modal";
    axis?: GizmoAxis;
    baseColor: number;
    primary: THREE.Mesh;
    secondary?: THREE.Mesh;
};

function assertGizmoUserData(x: unknown): asserts x is GizmoUserData {
    if (!x || typeof x !== "object") throw new Error("Bad gizmo userData");
    const o = x as any;
    if (o.kind !== "gizmo-axis" && o.kind !== "gizmo-modal") throw new Error("Bad gizmo userData");
    if (o.mode !== "translate" && o.mode !== "rotate" && o.mode !== "scale") {
        throw new Error("Bad gizmo userData");
    }
    if (o.kind === "gizmo-axis" && o.axis !== "x" && o.axis !== "y" && o.axis !== "z") {
        throw new Error("Bad gizmo userData");
    }
}

function axisColor(axis: GizmoAxis): number {
    if (axis === "x") return 0xf87171;
    if (axis === "y") return 0x4ade80;
    return 0x60a5fa;
}

export class TransformGizmos {
    readonly root = new THREE.Group();

    private mode: GizmoMode = "translate";
    private readonly camera: THREE.Camera;
    private readonly raycaster = new THREE.Raycaster();
    private readonly callbacks: GizmoCallbacks;

    private target: THREE.Object3D | null = null;

    private modeRoots: Record<GizmoMode, THREE.Group> = {
        translate: new THREE.Group(),
        rotate: new THREE.Group(),
        scale: new THREE.Group(),
    };
    private handlesByMode: Record<GizmoMode, THREE.Object3D[]> = {
        translate: [],
        rotate: [],
        scale: [],
    };
    private handleVisuals: HandleVisual[] = [];
    private billboardHandles: THREE.Object3D[] = [];
    private hovered: { mode: GizmoMode; kind: "axis" | "modal"; axis?: GizmoAxis } | null = null;

    private dragging = false;
    private dragMode: GizmoMode = "translate";
    private dragAxis: GizmoAxis = "x";
    private dragPlane = new THREE.Plane();
    private dragStartTargetPos = new THREE.Vector3();
    private dragLastDelta = new THREE.Vector3();
    private dragStartVector = new THREE.Vector3();
    private dragLastAngle = 0;
    private dragStartScalar = 1;
    private dragLastFactor = 1;

    private readonly tmpRay = new THREE.Ray();
    private readonly tmpV = new THREE.Vector3();
    private readonly tmpV2 = new THREE.Vector3();

    constructor(scene: THREE.Scene, camera: THREE.Camera, callbacks?: GizmoCallbacks) {
        this.camera = camera;
        this.callbacks = callbacks ?? {};

        scene.add(this.root);
        this.root.visible = false;
        this.root.renderOrder = 999;

        this.root.add(this.modeRoots.translate);
        this.root.add(this.modeRoots.rotate);
        this.root.add(this.modeRoots.scale);

        this.buildTranslateGizmo();
        this.buildRotateGizmo();
        this.buildScaleGizmo();
        this.applyRootVisibility();

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

            (o as any).renderOrder = 999;
        });
    }

    setMode(mode: GizmoMode): void {
        this.mode = mode;
        this.hovered = null;
        this.applyRootVisibility();
        this.applyHandleColors();
    }

    attach(target: THREE.Object3D | null): void {
        this.target = target;
        this.root.visible = !!target;
        if (target) this.update();
    }

    detach(): void {
        this.endDrag();
        this.target = null;
        this.root.visible = false;
    }

    update(): void {
        if (!this.target) return;

        const wp = this.target.getWorldPosition(this.tmpV);
        this.root.position.copy(wp);

        const camPos = (this.camera as any).getWorldPosition
            ? (this.camera as any).getWorldPosition(this.tmpV2)
            : this.tmpV2.setFromMatrixPosition((this.camera as any).matrixWorld);

        const dist = camPos.distanceTo(wp);
        const s = Math.max(0.001, dist * 0.12);
        this.root.scale.setScalar(s);
        this.root.quaternion.identity();
        for (const handle of this.billboardHandles) {
            handle.quaternion.copy(this.camera.quaternion);
        }
    }

    pick(ndcX: number, ndcY: number): GizmoHit | null {
        if (!this.root.visible) return null;

        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        const hits = this.raycaster.intersectObjects(this.handlesByMode[this.mode], true);
        if (hits.length === 0) {
            this.setHovered(null);
            return null;
        }

        const hit = hits[0];
        const ud = (hit.object as any).userData as unknown;
        assertGizmoUserData(ud);
            this.setHovered({
                mode: ud.mode,
                kind: ud.kind === "gizmo-modal" ? "modal" : "axis",
                axis: ud.kind === "gizmo-axis" ? ud.axis : undefined,
            });

        return {
            kind: ud.kind === "gizmo-modal" ? "modal" : "axis",
            mode: ud.mode,
            axis: ud.kind === "gizmo-axis" ? ud.axis : undefined,
            worldPos: hit.point.clone(),
            distance: hit.distance,
        };
    }

    hover(ndcX: number, ndcY: number): void {
        if (!this.root.visible || this.dragging) return;
        this.pick(ndcX, ndcY);
    }

    beginDrag(ndcX: number, ndcY: number): GizmoInteractionResult {
        if (!this.target) return "none";

        const hit = this.pick(ndcX, ndcY);
        if (!hit) return "none";
        if (hit.kind === "modal") {
            this.callbacks.onModalTrigger?.({ mode: hit.mode });
            return "modal";
        }

        this.dragging = true;
        this.dragMode = hit.mode;
        this.dragAxis = hit.axis!;
        this.dragStartTargetPos.copy(this.target.getWorldPosition(this.tmpV));
        this.dragLastDelta.set(0, 0, 0);
        this.dragLastAngle = 0;
        this.dragLastFactor = 1;

        const axisDir = this.axisDirWorld(this.dragAxis);
        const camDir = this.cameraDirWorld();

        if (this.dragMode === "translate" || this.dragMode === "scale") {
            const n = new THREE.Vector3().crossVectors(axisDir, camDir);
            const fallback = this.fallbackPlaneNormal(axisDir);
            const nSafe = n.lengthSq() < 1e-8 ? fallback : n.normalize();
            const planeNormal = new THREE.Vector3().crossVectors(axisDir, nSafe).normalize();
            this.dragPlane.setFromNormalAndCoplanarPoint(planeNormal, this.dragStartTargetPos);
        } else {
            this.dragPlane.setFromNormalAndCoplanarPoint(axisDir, this.dragStartTargetPos);
        }

        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        this.tmpRay.copy(this.raycaster.ray);
        this.tmpRay.intersectPlane(this.dragPlane, this.tmpV2);

        if (this.dragMode === "rotate") {
            this.dragStartVector.copy(this.tmpV2).sub(this.dragStartTargetPos);
            if (this.dragStartVector.lengthSq() < 1e-8) {
                const tangent = this.fallbackPlaneNormal(axisDir);
                this.dragStartVector.copy(tangent);
            }
            this.dragStartVector.normalize();
        } else if (this.dragMode === "scale") {
            const scalar = this.tmpV2.clone().sub(this.dragStartTargetPos).dot(axisDir);
            this.dragStartScalar = Math.abs(scalar) < 1e-4 ? 0.5 : scalar;
        }

        this.applyHandleColors();
        this.callbacks.onDragStart?.({ mode: this.dragMode, axis: this.dragAxis });
        return "drag";
    }

    updateDrag(ndcX: number, ndcY: number): GizmoDragEvent | null {
        if (!this.dragging || !this.target) return null;

        this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
        this.tmpRay.copy(this.raycaster.ray);
        const p = new THREE.Vector3();
        const ok = this.tmpRay.intersectPlane(this.dragPlane, p);
        if (!ok) return null;

        const axisDir = this.axisDirWorld(this.dragAxis);
        let deltaWorld = new THREE.Vector3();
        let deltaWorldStep = new THREE.Vector3();
        let angle = 0;
        let angleStep = 0;
        let factor = 1;
        let factorStep = 0;

        if (this.dragMode === "translate") {
            const v = p.clone().sub(this.dragStartTargetPos);
            const t = v.dot(axisDir);
            deltaWorld = axisDir.clone().multiplyScalar(t);
            deltaWorldStep = deltaWorld.clone().sub(this.dragLastDelta);
            this.dragLastDelta.copy(deltaWorld);
        } else if (this.dragMode === "rotate") {
            const currentVec = p.clone().sub(this.dragStartTargetPos);
            if (currentVec.lengthSq() < 1e-8) return null;
            currentVec.normalize();

            const cross = new THREE.Vector3().crossVectors(this.dragStartVector, currentVec);
            angle = Math.atan2(cross.dot(axisDir), this.dragStartVector.dot(currentVec));
            angleStep = angle - this.dragLastAngle;
            this.dragLastAngle = angle;
        } else {
            const scalar = p.clone().sub(this.dragStartTargetPos).dot(axisDir);
            factor = scalar / this.dragStartScalar;
            factor = Math.max(0.05, Math.min(20, factor));
            factorStep = factor - this.dragLastFactor;
            this.dragLastFactor = factor;
        }

        const event: GizmoDragEvent = {
            mode: this.dragMode,
            axis: this.dragAxis,
            deltaWorld,
            deltaWorldStep,
            angle,
            angleStep,
            factor,
            factorStep,
        };
        this.callbacks.onDrag?.(event);
        return event;
    }

    endDrag(): void {
        if (!this.dragging) return;
        this.dragging = false;
        this.hovered = null;
        this.applyHandleColors();
        this.callbacks.onDragEnd?.({ mode: this.dragMode, axis: this.dragAxis });
    }

    dispose(): void {
        if (this.root.parent) this.root.parent.remove(this.root);
        this.root.traverse((o) => {
            const mesh = o as any;
            mesh.geometry?.dispose?.();
            if (mesh.material) {
                const mat = mesh.material as THREE.Material | THREE.Material[];
                if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
                else mat.dispose();
            }
        });
        this.handleVisuals = [];
        this.handlesByMode = { translate: [], rotate: [], scale: [] };
    }

    private buildTranslateGizmo(): void {
        this.buildAxisArrows("translate", 0.018, 0.06, 0.8, 0.22, 1.18);
    }

    private buildScaleGizmo(): void {
        const root = this.modeRoots.scale;
        const makeAxis = (axis: GizmoAxis, dir: THREE.Vector3) => {
            const color = axisColor(axis);
            const g = new THREE.Group();
            const startOffset = 0.23;
            const shaft = new THREE.Mesh(
                new THREE.CylinderGeometry(0.016, 0.016, 0.72, 12),
                new THREE.MeshBasicMaterial({ color, opacity: 0.95 })
            );
            shaft.position.y = startOffset + 0.36;

            const box = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.14, 0.14),
                new THREE.MeshBasicMaterial({ color, opacity: 0.98 })
            );
            box.position.y = startOffset + 0.78;

            const collider = new THREE.Mesh(
                new THREE.CylinderGeometry(0.12, 0.12, 0.86, 10),
                new THREE.MeshBasicMaterial({ opacity: 0.0 })
            );
            collider.position.y = startOffset + 0.43;

            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            g.quaternion.copy(q);

            const ud: GizmoUserData = { kind: "gizmo-axis", mode: "scale", axis };
            (shaft as any).userData = ud;
            (box as any).userData = ud;
            (collider as any).userData = ud;

            g.add(shaft, box, collider);
            root.add(g);
            this.handlesByMode.scale.push(shaft, box, collider);
            this.handleVisuals.push({ mode: "scale", kind: "axis", axis, baseColor: color, primary: shaft, secondary: box });
        };

        makeAxis("x", new THREE.Vector3(1, 0, 0));
        makeAxis("y", new THREE.Vector3(0, 1, 0));
        makeAxis("z", new THREE.Vector3(0, 0, 1));
        this.buildModalCircle("scale", 0.11, 0.17, 0xffffff, 0.95);
    }

    private buildRotateGizmo(): void {
        const root = this.modeRoots.rotate;
        const makeAxis = (axis: GizmoAxis, dir: THREE.Vector3, rot: THREE.Euler) => {
            const color = axisColor(axis);
            const ring = new THREE.Mesh(
                new THREE.TorusGeometry(0.82, 0.026, 10, 64),
                new THREE.MeshBasicMaterial({ color, opacity: 0.95 })
            );
            ring.rotation.copy(rot);

            const collider = new THREE.Mesh(
                new THREE.TorusGeometry(0.82, 0.14, 8, 48),
                new THREE.MeshBasicMaterial({ opacity: 0.0 })
            );
            collider.rotation.copy(rot);

            const ud: GizmoUserData = { kind: "gizmo-axis", mode: "rotate", axis };
            (ring as any).userData = ud;
            (collider as any).userData = ud;

            root.add(ring, collider);
            this.handlesByMode.rotate.push(ring, collider);
            this.handleVisuals.push({ mode: "rotate", kind: "axis", axis, baseColor: color, primary: ring });
            void dir;
        };

        makeAxis("x", new THREE.Vector3(1, 0, 0), new THREE.Euler(0, Math.PI * 0.5, 0));
        makeAxis("y", new THREE.Vector3(0, 1, 0), new THREE.Euler(Math.PI * 0.5, 0, 0));
        makeAxis("z", new THREE.Vector3(0, 0, 1), new THREE.Euler(0, 0, 0));
        this.buildModalBorderRing("rotate", 1.08, 0.02, 0xffffff, 0.95);
    }

    private buildAxisArrows(
        mode: GizmoMode,
        shaftRadius: number,
        headRadius: number,
        shaftHeight: number,
        headHeight: number,
        colliderHeight: number
    ): void {
        const root = this.modeRoots[mode];
        const makeAxis = (axis: GizmoAxis, dir: THREE.Vector3) => {
            const color = axisColor(axis);
            const g = new THREE.Group();
            const startOffset = mode === "translate" ? 0.23 : 0.02;

            const shaft = new THREE.Mesh(
                new THREE.CylinderGeometry(shaftRadius, shaftRadius, shaftHeight, 14),
                new THREE.MeshBasicMaterial({ color, opacity: 0.95 })
            );
            const head = new THREE.Mesh(
                new THREE.ConeGeometry(headRadius, headHeight, 20),
                new THREE.MeshBasicMaterial({ color, opacity: 0.98 })
            );

            shaft.position.y = startOffset + shaftHeight * 0.5;
            head.position.y = startOffset + shaftHeight + headHeight * 0.5;

            const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
            g.quaternion.copy(q);

            const collider = new THREE.Mesh(
                new THREE.CylinderGeometry(0.11, 0.11, colliderHeight - startOffset, 10),
                new THREE.MeshBasicMaterial({ opacity: 0.0 })
            );
            collider.position.y = startOffset + (colliderHeight - startOffset) * 0.5;

            const ud: GizmoUserData = { kind: "gizmo-axis", mode, axis };
            (shaft as any).userData = ud;
            (head as any).userData = ud;
            (collider as any).userData = ud;

            g.add(shaft, head, collider);
            root.add(g);
            this.handlesByMode[mode].push(shaft, head, collider);
            this.handleVisuals.push({ mode, kind: "axis", axis, baseColor: color, primary: shaft, secondary: head });
        };

        makeAxis("x", new THREE.Vector3(1, 0, 0));
        makeAxis("y", new THREE.Vector3(0, 1, 0));
        makeAxis("z", new THREE.Vector3(0, 0, 1));
        if (mode === "translate") this.buildModalCircle("translate", 0.11, 0.17, 0xffffff, 0.95);
    }

    private buildModalCircle(
        mode: GizmoMode,
        innerRadius: number,
        outerRadius: number,
        color: number,
        opacity: number
    ): void {
        const root = this.modeRoots[mode];
        const group = new THREE.Group();
        const ring = new THREE.Mesh(
            new THREE.RingGeometry(innerRadius, outerRadius, 40),
            new THREE.MeshBasicMaterial({ color, opacity, side: THREE.DoubleSide })
        );
        const collider = new THREE.Mesh(
            new THREE.CircleGeometry(outerRadius + 0.05, 32),
            new THREE.MeshBasicMaterial({ opacity: 0.0, side: THREE.DoubleSide })
        );
        const ud: GizmoUserData = { kind: "gizmo-modal", mode };
        (ring as any).userData = ud;
        (collider as any).userData = ud;
        group.add(ring, collider);
        root.add(group);
        this.billboardHandles.push(group);
        this.handlesByMode[mode].push(ring, collider);
        this.handleVisuals.push({ mode, kind: "modal", baseColor: color, primary: ring });
    }

    private buildModalBorderRing(
        mode: GizmoMode,
        radius: number,
        tube: number,
        color: number,
        opacity: number
    ): void {
        const root = this.modeRoots[mode];
        const group = new THREE.Group();
        const ring = new THREE.Mesh(
            new THREE.TorusGeometry(radius, tube, 10, 96),
            new THREE.MeshBasicMaterial({ color, opacity })
        );
        const collider = new THREE.Mesh(
            new THREE.TorusGeometry(radius, 0.11, 8, 64),
            new THREE.MeshBasicMaterial({ opacity: 0.0 })
        );
        const ud: GizmoUserData = { kind: "gizmo-modal", mode };
        (ring as any).userData = ud;
        (collider as any).userData = ud;
        group.add(ring, collider);
        root.add(group);
        this.billboardHandles.push(group);
        this.handlesByMode[mode].push(ring, collider);
        this.handleVisuals.push({ mode, kind: "modal", baseColor: color, primary: ring });
    }

    private applyRootVisibility(): void {
        this.modeRoots.translate.visible = this.mode === "translate";
        this.modeRoots.rotate.visible = this.mode === "rotate";
        this.modeRoots.scale.visible = this.mode === "scale";
    }

    private axisDirWorld(axis: GizmoAxis): THREE.Vector3 {
        if (axis === "x") return new THREE.Vector3(1, 0, 0);
        if (axis === "y") return new THREE.Vector3(0, 1, 0);
        return new THREE.Vector3(0, 0, 1);
    }

    private cameraDirWorld(): THREE.Vector3 {
        const dir = new THREE.Vector3(0, 0, -1);
        dir.applyQuaternion(this.camera.quaternion);
        return dir.normalize();
    }

    private fallbackPlaneNormal(axisDir: THREE.Vector3): THREE.Vector3 {
        const up = new THREE.Vector3(0, 1, 0);
        if (Math.abs(axisDir.dot(up)) < 0.95) return up;
        return new THREE.Vector3(1, 0, 0);
    }

    private setHovered(next: { mode: GizmoMode; kind: "axis" | "modal"; axis?: GizmoAxis } | null): void {
        if (this.dragging) return;
        const same =
            this.hovered?.mode === next?.mode &&
            this.hovered?.kind === next?.kind &&
            this.hovered?.axis === next?.axis;
        if (same) return;
        this.hovered = next;
        this.applyHandleColors();
    }

    private applyHandleColors(): void {
        for (const visual of this.handleVisuals) {
            const active =
                this.dragging &&
                visual.kind === "axis" &&
                visual.mode === this.dragMode &&
                visual.axis === this.dragAxis;
            const hovered =
                !this.dragging &&
                this.hovered?.mode === visual.mode &&
                this.hovered?.kind === visual.kind &&
                this.hovered?.axis === visual.axis;

            const color = new THREE.Color(visual.baseColor);
            if (hovered) color.lerp(new THREE.Color(0xffffff), 0.25);
            if (active) color.lerp(new THREE.Color(0xffffff), 0.45);

            (visual.primary.material as THREE.MeshBasicMaterial).color.copy(color);
            if (visual.secondary) {
                (visual.secondary.material as THREE.MeshBasicMaterial).color.copy(color);
            }
        }
    }
}

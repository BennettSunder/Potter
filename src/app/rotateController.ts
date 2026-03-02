import * as THREE from "three";
import type { Mesh, Vec3 } from "../core/mesh";
import type { Id } from "../core/ids/ids";
import type { CommandManager } from "../core/commands/commandManager";
import type { SelectionContext } from "../core/commands/selectionCommands/setSelectionCommand";
import { RotateVerticesCommand } from "../core/commands/mesh/rotateVerticesCommand";
import { selectionToVertexIds } from "../core/selection/selectionToVertexIds";
import { makeSelection } from "../core/selection/selection";

function v3(x: number, y: number, z: number): Vec3 {
    return { x, y, z };
}

function centroidOfVertices(mesh: Mesh, vertexIds: readonly Id[]): Vec3 {
    let sx = 0;
    let sy = 0;
    let sz = 0;

    for (const id of vertexIds) {
        const p = mesh.getVertexPosition(id);
        sx += p.x;
        sy += p.y;
        sz += p.z;
    }

    const n = vertexIds.length || 1;
    return v3(sx / n, sy / n, sz / n);
}

function normalize(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len < 1e-8) return v3(0, 0, 1);
    return v3(v.x / len, v.y / len, v.z / len);
}

function rotateAroundAxis(pos: Vec3, center: Vec3, axis: Vec3, angle: number): Vec3 {
    const unit = normalize(axis);
    const px = pos.x - center.x;
    const py = pos.y - center.y;
    const pz = pos.z - center.z;

    const cos = Math.cos(angle);
    const sin = Math.sin(angle);

    const dot = px * unit.x + py * unit.y + pz * unit.z;
    const crossX = unit.y * pz - unit.z * py;
    const crossY = unit.z * px - unit.x * pz;
    const crossZ = unit.x * py - unit.y * px;

    return {
        x: center.x + px * cos + crossX * sin + unit.x * dot * (1 - cos),
        y: center.y + py * cos + crossY * sin + unit.y * dot * (1 - cos),
        z: center.z + pz * cos + crossZ * sin + unit.z * dot * (1 - cos),
    };
}

export class RotateController {
    private active = false;

    private vertexIds: Id[] = [];
    private center = v3(0, 0, 0);
    private axis = v3(0, 0, 1);
    private basePositions = new Map<Id, Vec3>();
    private plane = new THREE.Plane();
    private startHit = new THREE.Vector3();
    private lastAngle = 0;

    private readonly raycaster = new THREE.Raycaster();
    private readonly ndc = new THREE.Vector2();
    private readonly hit = new THREE.Vector3();
    private readonly camDir = new THREE.Vector3();
    private readonly pivot = new THREE.Vector3();

    private readonly mesh: Mesh;
    private readonly selection: ReturnType<typeof makeSelection>;
    private readonly commands: CommandManager<SelectionContext>;
    private readonly cmdCtx: SelectionContext;
    private readonly camera: THREE.Camera;
    private readonly getCanvas: () => HTMLCanvasElement;
    private readonly getPointerClientPos: () => { x: number; y: number };
    private readonly syncCameraForPicking: () => void;
    private readonly requestRenderSync: () => void;
    private readonly beginPreview: (vertexIds: Id[]) => void;
    private readonly applyPreviewPositions: (positions: ReadonlyMap<Id, Vec3>) => void;
    private readonly endPreview: (opts: { commit: boolean }) => void;

    constructor(
        mesh: Mesh,
        selection: ReturnType<typeof makeSelection>,
        commands: CommandManager<SelectionContext>,
        cmdCtx: SelectionContext,
        camera: THREE.Camera,
        getCanvas: () => HTMLCanvasElement,
        getPointerClientPos: () => { x: number; y: number },
        syncCameraForPicking: () => void,
        requestRenderSync: () => void,
        beginPreview: (vertexIds: Id[]) => void,
        applyPreviewPositions: (positions: ReadonlyMap<Id, Vec3>) => void,
        endPreview: (opts: { commit: boolean }) => void,
    ) {
        this.mesh = mesh;
        this.selection = selection;
        this.commands = commands;
        this.cmdCtx = cmdCtx;
        this.camera = camera;
        this.getCanvas = getCanvas;
        this.getPointerClientPos = getPointerClientPos;
        this.syncCameraForPicking = syncCameraForPicking;
        this.requestRenderSync = requestRenderSync;
        this.beginPreview = beginPreview;
        this.applyPreviewPositions = applyPreviewPositions;
        this.endPreview = endPreview;
    }

    isActive(): boolean {
        return this.active;
    }

    beginFromKey(): void {
        if (this.active) return;

        const ids = selectionToVertexIds(this.mesh, this.selection);
        if (ids.length === 0) return;

        this.vertexIds = ids;
        this.center = centroidOfVertices(this.mesh, ids);
        this.pivot.set(this.center.x, this.center.y, this.center.z);
        this.basePositions = new Map<Id, Vec3>();

        for (const id of ids) {
            const p = this.mesh.getVertexPosition(id);
            this.basePositions.set(id, v3(p.x, p.y, p.z));
        }

        this.syncCameraForPicking();
        (this.camera as any).getWorldDirection?.(this.camDir);
        if (this.camDir.lengthSq() < 1e-12) this.camDir.set(0, 0, -1);
        this.axis = normalize(v3(this.camDir.x, this.camDir.y, this.camDir.z));
        this.plane.setFromNormalAndCoplanarPoint(this.camDir.normalize(), this.pivot);

        if (!this.getMouseRayPointOnPlaneOrFallback(this.startHit)) return;

        this.lastAngle = 0;
        this.active = true;
        this.beginPreview(this.vertexIds);
    }

    cancel(): void {
        if (!this.active) return;
        this.endPreview({ commit: false });
        this.reset();
    }

    commit(): void {
        if (!this.active) return;

        const angle = this.lastAngle;
        this.active = false;

        if (Math.abs(angle) > 1e-4) {
            this.commands.execute(
                this.cmdCtx,
                new RotateVerticesCommand(this.mesh, this.vertexIds, this.center, this.axis, angle),
            );
            this.requestRenderSync();
        }

        this.endPreview({ commit: true });
        this.reset();
    }

    onPointerMove(): void {
        if (!this.active) return;

        this.syncCameraForPicking();
        if (!this.getMouseRayPointOnPlaneOrFallback(this.hit)) return;

        const startVec = new THREE.Vector3(
            this.startHit.x - this.center.x,
            this.startHit.y - this.center.y,
            this.startHit.z - this.center.z,
        );
        const currentVec = new THREE.Vector3(
            this.hit.x - this.center.x,
            this.hit.y - this.center.y,
            this.hit.z - this.center.z,
        );

        if (startVec.lengthSq() < 1e-12 || currentVec.lengthSq() < 1e-12) return;

        startVec.normalize();
        currentVec.normalize();

        const cross = new THREE.Vector3().crossVectors(startVec, currentVec);
        const axis = new THREE.Vector3(this.axis.x, this.axis.y, this.axis.z);
        const angle = Math.atan2(cross.dot(axis), startVec.dot(currentVec));

        const preview = new Map<Id, Vec3>();
        for (const [id, pos] of this.basePositions.entries()) {
            preview.set(id, rotateAroundAxis(pos, this.center, this.axis, angle));
        }

        this.applyPreviewPositions(preview);
        this.lastAngle = angle;
    }

    private reset(): void {
        this.lastAngle = 0;
        this.vertexIds = [];
        this.basePositions.clear();
        this.active = false;
    }

    private getMouseRayPointOnPlaneOrFallback(out: THREE.Vector3): boolean {
        const canvas = this.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const { x, y } = this.getPointerClientPos();

        this.ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.ndc.y = -(((y - rect.top) / rect.height) * 2 - 1);
        this.raycaster.setFromCamera(this.ndc, this.camera as any);

        const ray = this.raycaster.ray;
        const hit = ray.intersectPlane(this.plane, out);
        if (hit !== null) return true;

        ray.closestPointToPoint(this.pivot, out);
        return true;
    }
}

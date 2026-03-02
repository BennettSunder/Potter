import * as THREE from "three";
import type { Mesh, Vec3 } from "../core/mesh";
import type { Id } from "../core/ids/ids";
import type { CommandManager } from "../core/commands/commandManager";
import type { SelectionContext } from "../core/commands/selectionCommands/setSelectionCommand";
import { ScaleVerticesCommand } from "../core/commands/mesh/scaleVerticesCommand";
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

function distanceToCenter(pos: Vec3, center: Vec3): number {
    const dx = pos.x - center.x;
    const dy = pos.y - center.y;
    const dz = pos.z - center.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function scaleAroundCenter(pos: Vec3, center: Vec3, factor: number): Vec3 {
    return {
        x: center.x + (pos.x - center.x) * factor,
        y: center.y + (pos.y - center.y) * factor,
        z: center.z + (pos.z - center.z) * factor,
    };
}

export class ScaleController {
    private active = false;

    private vertexIds: Id[] = [];
    private center = v3(0, 0, 0);
    private basePositions = new Map<Id, Vec3>();
    private plane = new THREE.Plane();
    private startHit = new THREE.Vector3();
    private startRadius = 0;
    private lastFactor = 1;

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
        this.plane.setFromNormalAndCoplanarPoint(this.camDir.normalize(), this.pivot);

        if (!this.getMouseRayPointOnPlaneOrFallback(this.startHit)) return;

        this.startRadius = Math.max(this.hitRadius(this.startHit), this.averageBaseRadius(), 1e-4);
        this.lastFactor = 1;
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

        const factor = this.lastFactor;
        this.active = false;

        if (Math.abs(factor - 1) > 1e-4) {
            this.commands.execute(
                this.cmdCtx,
                new ScaleVerticesCommand(this.mesh, this.vertexIds, this.center, factor),
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

        const nextRadius = this.hitRadius(this.hit);
        const rawFactor = nextRadius / this.startRadius;
        const factor = Math.max(0.05, Math.min(20, rawFactor));

        const preview = new Map<Id, Vec3>();
        for (const [id, pos] of this.basePositions.entries()) {
            preview.set(id, scaleAroundCenter(pos, this.center, factor));
        }

        this.applyPreviewPositions(preview);
        this.lastFactor = factor;
    }

    private reset(): void {
        this.lastFactor = 1;
        this.vertexIds = [];
        this.basePositions.clear();
        this.active = false;
    }

    private averageBaseRadius(): number {
        let total = 0;
        let count = 0;
        for (const pos of this.basePositions.values()) {
            total += distanceToCenter(pos, this.center);
            count++;
        }
        return count > 0 ? total / count : 0;
    }

    private hitRadius(hit: THREE.Vector3): number {
        const dx = hit.x - this.center.x;
        const dy = hit.y - this.center.y;
        const dz = hit.z - this.center.z;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
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

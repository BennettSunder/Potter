// src/app/grabController.ts
import * as THREE from "three";
import type { Mesh, Vec3 } from "../core/mesh";
import type { Id } from "../core/ids/ids";
import type { CommandManager } from "../core/commands/commandManager";
import type { SelectionContext } from "../core/commands/selectionCommands/setSelectionCommand";
import { MoveVerticesCommand } from "../core/commands/mesh/moveVerticesCommand";
import { selectionToVertexIds } from "../core/selection/selectionToVertexIds";
import { makeSelection } from "../core/selection/selection";

function v3(x: number, y: number, z: number): Vec3 {
    return { x, y, z };
}

function neg(a: Vec3): Vec3 {
    return v3(-a.x, -a.y, -a.z);
}

function len2(a: Vec3): number {
    return a.x * a.x + a.y * a.y + a.z * a.z;
}

function centroidOfVertices(mesh: Mesh, vertexIds: readonly Id[]): Vec3 {
    let sx = 0, sy = 0, sz = 0;
    let n = 0;

    for (const id of vertexIds) {
        const p = mesh.getVertexPosition(id);
        sx += p.x; sy += p.y; sz += p.z;
        n++;
    }

    if (n === 0) return v3(0, 0, 0);
    return v3(sx / n, sy / n, sz / n);
}

export class GrabController {
    private active = false;

    private vertexIds: Id[] = [];
    private pivot = new THREE.Vector3();
    private plane = new THREE.Plane();
    private startHit = new THREE.Vector3();
    private lastDelta: Vec3 = v3(0, 0, 0);

    // scratch
    private raycaster = new THREE.Raycaster();
    private ndc = new THREE.Vector2();
    private hit = new THREE.Vector3();
    private camDir = new THREE.Vector3();

    private readonly mesh: Mesh;
    private readonly selection: ReturnType<typeof makeSelection>;
    private readonly commands: CommandManager<SelectionContext>;
    private readonly cmdCtx: SelectionContext;
    private readonly camera: THREE.Camera;
    private readonly getCanvas: () => HTMLCanvasElement;
    private readonly getPointerClientPos: () => { x: number; y: number };
    private readonly syncCameraForPicking: () => void;
    private readonly requestRenderSync: () => void;

    constructor(
        mesh: Mesh,
        selection: ReturnType<typeof makeSelection>,
        commands: CommandManager<SelectionContext>,
        cmdCtx: SelectionContext,
        camera: THREE.Camera,
        getCanvas: () => HTMLCanvasElement,

        /**
            * Provided by UI/bindings (single source of truth for pointer state).
            * Must return last-known clientX/clientY (screen coords).
            */
        getPointerClientPos: () => { x: number; y: number },

        /**
            * Provided by renderer/app to force camera/controller state fresh
            * before computing rays (e.g. OrbitControls.update + camera matrices).
            */
        syncCameraForPicking: () => void,

        requestRenderSync: () => void
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
    }

    isActive() {
        return this.active;
    }

    beginFromKey(): void {
        if (this.active) return;

        const ids = selectionToVertexIds(this.mesh, this.selection);
        if (ids.length === 0) return;

        this.vertexIds = ids;

        // pivot at selection centroid
        const c = centroidOfVertices(this.mesh, this.vertexIds);
        this.pivot.set(c.x, c.y, c.z);

        // Ensure camera/controller state is fresh before computing world direction / rays.
        this.syncCameraForPicking();

        // Plane normal = camera forward, passing through pivot
        (this.camera as any).getWorldDirection?.(this.camDir);
        if (this.camDir.lengthSq() < 1e-12) this.camDir.set(0, 0, -1);
        this.plane.setFromNormalAndCoplanarPoint(this.camDir.normalize(), this.pivot);

        // Start intersection uses current mouse position (no click needed)
        if (!this.getMouseRayPointOnPlaneOrFallback(this.startHit)) return;

        this.lastDelta = v3(0, 0, 0);
        this.active = true;
    }

    cancel(): void {
        if (!this.active) return;

        // remove preview if any
        this.applyPreviewDelta(neg(this.lastDelta));
        this.lastDelta = v3(0, 0, 0);

        this.active = false;
        this.vertexIds = [];
    }

    commit(): void {
        if (!this.active) return;

        // remove preview
        this.applyPreviewDelta(neg(this.lastDelta));

        const d = this.lastDelta;

        this.active = false;

        // commit real command once
        if (len2(d) > 1e-18) {
            this.commands.execute(this.cmdCtx, new MoveVerticesCommand(this.mesh, this.vertexIds, d));
            this.requestRenderSync();
        }

        this.vertexIds = [];
        this.lastDelta = v3(0, 0, 0);
    }

    onPointerMove(): void {
        if (!this.active) return;

        // Keep camera/controller state fresh while dragging (cheap insurance).
        this.syncCameraForPicking();

        if (!this.getMouseRayPointOnPlaneOrFallback(this.hit)) return;

        const dx = this.hit.x - this.startHit.x;
        const dy = this.hit.y - this.startHit.y;
        const dz = this.hit.z - this.startHit.z;

        const next = v3(dx, dy, dz);

        // preview: undo last, apply new
        this.applyPreviewDelta(neg(this.lastDelta));
        this.applyPreviewDelta(next);

        this.lastDelta = next;
    }

    private applyPreviewDelta(delta: Vec3) {
        if (len2(delta) <= 1e-18) return;
        this.mesh.applyVertexDelta(this.vertexIds, delta);
        this.requestRenderSync();
        console.log("preview delta", delta);

    }

    /**
     * Robust “mouse to plane”:
     * - First try ray.intersectPlane(plane)
     * - If that fails (parallel / numerical weirdness), fall back to closest point on ray to pivot
     */
    private getMouseRayPointOnPlaneOrFallback(out: THREE.Vector3): boolean {
        const canvas = this.getCanvas();
        const rect = canvas.getBoundingClientRect();

        const { x, y } = this.getPointerClientPos();

        this.ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.ndc.y = -(((y - rect.top) / rect.height) * 2 - 1);

        this.raycaster.setFromCamera(this.ndc, this.camera as any);

        const ray = this.raycaster.ray;

        const hit = ray.intersectPlane(this.plane, out);
        if (hit !== null) {
            console.log("grab hit: plane");
            return true;
        }
        console.log("grab hit: fallback");
        ray.closestPointToPoint(this.pivot, out);
        return true;

    }
}

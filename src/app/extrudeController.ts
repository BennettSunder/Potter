import * as THREE from "three";
import { Mesh, type MeshSnapshot, type Vec3, type Face } from "../core/mesh";
import type { Id } from "../core/ids/ids";
import { makeId } from "../core/ids/ids";
import type { CommandManager } from "../core/commands/commandManager";
import type { SelectionContext } from "../core/commands/selectionCommands/setSelectionCommand";
import { ReplaceMeshCommand } from "../core/commands/mesh/replaceMeshCommand";
import { makeSelection, snapshotSelection, type SelectionSnapshot } from "../core/selection/selection";

function v3(x: number, y: number, z: number): Vec3 {
    return { x, y, z };
}

function add(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function sub(a: Vec3, b: Vec3): Vec3 {
    return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function scale(a: Vec3, s: number): Vec3 {
    return { x: a.x * s, y: a.y * s, z: a.z * s };
}

function dot(a: Vec3, b: Vec3): number {
    return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a: Vec3): number {
    return Math.sqrt(dot(a, a));
}

function normalize(a: Vec3): Vec3 {
    const len = length(a);
    if (len < 1e-8) return { x: 0, y: 0, z: 1 };
    return scale(a, 1 / len);
}

function edgeKey(a: Id, b: Id): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function polygonNormal(face: Face, positions: Map<Id, Vec3>): Vec3 {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const n = face.verts.length;
    if (n < 3) return v3(0, 0, 0);

    for (let i = 0; i < n; i++) {
        const current = positions.get(face.verts[i]!)!;
        const next = positions.get(face.verts[(i + 1) % n]!)!;
        nx += (current.y - next.y) * (current.z + next.z);
        ny += (current.z - next.z) * (current.x + next.x);
        nz += (current.x - next.x) * (current.y + next.y);
    }

    return v3(nx, ny, nz);
}

function centroidOfVertexIds(vertexIds: Iterable<Id>, positions: Map<Id, Vec3>): Vec3 {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let count = 0;
    for (const id of vertexIds) {
        const p = positions.get(id);
        if (!p) continue;
        sx += p.x;
        sy += p.y;
        sz += p.z;
        count++;
    }
    return count > 0 ? v3(sx / count, sy / count, sz / count) : v3(0, 0, 0);
}

type ExtrudePlan = {
    faceIds: Id[];
    regionVertexIds: Id[];
    normal: Vec3;
    center: Vec3;
    newVertexIdByOld: Map<Id, Id>;
    topFaceIdByBase: Map<Id, Id>;
    boundaryEdges: Array<{ a: Id; b: Id; sideFaceId: Id }>;
    initialSelection: SelectionSnapshot;
};

function buildFaceSelection(mesh: Mesh, selection: ReturnType<typeof makeSelection>): Id[] {
    if (selection.mode === "face") return Array.from(selection.faceIds);

    const faces = mesh.getFaces();
    if (selection.mode === "vertex") {
        const selectedVerts = new Set(selection.vertexIds);
        return faces.filter((face) => face.verts.some((id) => selectedVerts.has(id))).map((face) => face.id);
    }

    const selectedEdgeKeys = new Set<string>();
    for (const edgeId of selection.edgeIds) {
        const edge = mesh.getEdgeById(edgeId);
        selectedEdgeKeys.add(edgeKey(edge.a, edge.b));
    }

    const out: Id[] = [];
    for (const face of faces) {
        const n = face.verts.length;
        for (let i = 0; i < n; i++) {
            if (selectedEdgeKeys.has(edgeKey(face.verts[i]!, face.verts[(i + 1) % n]!))) {
                out.push(face.id);
                break;
            }
        }
    }
    return out;
}

function buildExtrudePlan(mesh: Mesh, selection: ReturnType<typeof makeSelection>): ExtrudePlan | null {
    const faceIds = buildFaceSelection(mesh, selection);
    if (faceIds.length === 0) return null;

    const positions = new Map<Id, Vec3>();
    for (const v of mesh.getVertices()) positions.set(v.id, { x: v.position.x, y: v.position.y, z: v.position.z });

    const faces = faceIds.map((id) => mesh.getFaceById(id));
    const regionVertexIds = Array.from(new Set(faces.flatMap((face) => face.verts)));
    if (regionVertexIds.length === 0) return null;

    let normalSum = v3(0, 0, 0);
    for (const face of faces) {
        normalSum = add(normalSum, polygonNormal(face, positions));
    }
    const normal = normalize(normalSum);
    if (length(normal) < 1e-8) return null;

    const boundaryCount = new Map<string, number>();
    const boundaryDirected = new Map<string, { a: Id; b: Id }>();
    for (const face of faces) {
        const n = face.verts.length;
        for (let i = 0; i < n; i++) {
            const a = face.verts[i]!;
            const b = face.verts[(i + 1) % n]!;
            const key = edgeKey(a, b);
            boundaryCount.set(key, (boundaryCount.get(key) ?? 0) + 1);
            if (!boundaryDirected.has(key)) boundaryDirected.set(key, { a, b });
        }
    }

    const newVertexIdByOld = new Map<Id, Id>();
    for (const id of regionVertexIds) newVertexIdByOld.set(id, makeId("v"));

    const topFaceIdByBase = new Map<Id, Id>();
    for (const face of faces) topFaceIdByBase.set(face.id, makeId("f"));

    const boundaryEdges: Array<{ a: Id; b: Id; sideFaceId: Id }> = [];
    for (const [key, count] of boundaryCount.entries()) {
        if (count !== 1) continue;
        const edge = boundaryDirected.get(key);
        if (!edge) continue;
        boundaryEdges.push({ a: edge.a, b: edge.b, sideFaceId: makeId("f") });
    }

    return {
        faceIds,
        regionVertexIds,
        normal,
        center: centroidOfVertexIds(regionVertexIds, positions),
        newVertexIdByOld,
        topFaceIdByBase,
        boundaryEdges,
        initialSelection: snapshotSelection(selection),
    };
}

function snapshotPositions(snapshot: MeshSnapshot): Map<Id, Vec3> {
    const out = new Map<Id, Vec3>();
    for (const vertex of snapshot.vertices) out.set(vertex.id, { ...vertex.position });
    return out;
}

function orientFaceOutward(
    verts: Id[],
    positions: Map<Id, Vec3>,
    meshCentroid: Vec3
): Id[] {
    const face: Face = { id: "tmp" as Id, verts };
    const normal = polygonNormal(face, positions);
    const center = centroidOfVertexIds(verts, positions);
    const away = sub(center, meshCentroid);
    return dot(normal, away) >= 0 ? verts : [...verts].reverse();
}

function buildExtrudedSnapshot(before: MeshSnapshot, plan: ExtrudePlan, distance: number): MeshSnapshot {
    const offset = scale(plan.normal, distance);
    const outVertices = before.vertices.map((vertex) => ({
        id: vertex.id,
        position: { ...vertex.position },
    }));

    const basePositions = snapshotPositions(before);
    for (const oldId of plan.regionVertexIds) {
        const base = basePositions.get(oldId)!;
        outVertices.push({
            id: plan.newVertexIdByOld.get(oldId)!,
            position: add(base, offset),
        });
    }

    const outFaces = before.faces.map((face) => ({
        id: face.id,
        verts: [...face.verts],
    }));

    const allPositions = new Map<Id, Vec3>();
    for (const vertex of outVertices) allPositions.set(vertex.id, { ...vertex.position });
    const meshCentroid = centroidOfVertexIds(allPositions.keys(), allPositions);

    for (const face of before.faces) {
        if (!plan.topFaceIdByBase.has(face.id)) continue;
        const topVerts = face.verts.map((id) => plan.newVertexIdByOld.get(id)!);
        outFaces.push({
            id: plan.topFaceIdByBase.get(face.id)!,
            verts: orientFaceOutward(topVerts, allPositions, meshCentroid),
        });
    }

    for (const edge of plan.boundaryEdges) {
        const sideVerts = [
            edge.a,
            edge.b,
            plan.newVertexIdByOld.get(edge.b)!,
            plan.newVertexIdByOld.get(edge.a)!,
        ];
        outFaces.push({
            id: edge.sideFaceId,
            verts: orientFaceOutward(sideVerts, allPositions, meshCentroid),
        });
    }

    return {
        vertices: outVertices,
        faces: outFaces,
    };
}

function findEdgeIdByVertices(mesh: Mesh, a: Id, b: Id): Id | null {
    const key = edgeKey(a, b);
    for (const edge of mesh.getEdges()) {
        if (edgeKey(edge.a, edge.b) === key) return edge.id;
    }
    return null;
}

function buildAfterSelection(
    mesh: Mesh,
    selection: ReturnType<typeof makeSelection>,
    plan: ExtrudePlan,
    afterSnapshot: MeshSnapshot
): SelectionSnapshot {
    const afterSelection: SelectionSnapshot = { faceIds: [], edgeIds: [], vertexIds: [] };

    if (selection.mode === "face") {
        afterSelection.faceIds = plan.faceIds.map((id) => plan.topFaceIdByBase.get(id)!);
        return afterSelection;
    }

    if (selection.mode === "vertex") {
        afterSelection.vertexIds = Array.from(selection.vertexIds)
            .map((id) => plan.newVertexIdByOld.get(id))
            .filter((id): id is Id => !!id);
        return afterSelection;
    }

    const temp = new Mesh();
    temp.restore(afterSnapshot);
    for (const edgeId of selection.edgeIds) {
        const edge = mesh.getEdgeById(edgeId);
        const a = plan.newVertexIdByOld.get(edge.a);
        const b = plan.newVertexIdByOld.get(edge.b);
        if (!a || !b) continue;
        const next = findEdgeIdByVertices(temp, a, b);
        if (next) afterSelection.edgeIds.push(next);
    }
    return afterSelection;
}

export class ExtrudeController {
    private active = false;
    private lastDistance = 0;
    private beforeMesh: MeshSnapshot | null = null;
    private afterMesh: MeshSnapshot | null = null;
    private plan: ExtrudePlan | null = null;
    private dragPlane = new THREE.Plane();
    private startHit = new THREE.Vector3();
    private readonly raycaster = new THREE.Raycaster();
    private readonly ndc = new THREE.Vector2();
    private readonly hit = new THREE.Vector3();
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
        getPointerClientPos: () => { x: number; y: number },
        syncCameraForPicking: () => void,
        requestRenderSync: () => void,
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

    isActive(): boolean {
        return this.active;
    }

    beginFromKey(): void {
        if (this.active) return;

        const plan = buildExtrudePlan(this.mesh, this.selection);
        if (!plan) return;

        this.syncCameraForPicking();
        const camDir = new THREE.Vector3();
        (this.camera as any).getWorldDirection?.(camDir);
        if (camDir.lengthSq() < 1e-12) camDir.set(0, 0, -1);

        const axis = new THREE.Vector3(plan.normal.x, plan.normal.y, plan.normal.z);
        const n = new THREE.Vector3().crossVectors(axis, camDir);
        const fallback = Math.abs(axis.dot(new THREE.Vector3(0, 1, 0))) < 0.95
            ? new THREE.Vector3(0, 1, 0)
            : new THREE.Vector3(1, 0, 0);
        const nSafe = n.lengthSq() < 1e-8 ? fallback : n.normalize();
        const planeNormal = new THREE.Vector3().crossVectors(axis, nSafe).normalize();

        this.dragPlane.setFromNormalAndCoplanarPoint(
            planeNormal,
            new THREE.Vector3(plan.center.x, plan.center.y, plan.center.z),
        );
        if (!this.getMouseRayPointOnPlaneOrFallback(this.startHit)) return;

        this.plan = plan;
        this.beforeMesh = this.mesh.snapshot();
        this.afterMesh = this.beforeMesh;
        this.lastDistance = 0;
        this.active = true;
    }

    onPointerMove(): void {
        if (!this.active || !this.plan || !this.beforeMesh) return;

        this.syncCameraForPicking();
        if (!this.getMouseRayPointOnPlaneOrFallback(this.hit)) return;

        const delta = new THREE.Vector3().subVectors(this.hit, this.startHit);
        const distance = delta.dot(new THREE.Vector3(this.plan.normal.x, this.plan.normal.y, this.plan.normal.z));
        this.lastDistance = distance;
        this.afterMesh = buildExtrudedSnapshot(this.beforeMesh, this.plan, distance);
        this.mesh.restore(this.afterMesh);
        this.requestRenderSync();
    }

    cancel(): void {
        if (!this.active || !this.beforeMesh || !this.plan) return;
        this.mesh.restore(this.beforeMesh);
        this.requestRenderSync();
        this.reset();
    }

    commit(): void {
        if (!this.active || !this.beforeMesh || !this.afterMesh || !this.plan) return;

        if (Math.abs(this.lastDistance) <= 1e-4) {
            this.mesh.restore(this.beforeMesh);
            this.requestRenderSync();
            this.reset();
            return;
        }

        const beforeSelection = this.plan.initialSelection;
        const afterSelection = buildAfterSelection(this.mesh, this.selection, this.plan, this.afterMesh);
        this.commands.execute(
            this.cmdCtx,
            new ReplaceMeshCommand(
                this.mesh,
                this.beforeMesh,
                this.afterMesh,
                beforeSelection,
                afterSelection,
            ),
        );
        this.requestRenderSync();
        this.reset();
    }

    private reset(): void {
        this.active = false;
        this.lastDistance = 0;
        this.beforeMesh = null;
        this.afterMesh = null;
        this.plan = null;
    }

    private getMouseRayPointOnPlaneOrFallback(out: THREE.Vector3): boolean {
        const canvas = this.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const { x, y } = this.getPointerClientPos();

        this.ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
        this.ndc.y = -(((y - rect.top) / rect.height) * 2 - 1);
        this.raycaster.setFromCamera(this.ndc, this.camera as any);

        const ray = this.raycaster.ray;
        const hit = ray.intersectPlane(this.dragPlane, out);
        if (hit !== null) return true;

        ray.closestPointToPoint(new THREE.Vector3(this.plan?.center.x ?? 0, this.plan?.center.y ?? 0, this.plan?.center.z ?? 0), out);
        return true;
    }
}

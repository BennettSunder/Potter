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
    facePlanById: Map<Id, {
        normal: Vec3;
        newVertexIds: Id[];
        sideFaceIds: Id[];
    }>;
    initialSelection: SelectionSnapshot;
};

export function getExtrudePreview(
    mesh: Mesh,
    selection: ReturnType<typeof makeSelection>,
): { origin: Vec3; direction: Vec3 } | null {
    const plan = buildExtrudePlan(mesh, selection);
    if (!plan) return null;
    return {
        origin: plan.center,
        direction: plan.normal,
    };
}

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

    const facePlanById = new Map<Id, {
        normal: Vec3;
        newVertexIds: Id[];
        sideFaceIds: Id[];
    }>();
    for (const face of faces) {
        const faceNormal = normalize(polygonNormal(face, positions));
        facePlanById.set(face.id, {
            normal: length(faceNormal) < 1e-8 ? normal : faceNormal,
            newVertexIds: face.verts.map(() => makeId("v")),
            sideFaceIds: face.verts.map(() => makeId("f")),
        });
    }

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
        facePlanById,
        initialSelection: snapshotSelection(selection),
    };
}

function snapshotPositions(snapshot: MeshSnapshot): Map<Id, Vec3> {
    const out = new Map<Id, Vec3>();
    for (const vertex of snapshot.vertices) out.set(vertex.id, { ...vertex.position });
    return out;
}

function orientFaceTowardNormal(
    verts: Id[],
    positions: Map<Id, Vec3>,
    referenceNormal: Vec3,
): Id[] {
    const face: Face = { id: "tmp" as Id, verts, shading: "smooth" };
    const normal = polygonNormal(face, positions);
    return dot(normal, referenceNormal) >= 0 ? verts : [...verts].reverse();
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

    const selectedFaceIds = new Set(plan.faceIds);
    const outFaces = before.faces
        .filter((face) => !selectedFaceIds.has(face.id))
        .map((face) => ({
            id: face.id,
            verts: [...face.verts],
            shading: face.shading,
        }));

    const allPositions = new Map<Id, Vec3>();
    for (const vertex of outVertices) allPositions.set(vertex.id, { ...vertex.position });

    for (const face of before.faces) {
        if (!plan.topFaceIdByBase.has(face.id)) continue;
        const topVerts = face.verts.map((id) => plan.newVertexIdByOld.get(id)!);
        outFaces.push({
            id: plan.topFaceIdByBase.get(face.id)!,
            verts: orientFaceTowardNormal(topVerts, allPositions, plan.normal),
            shading: face.shading,
        });
    }

    for (const edge of plan.boundaryEdges) {
        const sideVerts = [
            edge.a,
            edge.b,
            plan.newVertexIdByOld.get(edge.b)!,
            plan.newVertexIdByOld.get(edge.a)!,
        ];
        const baseA = allPositions.get(edge.a)!;
        const baseB = allPositions.get(edge.b)!;
        const topA = allPositions.get(plan.newVertexIdByOld.get(edge.a)!)!;
        const offsetVec = sub(topA, baseA);
        const edgeVec = sub(baseB, baseA);
        const outward = {
            x: edgeVec.y * offsetVec.z - edgeVec.z * offsetVec.y,
            y: edgeVec.z * offsetVec.x - edgeVec.x * offsetVec.z,
            z: edgeVec.x * offsetVec.y - edgeVec.y * offsetVec.x,
        };
        outFaces.push({
            id: edge.sideFaceId,
            verts: orientFaceTowardNormal(sideVerts, allPositions, outward),
            shading: "smooth",
        });
    }

    return {
        vertices: outVertices,
        faces: outFaces,
    };
}

function buildExtrudedSnapshotIndividual(before: MeshSnapshot, plan: ExtrudePlan, distance: number): MeshSnapshot {
    const selectedFaceIds = new Set(plan.faceIds);
    const basePositions = snapshotPositions(before);
    const outVertices = before.vertices.map((vertex) => ({
        id: vertex.id,
        position: { ...vertex.position },
    }));
    const outFaces = before.faces
        .filter((face) => !selectedFaceIds.has(face.id))
        .map((face) => ({
            id: face.id,
            verts: [...face.verts],
            shading: face.shading,
        }));
    const allPositions = new Map<Id, Vec3>(basePositions);

    for (const face of before.faces) {
        const facePlan = plan.facePlanById.get(face.id);
        if (!facePlan) continue;

        const offset = scale(facePlan.normal, distance);
        const topVerts: Id[] = [];
        for (let i = 0; i < face.verts.length; i++) {
            const baseId = face.verts[i]!;
            const topId = facePlan.newVertexIds[i]!;
            const topPos = add(basePositions.get(baseId)!, offset);
            topVerts.push(topId);
            outVertices.push({ id: topId, position: topPos });
            allPositions.set(topId, topPos);
        }

        outFaces.push({
            id: plan.topFaceIdByBase.get(face.id)!,
            verts: orientFaceTowardNormal(topVerts, allPositions, facePlan.normal),
            shading: face.shading,
        });

        for (let i = 0; i < face.verts.length; i++) {
            const next = (i + 1) % face.verts.length;
            const baseA = face.verts[i]!;
            const baseB = face.verts[next]!;
            const topA = topVerts[i]!;
            const topB = topVerts[next]!;
            const sideVerts = [baseA, baseB, topB, topA];
            const edgeVec = sub(basePositions.get(baseB)!, basePositions.get(baseA)!);
            const outward = {
                x: edgeVec.y * offset.z - edgeVec.z * offset.y,
                y: edgeVec.z * offset.x - edgeVec.x * offset.z,
                z: edgeVec.x * offset.y - edgeVec.y * offset.x,
            };
            outFaces.push({
                id: facePlan.sideFaceIds[i]!,
                verts: orientFaceTowardNormal(sideVerts, allPositions, outward),
                shading: "smooth",
            });
        }
    }

    return {
        vertices: outVertices,
        faces: outFaces,
    };
}

type ExtrudeMode = "region" | "individual";

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
    private mode: ExtrudeMode = "region";
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
    private readonly setPreviewArrow: (opts: {
        origin: Vec3;
        direction: Vec3;
        length: number;
    }) => void;
    private readonly clearPreviewArrow: () => void;

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
        setPreviewArrow: (opts: {
            origin: Vec3;
            direction: Vec3;
            length: number;
        }) => void,
        clearPreviewArrow: () => void,
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
        this.setPreviewArrow = setPreviewArrow;
        this.clearPreviewArrow = clearPreviewArrow;
    }

    isActive(): boolean {
        return this.active;
    }

    toggleMode(): boolean {
        if (!this.active || !this.beforeMesh || !this.plan) return false;
        if (this.plan.initialSelection.faceIds.length === 0) return false;

        this.mode = this.mode === "region" ? "individual" : "region";
        this.afterMesh =
            this.mode === "individual"
                ? buildExtrudedSnapshotIndividual(this.beforeMesh, this.plan, this.lastDistance)
                : buildExtrudedSnapshot(this.beforeMesh, this.plan, this.lastDistance);
        this.mesh.restore(this.afterMesh);
        this.requestRenderSync();
        return true;
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
        this.mode = "region";
        this.lastDistance = 0;
        this.active = true;
        this.setPreviewArrow({
            origin: plan.center,
            direction: plan.normal,
            length: 0.3,
        });
    }

    onPointerMove(): void {
        if (!this.active || !this.plan || !this.beforeMesh) return;

        this.syncCameraForPicking();
        if (!this.getMouseRayPointOnPlaneOrFallback(this.hit)) return;

        const delta = new THREE.Vector3().subVectors(this.hit, this.startHit);
        const distance = delta.dot(new THREE.Vector3(this.plan.normal.x, this.plan.normal.y, this.plan.normal.z));
        this.lastDistance = distance;
        this.setPreviewArrow({
            origin: this.plan.center,
            direction: distance >= 0 ? this.plan.normal : scale(this.plan.normal, -1),
            length: Math.max(0.3, Math.abs(distance) + 0.12),
        });
        this.afterMesh =
            this.mode === "individual"
                ? buildExtrudedSnapshotIndividual(this.beforeMesh, this.plan, distance)
                : buildExtrudedSnapshot(this.beforeMesh, this.plan, distance);
        this.mesh.restore(this.afterMesh);
        this.requestRenderSync();
    }

    cancel(): void {
        if (!this.active || !this.beforeMesh || !this.plan) return;
        this.mesh.restore(this.beforeMesh);
        this.clearPreviewArrow();
        this.requestRenderSync();
        this.reset();
    }

    commit(): void {
        if (!this.active || !this.beforeMesh || !this.afterMesh || !this.plan) return;

        if (Math.abs(this.lastDistance) <= 1e-4) {
            this.mesh.restore(this.beforeMesh);
            this.clearPreviewArrow();
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
        this.clearPreviewArrow();
        this.requestRenderSync();
        this.reset();
    }

    private reset(): void {
        this.clearPreviewArrow();
        this.active = false;
        this.mode = "region";
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

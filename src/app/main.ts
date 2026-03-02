// src/app/main.ts
//
// App entry point (current MVP).
//
// Responsibilities (for now):
// - Mount UI shell
// - Create renderer + initial mesh
// - Own the Selection state (core/selection/selection)
// - Bind UI events (pointer picking, mode changes, gizmo capture) via ui/binding.ts
//
// IMPORTANT: UI code does not mutate mesh state directly.
// Selection changes are done via core/selection/selection helpers.
// (Later: transforms become Commands + undo/redo.)

import { mountAppShell, type EditorTool, type PrimitiveKind } from "../ui/appShell";
import { bindUI } from "../ui/bindings";
import { ThreeRenderer } from "../renderer/threeRenderer";
import {
    makeCubeMesh,
    makeIcosahedronMesh,
    makeTruncatedIcosahedronMesh,
    type Vec3,
    type Mesh,
} from "../core/mesh";
import {
    clearSelection,
    makeSelection,
    replaceEdges,
    replaceFaces,
    replaceVertices,
    setSelectionMode,
    toggleEdge,
    toggleFace,
    toggleVertex,
    type SelectionMode,
    snapshotSelection,
    applySelectionSnapshot,
    selectionSnapshotEquals,
    inferSelectionModeFromSelection,
} from "../core/selection/selection";
import type { PickHit } from "../renderer/picking";

import { CommandManager } from "../core/commands/commandManager";
import {
    SetSelectionCommand,
    type SelectionContext,
} from "../core/commands/selectionCommands/setSelectionCommand";
import { ReplaceMeshCommand } from "../core/commands/mesh/replaceMeshCommand";
import { MoveVerticesCommand } from "../core/commands/mesh/moveVerticesCommand";
import { RotateVerticesCommand } from "../core/commands/mesh/rotateVerticesCommand";
import { ScaleVerticesAxisCommand } from "../core/commands/mesh/scaleVerticesAxisCommand";
import { GrabController } from "./grabController";
import { RotateController } from "./rotateController";
import { ScaleController } from "./scaleController";
import { ExtrudeController } from "./extrudeController";
import { selectionToVertexIds } from "../core/selection/selectionToVertexIds";
import type { Id } from "../core/ids/ids";
import type { GizmoAxis, GizmoMode } from "../renderer/gizmos";

// --------------------
// Formatting utilities
// --------------------

function fmtNum(n: number): string {
    // Keeps output tidy (avoids "-0")
    const v = Math.abs(n) < 1e-9 ? 0 : n;
    return String(v);
}

function fmtVec3(p: Vec3): string {
    return `(${fmtNum(p.x)}, ${fmtNum(p.y)}, ${fmtNum(p.z)})`;
}

function formatSelectionText(sel: ReturnType<typeof makeSelection>, mesh: Mesh): string {
    if (sel.mode === "face") {
        const n = sel.faceIds.size;
        return n ? `mode: face (${n})` : "mode: face (none)";
    }

    if (sel.mode === "edge") {
        const n = sel.edgeIds.size;
        return n ? `mode: edge (${n})` : "mode: edge (none)";
    }

    // vertex mode: list vertex positions for selected vertex IDs
    const n = sel.vertexIds.size;
    if (!n) return "mode: vertex (none)";

    const verts = mesh.getVertices();

    const parts: string[] = [];
    for (const vId of sel.vertexIds) {
        try {
            const i = mesh.getVertexIndex(vId);
            const p = verts[i]?.position;
            if (p) parts.push(fmtVec3(p));
        } catch {
            // If an ID is invalid for some reason, skip it (shouldn't happen in normal use)
        }
    }

    const list = parts.length ? parts.join(", ") : "(invalid ids)";
    return `mode: vertex (${n}) ${list}`;
}

function centroidOfVertexIds(mesh: Mesh, vertexIds: readonly Id[]): Vec3 {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    const n = vertexIds.length || 1;

    for (const id of vertexIds) {
        const p = mesh.getVertexPosition(id);
        sx += p.x;
        sy += p.y;
        sz += p.z;
    }

    return { x: sx / n, y: sy / n, z: sz / n };
}

function axisVec(axis: GizmoAxis): Vec3 {
    if (axis === "x") return { x: 1, y: 0, z: 0 };
    if (axis === "y") return { x: 0, y: 1, z: 0 };
    return { x: 0, y: 0, z: 1 };
}

function normalizeVec(v: Vec3): Vec3 {
    const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (len < 1e-8) return { x: 0, y: 0, z: 1 };
    return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function rotateAroundAxis(pos: Vec3, center: Vec3, axis: Vec3, angle: number): Vec3 {
    const unit = normalizeVec(axis);
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

function scaleAlongAxis(pos: Vec3, center: Vec3, axis: Vec3, factor: number): Vec3 {
    const unit = normalizeVec(axis);
    const rel = { x: pos.x - center.x, y: pos.y - center.y, z: pos.z - center.z };
    const dot = rel.x * unit.x + rel.y * unit.y + rel.z * unit.z;
    const parallel = { x: unit.x * dot, y: unit.y * dot, z: unit.z * dot };
    const perp = { x: rel.x - parallel.x, y: rel.y - parallel.y, z: rel.z - parallel.z };

    return {
        x: center.x + perp.x + parallel.x * factor,
        y: center.y + perp.y + parallel.y * factor,
        z: center.z + perp.z + parallel.z * factor,
    };
}

// --------------------
// App boot
// --------------------

export function startApp(): void {
    const root = document.querySelector<HTMLDivElement>("#app");
    if (!root) throw new Error("Missing #app");

    const ui = mountAppShell(root);
    const renderer = new ThreeRenderer(ui.canvas);

    // Use the same canvas the renderer is using
    const canvas = ui.canvas;

    // Core mesh (polygons); renderer triangulates for display/picking
    const mesh = makeCubeMesh();
    renderer.setMesh(mesh);

    // Selection state lives in core
    const selection = makeSelection();
    let mode: SelectionMode = selection.mode;
    let activeTool: EditorTool = "select";
    let suppressNextSelectionPointerDown = false;
    const gizmoSession = {
        active: false,
        mode: "translate" as GizmoMode,
        vertexIds: [] as Id[],
        center: { x: 0, y: 0, z: 0 } as Vec3,
        axis: "x" as GizmoAxis,
        angle: 0,
        factor: 1,
        lastDelta: { x: 0, y: 0, z: 0 } as Vec3,
        basePositions: new Map<Id, Vec3>(),
    };

    // Undo/redo manager (selection-only for now)
    const commands = new CommandManager<SelectionContext>();
    const cmdCtx: SelectionContext = { selection };

    renderer.setDisplayMode(mode);
    ui.setSelectionText(formatSelectionText(selection, mesh));

    const syncUI = () => ui.setSelectionText(formatSelectionText(selection, mesh));

    const syncSelectionOverlays = () => {
        renderer.setSelectedFaces(selection.faceIds);
        renderer.setSelectedEdges(selection.edgeIds);
        renderer.setSelectedVertices(selection.vertexIds);
    };

    const syncActiveGizmo = () => {
        const hasSelection = selectionToVertexIds(mesh, selection).length > 0;
        const isModalActive = !!grab?.isActive() || !!rotate?.isActive() || !!scale?.isActive() || !!extrude?.isActive();
        const supportsGizmo = activeTool === "move" || activeTool === "rotate" || activeTool === "scale";
        const shouldShow = supportsGizmo && hasSelection && !isModalActive;
        const gizmoMode: GizmoMode =
            activeTool === "move" ? "translate" : activeTool === "rotate" ? "rotate" : "scale";

        renderer.setGizmoMode(gizmoMode);
        renderer.setGizmoActive(shouldShow);
    };

    const syncMeshToRenderer = () => {
        // Rebuild render buffers after mesh edits (command commits, topology changes, etc.)
        renderer.setMesh(mesh);

        // Keep selection overlays consistent after rebuild
        syncSelectionOverlays();
        syncActiveGizmo();
        syncUI();
    };

    const makePrimitiveMesh = (kind: PrimitiveKind): Mesh => {
        if (kind === "icosahedron") return makeIcosahedronMesh();
        if (kind === "truncatedIcosahedron") return makeTruncatedIcosahedronMesh();
        return makeCubeMesh();
    };

    /**
     * Commit-time mesh sync:
     * - During grab preview we only update renderer buffers in-place.
     * - We rebuild render data once on commit after core mesh changes.
     */
    const requestRenderSync = () => {
        syncMeshToRenderer();
    };

    const applyModeFromSelectionIfNeeded = () => {
        const inferred = inferSelectionModeFromSelection(selection);
        if (!inferred) return; // keep current mode when nothing selected
        if (inferred === mode) return;

        mode = inferred;

        // IMPORTANT: do NOT call setSelectionMode here (it clears selection).
        // We only change how we interpret/display picks + how overlays render.
        renderer.setDisplayMode(mode);

        // Requires ui.setMode(mode) to be added to the AppShell API
        ui.setMode(mode);
    };

    const applySelectionUpdate = (
        updater: (temp: ReturnType<typeof makeSelection>) => boolean | void,
    ) => {
        if (grab?.isActive() || rotate?.isActive() || scale?.isActive() || extrude?.isActive()) return;

        const before = snapshotSelection(selection);

        const temp = makeSelection();
        setSelectionMode(temp, mode);
        applySelectionSnapshot(temp, before);

        const changed = updater(temp);
        if (changed === false) return;

        const after = snapshotSelection(temp);
        if (selectionSnapshotEquals(before, after)) return;

        commands.execute(cmdCtx, new SetSelectionCommand(before, after));
        syncSelectionOverlays();
        syncActiveGizmo();
        syncUI();
    };

    const setActiveTool = (tool: EditorTool) => {
        if (activeTool === tool) return;
        activeTool = tool;
        ui.setTool(tool);
        syncActiveGizmo();
    };

    syncSelectionOverlays();

    // --------------------
    // Pointer tracking (for Grab)
    // --------------------

    // Local pointer state (screen/client coords). Avoid globals.
    let lastClientX = 0;
    let lastClientY = 0;
    let hasPointer = false;

    const updatePointer = (e: PointerEvent) => {
        lastClientX = e.clientX;
        lastClientY = e.clientY;
        hasPointer = true;
    };

    const getPointerClientPos = () => {
        if (hasPointer) return { x: lastClientX, y: lastClientY };

        // fallback: canvas center before any pointer activity
        const rect = canvas.getBoundingClientRect();
        return { x: rect.left + rect.width * 0.5, y: rect.top + rect.height * 0.5 };
    };

    // Track pointer position on window so it stays valid even if pointer leaves canvas.
    window.addEventListener("pointerup", updatePointer, { capture: true });


    // --------------------
    // Grab (G) controller
    // --------------------

    // GrabController needs a camera. Prefer an explicit getter on the renderer,
    // but allow fallback to a public field if that's what you have today.
    const camera =
    (renderer as any).getCamera?.() ??
    (renderer as any).camera ??
    undefined;

    const syncCameraForPicking = () => {
        (renderer as any).forceCameraUpdate?.();
        // Safety: even if renderer doesn't expose forceCameraUpdate, ensure matrices are fresh.
        if (camera) {
            camera.updateMatrixWorld(true);
            (camera as any).updateProjectionMatrix?.();
        }
    };

    const grab = camera
    ? new GrabController(
        mesh,
        selection,
        commands,
        cmdCtx,
        camera,
        () => canvas,
            getPointerClientPos,
            syncCameraForPicking,
            requestRenderSync,
            (vertexIds) => renderer.beginVertexPositionPreview(vertexIds),
            (delta) => renderer.applyVertexPositionPreview(delta),
            (opts) => renderer.endVertexPositionPreview(opts)
    )
    : null;

    const scale = camera
    ? new ScaleController(
        mesh,
        selection,
        commands,
        cmdCtx,
        camera,
        () => canvas,
        getPointerClientPos,
        syncCameraForPicking,
        requestRenderSync,
        (vertexIds) => renderer.beginVertexPositionPreview(vertexIds),
        (positions) => renderer.applyVertexPositionsPreview(positions),
        (opts) => renderer.endVertexPositionPreview(opts)
    )
    : null;

    const rotate = camera
    ? new RotateController(
        mesh,
        selection,
        commands,
        cmdCtx,
        camera,
        () => canvas,
        getPointerClientPos,
        syncCameraForPicking,
        requestRenderSync,
        (vertexIds) => renderer.beginVertexPositionPreview(vertexIds),
        (positions) => renderer.applyVertexPositionsPreview(positions),
        (opts) => renderer.endVertexPositionPreview(opts)
    )
    : null;

    const extrude = camera
    ? new ExtrudeController(
        mesh,
        selection,
        commands,
        cmdCtx,
        camera,
        () => canvas,
        getPointerClientPos,
        syncCameraForPicking,
        requestRenderSync,
    )
    : null;

    // While grabbing: pointermove should drive preview updates.
    // NOTE: GrabController reads pointer via getPointerClientPos(), not event args.
    const beginMoveTool = () => {
        if (!grab || rotate?.isActive() || scale?.isActive()) return false;

        syncCameraForPicking();
        grab.beginFromKey();
        if (grab.isActive()) setActiveTool("move");
        return grab.isActive();
    };

    const beginScaleTool = () => {
        if (!scale || grab?.isActive() || rotate?.isActive()) return false;

        syncCameraForPicking();
        scale.beginFromKey();
        if (scale.isActive()) setActiveTool("scale");
        return scale.isActive();
    };

    const beginRotateTool = () => {
        if (!rotate || grab?.isActive() || scale?.isActive()) return false;

        syncCameraForPicking();
        rotate.beginFromKey();
        if (rotate.isActive()) setActiveTool("rotate");
        return rotate.isActive();
    };

    const beginExtrudeTool = () => {
        if (!extrude || grab?.isActive() || rotate?.isActive() || scale?.isActive()) return false;

        syncCameraForPicking();
        extrude.beginFromKey();
        if (extrude.isActive()) setActiveTool("extrude");
        return extrude.isActive();
    };

    const getActiveTransform = () =>
        grab?.isActive() ? grab :
        rotate?.isActive() ? rotate :
        scale?.isActive() ? scale :
        extrude?.isActive() ? extrude :
        null;

    const commitActiveTransform = () => {
        const current = getActiveTransform();
        if (!current) return;
        current.commit();
        syncActiveGizmo();
    };

    const cancelActiveTransform = () => {
        const current = getActiveTransform();
        if (!current) return;
        current.cancel();
        syncActiveGizmo();
    };

    window.addEventListener(
        "pointermove",
        (e) => {
            updatePointer(e);
            if (grab?.isActive()) grab.onPointerMove();
            if (rotate?.isActive()) rotate.onPointerMove();
            if (scale?.isActive()) scale.onPointerMove();
            if (extrude?.isActive()) extrude.onPointerMove();
        },
        { capture: true }
    );

    window.addEventListener(
        "pointerup",
        (e) => {
            updatePointer(e);

            const activeTool = getActiveTransform();
            if (!activeTool) return;

            if (e.button === 0) {
                e.preventDefault();
                suppressNextSelectionPointerDown = e.target === canvas;
                commitActiveTransform();
            } else if (e.button === 2) {
                e.preventDefault();
                cancelActiveTransform();
            }
        },
        { capture: true }
    );


    // Prevent context menu while grabbing (right click = cancel)
    window.addEventListener("contextmenu", (e) => {
        if (grab?.isActive() || rotate?.isActive() || scale?.isActive() || extrude?.isActive()) e.preventDefault();
    });

        // --------------------
        // Keyboard shortcuts
        // --------------------

        const isMac = () => navigator.platform.toLowerCase().includes("mac");

        window.addEventListener("keydown", (e) => {
            // If grab mode is active, Esc/Enter should work regardless of modifiers.
            const activeTool = getActiveTransform();
            if (activeTool) {
                const k = e.key.toLowerCase();
                if (k === "escape") {
                    e.preventDefault();
                    cancelActiveTransform();
                    return;
                }
                if (k === "enter") {
                    e.preventDefault();
                    commitActiveTransform();
                    return;
                }
            }

            // Start grab with G (when there is a selection)
            if ((e.key === "g" || e.key === "G") && grab) {
                // Avoid typing 'g' into text fields
                const tag = (e.target as HTMLElement | null)?.tagName ?? "";
                if (tag === "INPUT" || tag === "TEXTAREA") return;

                // Ensure camera state is fresh right at grab start.
                e.preventDefault();
                beginMoveTool();
                return;
            }

            if ((e.key === "r" || e.key === "R") && rotate) {
                const tag = (e.target as HTMLElement | null)?.tagName ?? "";
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                if (grab?.isActive() || scale?.isActive()) return;

                e.preventDefault();
                beginRotateTool();
                return;
            }

            if ((e.key === "s" || e.key === "S") && scale) {
                const tag = (e.target as HTMLElement | null)?.tagName ?? "";
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                if (grab?.isActive() || rotate?.isActive() || extrude?.isActive()) return;

                e.preventDefault();
                beginScaleTool();
                return;
            }

            if ((e.key === "e" || e.key === "E") && extrude) {
                const tag = (e.target as HTMLElement | null)?.tagName ?? "";
                if (tag === "INPUT" || tag === "TEXTAREA") return;
                if (grab?.isActive() || rotate?.isActive() || scale?.isActive()) return;

                e.preventDefault();
                beginExtrudeTool();
                return;
            }

            // Selection undo/redo
            const mod = isMac() ? e.metaKey : e.ctrlKey;
            if (!mod) return;

            const key = e.key.toLowerCase();

            if (key === "z" && !e.shiftKey) {
                e.preventDefault();
                commands.undo(cmdCtx);
                applyModeFromSelectionIfNeeded();
                syncMeshToRenderer();
                syncActiveGizmo();
                return;
            }

            if ((key === "z" && e.shiftKey) || key === "y") {
                e.preventDefault();
                commands.redo(cmdCtx);
                applyModeFromSelectionIfNeeded();
                syncMeshToRenderer();
                syncActiveGizmo();
            }
        });

        // UI radio buttons -> selection mode change
        ui.onModeChange((m) => {
            mode = m;
            setSelectionMode(selection, m);

            renderer.setDisplayMode(m);
            renderer.forceCameraUpdate();

            // Core clears selection on mode change; reflect it.
            syncSelectionOverlays();
            syncActiveGizmo();
            syncUI();
        });

        ui.onToolChange((tool) => {
            if (tool === "select") {
                cancelActiveTransform();
                setActiveTool("select");
                return;
            }

            if (tool === "move") {
                if (rotate?.isActive() || scale?.isActive() || extrude?.isActive()) cancelActiveTransform();
                setActiveTool("move");
                return;
            }

            if (tool === "rotate") {
                if (grab?.isActive() || scale?.isActive() || extrude?.isActive()) cancelActiveTransform();
                setActiveTool("rotate");
                return;
            }

            if (tool === "scale") {
                if (grab?.isActive() || rotate?.isActive() || extrude?.isActive()) cancelActiveTransform();
                setActiveTool("scale");
                return;
            }

            if (grab?.isActive() || rotate?.isActive() || scale?.isActive()) cancelActiveTransform();
            setActiveTool("extrude");
            beginExtrudeTool();
        });

        ui.onPrimitiveSwap((kind) => {
            cancelActiveTransform();

            const beforeMesh = mesh.snapshot();
            const afterMesh = makePrimitiveMesh(kind).snapshot();
            const beforeSelection = snapshotSelection(selection);
            const afterSelection = { faceIds: [], edgeIds: [], vertexIds: [] };

            commands.execute(
                cmdCtx,
                new ReplaceMeshCommand(
                    mesh,
                    beforeMesh,
                    afterMesh,
                    beforeSelection,
                    afterSelection,
                ),
            );

            syncMeshToRenderer();
            syncActiveGizmo();
        });

        renderer.onGizmoDrag((e) => {
            if (!gizmoSession.active) return;

            gizmoSession.axis = e.axis;
            if (e.mode === "translate") {
                gizmoSession.lastDelta = {
                    x: e.deltaWorld.x,
                    y: e.deltaWorld.y,
                    z: e.deltaWorld.z,
                };
                renderer.applyVertexPositionPreview(gizmoSession.lastDelta);
                return;
            }

            if (e.mode === "rotate") {
                gizmoSession.angle = e.angle;
                const axis = axisVec(e.axis);
                const preview = new Map<Id, Vec3>();
                for (const [id, pos] of gizmoSession.basePositions.entries()) {
                    preview.set(id, rotateAroundAxis(pos, gizmoSession.center, axis, e.angle));
                }
                renderer.applyVertexPositionsPreview(preview);
                return;
            }

            gizmoSession.factor = e.factor;
            const axis = axisVec(e.axis);
            const preview = new Map<Id, Vec3>();
            for (const [id, pos] of gizmoSession.basePositions.entries()) {
                preview.set(id, scaleAlongAxis(pos, gizmoSession.center, axis, e.factor));
            }
            renderer.applyVertexPositionsPreview(preview);
        });

        renderer.onGizmoModalTrigger((e) => {
            if (e.mode === "translate") {
                beginMoveTool();
                return;
            }
            if (e.mode === "rotate") {
                beginRotateTool();
                return;
            }
            beginScaleTool();
        });

        // Pointer picking + gizmo capture lives in ui/binding.ts now
        bindUI({
            shell: ui,
            renderer,
            mesh,
            getMode: () => mode,
            shouldSuppressPointerDown: () => {
                if (getActiveTransform()) return true;
                if (!suppressNextSelectionPointerDown) return false;
                suppressNextSelectionPointerDown = false;
                return true;
            },

               onPick: (hit: PickHit | null, additive: boolean) => {
                   applySelectionUpdate((temp) => {
                       if (!hit) {
                           if (!additive) clearSelection(temp);
                           else return false;
                           return;
                       }

                       if (mode === "face") {
                           if (additive) toggleFace(temp, hit.id);
                           else replaceFaces(temp, [hit.id]);
                           return;
                       }

                       if (mode === "edge") {
                           if (additive) toggleEdge(temp, hit.id);
                           else replaceEdges(temp, [hit.id]);
                           return;
                       }

                       if (additive) toggleVertex(temp, hit.id);
                       else replaceVertices(temp, [hit.id]);
                   });
               },

               onBoxPick: (ids, boxMode, additive) => {
                   applySelectionUpdate((temp) => {
                       if (boxMode === "face") {
                           if (additive) {
                               for (const id of ids) toggleFace(temp, id);
                           } else {
                               replaceFaces(temp, ids);
                           }
                           return;
                       }

                       if (boxMode === "edge") {
                           if (additive) {
                               for (const id of ids) toggleEdge(temp, id);
                           } else {
                               replaceEdges(temp, ids);
                           }
                           return;
                       }

                       if (additive) {
                           for (const id of ids) toggleVertex(temp, id);
                       } else {
                           replaceVertices(temp, ids);
                       }
                   });
               },

               onGizmoCaptureChange: (captured) => {
                   if (captured) {
                       const vertexIds = selectionToVertexIds(mesh, selection);
                       if (vertexIds.length === 0) return;

                       gizmoSession.active = true;
                       gizmoSession.mode =
                           activeTool === "rotate" ? "rotate" : activeTool === "scale" ? "scale" : "translate";
                       gizmoSession.vertexIds = vertexIds;
                       gizmoSession.center = centroidOfVertexIds(mesh, vertexIds);
                       gizmoSession.axis = "x";
                       gizmoSession.angle = 0;
                       gizmoSession.factor = 1;
                       gizmoSession.lastDelta = { x: 0, y: 0, z: 0 };
                       gizmoSession.basePositions = new Map<Id, Vec3>();
                       for (const id of vertexIds) {
                           const p = mesh.getVertexPosition(id);
                           gizmoSession.basePositions.set(id, { x: p.x, y: p.y, z: p.z });
                       }
                       renderer.beginVertexPositionPreview(vertexIds);
                       return;
                   }

                   if (!gizmoSession.active) return;

                   const d = gizmoSession.lastDelta;
                   const moved = Math.abs(d.x) > 1e-8 || Math.abs(d.y) > 1e-8 || Math.abs(d.z) > 1e-8;
                   const rotated = Math.abs(gizmoSession.angle) > 1e-4;
                   const scaled = Math.abs(gizmoSession.factor - 1) > 1e-4;

                   if (gizmoSession.mode === "translate" && moved) {
                       renderer.endVertexPositionPreview({ commit: true });
                       commands.execute(
                           cmdCtx,
                           new MoveVerticesCommand(mesh, gizmoSession.vertexIds, d),
                       );
                       syncMeshToRenderer();
                   } else if (gizmoSession.mode === "rotate" && rotated) {
                       renderer.endVertexPositionPreview({ commit: true });
                       commands.execute(
                           cmdCtx,
                           new RotateVerticesCommand(
                               mesh,
                               gizmoSession.vertexIds,
                               gizmoSession.center,
                               axisVec(gizmoSession.axis),
                               gizmoSession.angle,
                           ),
                       );
                       syncMeshToRenderer();
                   } else if (gizmoSession.mode === "scale" && scaled) {
                       renderer.endVertexPositionPreview({ commit: true });
                       commands.execute(
                           cmdCtx,
                           new ScaleVerticesAxisCommand(
                               mesh,
                               gizmoSession.vertexIds,
                               gizmoSession.center,
                               axisVec(gizmoSession.axis),
                               gizmoSession.factor,
                           ),
                       );
                       syncMeshToRenderer();
                   } else {
                       renderer.endVertexPositionPreview({ commit: false });
                   }

                   gizmoSession.active = false;
                   gizmoSession.vertexIds = [];
                   gizmoSession.basePositions.clear();
                   gizmoSession.lastDelta = { x: 0, y: 0, z: 0 };
                   gizmoSession.angle = 0;
                   gizmoSession.factor = 1;
                   syncActiveGizmo();
               },
        });

        syncActiveGizmo();
        renderer.start();
}

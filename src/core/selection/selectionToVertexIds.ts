import type { Id } from "../ids/ids";
import type { Mesh } from "../mesh";
import { makeSelection } from "./selection";

export function selectionToVertexIds(
    mesh: Mesh,
    sel: ReturnType<typeof makeSelection>
): Id[] {
    const out = new Set<Id>();

    if (sel.mode === "face") {
        for (const faceId of sel.faceIds) {
            const f = mesh.getFaceById(faceId);
            out.add(f.verts[0]);
            out.add(f.verts[1]);
            out.add(f.verts[2]);
        }
        return [...out];
    }

    if (sel.mode === "vertex") {
        for (const vId of sel.vertexIds) {
            out.add(vId);
        }
        return [...out];
    }

    if (sel.mode === "edge") {
        for (const edgeId of sel.edgeIds) {
            const e = mesh.getEdgeById(edgeId); // <-- YOU MUST HAVE THIS
            out.add(e.a);
            out.add(e.b);
        }
        return [...out];
    }

    return [];
}

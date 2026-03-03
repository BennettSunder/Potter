# Potter

Potter is a small, polygon‑based 3D modeling tool inspired by classic low‑poly / OBJ‑style workflows. It is intentionally scoped to focus on **mesh editing fundamentals** (selection, transforms, export) while being architected in a way that does **not paint the project into a corner** as it grows.

The goal is not to recreate Blender, but to build a clean, understandable modeling core that can scale in power without collapsing under technical debt.

---

## Project Now (Current State)

### What Potter is today

- A **TypeScript + Three.js** application built with **Vite**
- Runs as a **browser‑first web app**
- Designed from day one to later ship as a **desktop app** via **Tauri** (preferred) or Electron
- Deliberate separation between:
  - Core modeling logic (pure, renderer‑agnostic)
  - Rendering layer (Three.js)
  - UI / application shell

The current focus is **correctness, architecture, and maintainability**, not feature count.

---

### Current capabilities

- Render a basic polygon mesh (currently simple primitives)
- Orbit camera with clean scene setup
- **Face, edge, and vertex selection modes**
- Click selection with **Shift multi‑selection**
- Drag-box marquee selection
- `Ctrl+Alt` + left-drag camera panning and `Ctrl+Alt+Shift` + left-drag camera rotation for laptop-friendly navigation
- Visual highlighting for selected components
- Move / rotate / scale tools with gizmos and keyboard shortcuts
- Keyboard-started actions preserve the currently selected toolbar tool
- Keyboard-started modal transforms can continue dragging past the viewport edge
- Extrusion along the average selected face normal, with a clickable on-mesh extrude arrow and an individual-face mode toggle during active extrusion
- Modal per-face inset with live preview, left-click confirm, and right-click cancel
- First-pass knife tool for single-face two-click cuts
- Face subdivision that stitches neighboring faces instead of leaving split boundaries disconnected
- Smooth selected vertices / regions
- Face normal flipping
- Per-face smooth or flat shading with matching OBJ export smoothing
- Topology deletion for selected faces / edges / vertices
- Vertex merge to average position
- Right-click context menu for selection modes and edit actions
- Top-right hamburger menu with OBJ import/export and a `Yes / No / Cancel` save-before-import prompt
- Select-all and invert-selection shortcuts by current selection mode
- Undo / redo for the current editing command set
- Stable ID‑based mesh representation  
  (selection and identity are not tied to array indices)
- Centralized numeric tolerances  
  (pick radii, epsilons, screen‑space thresholds)
- Picking system that returns:
  ```ts
  { type, id, depth, worldPos }
  ```

---

### Current architecture

**Core (pure logic, no rendering dependencies)**
- Mesh data structures
- Stable ID generation
- Selection model (face / edge / vertex)
- Centralized numeric tolerances

**Renderer**
- Converts mesh data into render buffers
- Maps render hits back to stable IDs
- Handles visual overlays for selection
- Does *not* own or mutate mesh state

**App / UI Shell**
- DOM creation and layout
- Tool and mode controls
- Input handling and event wiring

> UI code never mutates mesh data directly.  
> All edits flow through explicit core logic.

---

### Tooling

- TypeScript (strict mode)
- Vite (dev server + build)
- Three.js (rendering)

Dependencies are intentionally kept minimal.

---

## Project Direction (Future Plans & Goals)

Potter is developed using **small, vertical slices**.  
Nothing below is assumed to exist yet — this is the roadmap, not the current state.

---

### Planned near‑term features

- **Command system with undo / redo**
  - No full mesh snapshots
  - Commands store minimal deltas:
    - created IDs
    - deleted IDs
    - prior values

- **Transform tools**
  - Move / rotate / scale
  - Object‑level first, component‑level later

- **Project save / load**
  - `project.json` with explicit versioning
  - Mesh data, transforms, materials, projection settings

- **OBJ export**
  - Export current mesh state
  - Optional MTL generation

---

### Medium‑term goals

- Robust multi‑object support
- Cached or derived adjacency data
- Simple texture projection modes:
  - Planar
  - Box
  - Triplanar

---

### Explicit non‑goals (for now)

These features are intentionally out of scope until the core is solid:

- Animation or rigging
- Boolean operations
- Bevels, loop cuts, subdivision
- Full UV unwrapping / UV editor
- Writing a custom low‑level renderer from scratch

---

### Desktop distribution (future)

Potter is designed to ship as:

- A browser application
- The same build wrapped via:
  - **Tauri** (preferred)
  - or **Electron**

Desktop support will primarily add:
- File system access
- Native menus and shortcuts
- Drag & drop import/export

The modeling core will remain unchanged.

---

## Philosophy

Potter is built around a few guiding principles:

- **Identity is not storage**  
  Stable IDs are not array indices

- **UI is not state**  
  UI triggers logic; it does not own data

- **Vertical slices over horizontal systems**

- **Future‑proofing through structure, not premature features**

This project values clarity, debuggability, and learning just as much as raw capability.

---

## Status

Potter is early‑stage and evolving rapidly.  
Breaking changes are expected while the architecture solidifies.

This README reflects both the **current implementation** and the **intended direction** of the project.

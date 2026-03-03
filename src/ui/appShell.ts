import type { SelectionMode } from "../core/selection/selection";
export type PrimitiveKind = "cube" | "icosahedron" | "truncatedIcosahedron";
export type EditorTool = "select" | "move" | "rotate" | "scale" | "extrude";
export type ContextMenuItem = {
    id: string;
    label?: string;
    disabled?: boolean;
    separator?: boolean;
};

const APP_SHELL_CSS_ID = "potter-app-shell-css";

function ensureAppShellStyles() {
    if (document.getElementById(APP_SHELL_CSS_ID)) return;

    const style = document.createElement("style");
    style.id = APP_SHELL_CSS_ID;
    style.textContent = /*css*/ `
    .potter-root {
        position: fixed;
        inset: 0;
        display: flex;
    }

    .potter-panel {
        max-width: 260px;
        border: 1px solid #333;
        padding: 12px;
        color: #ddd;
        font-family: sans-serif;
        background: #0008;
        position: absolute;
        left: 0px;
        margin: 5px;
        border-radius: 5px;
    }

    .potter-section {
        margin-top: 12px;
    }

    .potter-label {
        font-size: 12px;
        opacity: 0.9;
        margin-bottom: 6px;
    }

    /* Icon toggle row */
    .potter-tool-row {
        display: flex;
        gap: 8px;
        align-items: center;
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        top: 6px;
        margin: 0;
        z-index: 10;
        color: #ddd;

    }

    .potter-editor-tool-column {
        display: flex;
        flex-direction: column;
        gap: 8px;
        align-items: center;
        position: absolute;
        left: 6px;
        top: 50%;
        transform: translateY(-50%);
        margin: 0;
        z-index: 10;
        color: #ddd;
    }

    .potter-tool {
        display: inline-flex;
        position: relative;
    }

    .potter-tool input {
        position: absolute;
        opacity: 0;
        pointer-events: none;
    }

    .potter-tool-btn {
        width: 30px;
        height: 30px;
        border-radius: 6px;
        border: 1px solid #333;
        background: #111a;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: border-color 120ms, background 120ms, transform 120ms;
        user-select: none;
    }

    .potter-tool-btn:hover {
        border-color: #666;
        background: #1a1a;
    }

    .potter-tool input:focus-visible + .potter-tool-btn {
        outline: 2px solid #888;
        outline-offset: 2px;
    }

    .potter-tool input:checked + .potter-tool-btn {
        border-color: #9aa0ff;
        background: #2a2a55aa;
    }

    .potter-tool-btn svg {
        width: 16px;
        height: 16px;
        display: block;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        opacity: 0.9;
    }

    .potter-tool input:checked + .potter-tool-btn svg {
        opacity: 1;
    }

    .potter-tool input:disabled + .potter-tool-btn {
        opacity: 0.35;
        cursor: not-allowed;
        filter: grayscale(1);
    }

    .potter-divider {
        border: none;
        border-top: 1px solid #333;
        margin: 12px 0;
    }

    .potter-shape-row {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
        margin-top: 8px;
    }

    .potter-shape-btn {
        border: 1px solid #333;
        background: #111a;
        color: #ddd;
        border-radius: 6px;
        width: 32px;
        height: 32px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .potter-shape-btn img {
        width: 18px;
        height: 18px;
        display: block;
        filter: brightness(0) invert(1);
        opacity: 0.95;
    }

    .potter-shape-btn:hover {
        border-color: #666;
        background: #1a1a;
    }

    .potter-selection-title {
        font-size: 12px;
        opacity: 0.9;
    }

    .potter-selection-text {
        font-size: 12px;
        margin-top: 6px;
        word-break: break-all;
        opacity: 0.85;
    }

    .potter-viewport-wrap {
        flex: 1;
        position: absolute;
        z-index: -100;
        width: 100vw;
        height: 100vh;
    }

    .potter-viewport {
        width: 100%;
        height: 100%;
        display: block;
    }

    .potter-context-menu {
        position: fixed;
        min-width: 150px;
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: rgba(18, 18, 18, 0.96);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(12px);
        z-index: 50;
        display: none;
        max-width: 300px;
    }

    .potter-context-menu[data-open="true"] {
        display: block;
    }

    .potter-context-menu-btn {
        width: 100%;
        border: 0;
        background: transparent;
        color: #f3f3f3;
        text-align: left;
        font: inherit;
        padding: 8px 10px;
        border-radius: 7px;
        cursor: pointer;
    }

    .potter-context-menu-btn:hover {
        background: rgba(255, 255, 255, 0.08);
    }

    .potter-context-menu-btn:disabled {
        color: rgba(255, 255, 255, 0.38);
        cursor: default;
    }

    .potter-context-menu-btn:disabled:hover {
        background: transparent;
    }

    .potter-context-menu-separator {
        height: 1px;
        border: 0;
        margin: 6px 2px;
        background: rgba(255, 255, 255, 0.12);
    }

    .potter-app-menu-anchor {
        position: absolute;
        top: 6px;
        right: 6px;
        z-index: 12;
    }

    .potter-app-menu-btn {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        border: 1px solid #333;
        background: #111a;
        color: #ddd;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: border-color 120ms, background 120ms;
    }

    .potter-app-menu-btn:hover {
        border-color: #666;
        background: #1a1a;
    }

    .potter-app-menu-btn svg {
        width: 16px;
        height: 16px;
        display: block;
        fill: none;
        stroke: currentColor;
        stroke-width: 2;
        opacity: 0.92;
    }

    .potter-app-menu {
        position: absolute;
        top: calc(100% + 8px);
        right: 0;
        min-width: 170px;
        padding: 8px;
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 10px;
        background: rgba(18, 18, 18, 0.96);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(12px);
        display: none;
    }

    .potter-app-menu[data-open="true"] {
        display: block;
    }

    .potter-dialog-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.45);
        backdrop-filter: blur(4px);
        z-index: 80;
        display: none;
        align-items: center;
        justify-content: center;
    }

    .potter-dialog-backdrop[data-open="true"] {
        display: flex;
    }

    .potter-dialog {
        width: min(360px, calc(100vw - 32px));
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        background: rgba(18, 18, 18, 0.98);
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
        color: #f3f3f3;
        padding: 16px;
        font: inherit;
    }

    .potter-dialog-title {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
    }

    .potter-dialog-body {
        font-size: 13px;
        line-height: 1.45;
        color: rgba(255, 255, 255, 0.86);
    }

    .potter-dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 16px;
    }

    .potter-dialog-btn {
        border: 1px solid #333;
        background: #111a;
        color: #ddd;
        border-radius: 8px;
        min-width: 72px;
        height: 32px;
        padding: 0 12px;
        cursor: pointer;
        transition: border-color 120ms, background 120ms;
    }

    .potter-dialog-btn:hover {
        border-color: #666;
        background: #1a1a;
    }

    .potter-dialog-btn[data-variant="primary"] {
        border-color: #9aa0ff;
        background: #2a2a55aa;
    }
    `;
    document.head.appendChild(style);
}

function iconVertexDot(): string {
    // filled dot
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"></circle>
    </svg>
    `;
}

function iconFaceParallelogram(): string {
    // simple parallelogram outline
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <polygon points="7,7 19,7 17,17 5,17"></polygon>
    </svg>
    `;
}

function iconEdgeLine(): string {
    // angled line
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <line x1="6" y1="18" x2="18" y2="6"></line>
    </svg>
    `;
}

function iconSelectCursor(): string {
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M6 4 L16 13 L11.5 14.2 L14 20 L11.5 21 L9 15.2 L6 18 Z"></path>
    </svg>
    `;
}

function iconMoveCross(): string {
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 4v16"></path>
    <path d="M4 12h16"></path>
    <path d="M12 4l-2 2"></path>
    <path d="M12 4l2 2"></path>
    <path d="M12 20l-2-2"></path>
    <path d="M12 20l2-2"></path>
    <path d="M4 12l2-2"></path>
    <path d="M4 12l2 2"></path>
    <path d="M20 12l-2-2"></path>
    <path d="M20 12l-2 2"></path>
    </svg>
    `;
}

function iconScaleFrame(): string {
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="7" y="7" width="10" height="10"></rect>
    <path d="M4 9V4h5"></path>
    <path d="M20 15v5h-5"></path>
    <path d="M9 4L4 9"></path>
    <path d="M15 20l5-5"></path>
    </svg>
    `;
}

function iconRotateArc(): string {
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M18 9a6.5 6.5 0 1 0 1.2 6.7"></path>
    <path d="M18 4v5h-5"></path>
    </svg>
    `;
}

function iconHamburger(): string {
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M5 7h14"></path>
    <path d="M5 12h14"></path>
    <path d="M5 17h14"></path>
    </svg>
    `;
}

// function iconExtrude(): string {
//     return `
//     <svg viewBox="0 0 24 24" aria-hidden="true">
//     <rect x="6" y="8" width="8" height="8"></rect>
//     <path d="M14 10l4-4"></path>
//     <path d="M18 6v4h-4"></path>
//     <path d="M10 8V5"></path>
//     <path d="M14 16h3"></path>
//     </svg>
//     `;
// }

export function mountAppShell(root: HTMLElement): {
    canvas: HTMLCanvasElement;
    setSelectionText: (t: string) => void;
    onModeChange: (cb: (mode: SelectionMode) => void) => void;
    setMode: (mode: SelectionMode) => void;
    onToolChange: (cb: (tool: EditorTool) => void) => void;
    setTool: (tool: EditorTool) => void;
    onPrimitiveSwap: (cb: (kind: PrimitiveKind) => void) => void;
    onImportObj: (cb: () => void) => void;
    onExportObj: (cb: () => void) => void;
    confirmYesNoCancel: (opts: { title: string; message: string; yesLabel?: string; noLabel?: string; cancelLabel?: string }) => Promise<"yes" | "no" | "cancel">;
    showContextMenu: (opts: {
        x: number;
        y: number;
        items: ContextMenuItem[];
        onSelect: (id: string) => void;
    }) => void;
    hideContextMenu: () => void;
} {
    ensureAppShellStyles();

    root.innerHTML = /*html*/ `
        <div class="potter-root">
            <div class="potter-panel">
                <strong>Potter</strong>

                <div class="potter-section">
                    <!-- <div class="potter-label">Select mode</div> -->
                </div>

                <div class="potter-section">
                    <div class="potter-label">Mesh</div>
                    <div class="potter-shape-row">
                        <button class="potter-shape-btn" data-primitive="icosahedron" title="Icosahedron" aria-label="Icosahedron"><img src="/icosahedron.svg" alt="" aria-hidden="true" /></button>
                        <button class="potter-shape-btn" data-primitive="truncatedIcosahedron" title="Truncated Icosahedron" aria-label="Truncated Icosahedron"><img src="/truncated_ico.svg" alt="" aria-hidden="true" /></button>
                        <button class="potter-shape-btn" data-primitive="cube" title="Cube" aria-label="Cube"><img src="/cube.svg" alt="" aria-hidden="true" /></button>
                    </div>
                </div>

                <hr class="potter-divider" />

                <!--
                -->
                <div class="potter-section" style="display: none;">
                    <div class="potter-selection-title">Selection:</div>
                    <div id="selectionText" class="potter-selection-text">(none)</div>
                </div>
            </div>

            <div class="potter-editor-tool-column">
                <label class="potter-tool" title="Selection tool" aria-label="Selection tool">
                    <input type="radio" name="editorTool" value="select" checked />
                    <span class="potter-tool-btn">${iconSelectCursor()}</span>
                </label>

                <label class="potter-tool" title="Move tool" aria-label="Move tool">
                    <input type="radio" name="editorTool" value="move" />
                    <span class="potter-tool-btn">${iconMoveCross()}</span>
                </label>

                <label class="potter-tool" title="Rotate tool" aria-label="Rotate tool">
                    <input type="radio" name="editorTool" value="rotate" />
                    <span class="potter-tool-btn">${iconRotateArc()}</span>
                </label>

                <label class="potter-tool" title="Size tool" aria-label="Size tool">
                    <input type="radio" name="editorTool" value="scale" />
                    <span class="potter-tool-btn">${iconScaleFrame()}</span>
                </label>

                <label class="potter-tool" title="Extrude tool" aria-label="Extrude tool">
                    <input type="radio" name="editorTool" value="extrude" />
                    <span class="potter-tool-btn">
                        <img src="/extrude.svg" alt="" aria-hidden="true" style="height: 24px; filter: brightness(0) invert(1);" />
                    </span>
                </label>
            </div>

            <div class="potter-tool-row">
                <label class="potter-tool" title="Select vertices" aria-label="Select vertices">
                    <input type="radio" name="selMode" value="vertex" />
                    <span class="potter-tool-btn">${iconVertexDot()}</span>
                </label>

                <label class="potter-tool" title="Select edges" aria-label="Select edges">
                    <input type="radio" name="selMode" value="edge" />
                    <span class="potter-tool-btn">${iconEdgeLine()}</span>
                </label>

                <label class="potter-tool" title="Select faces" aria-label="Select faces">
                    <input type="radio" name="selMode" value="face" checked />
                    <span class="potter-tool-btn">${iconFaceParallelogram()}</span>
                </label>
            </div>

            <div class="potter-app-menu-anchor">
                <button type="button" class="potter-app-menu-btn" id="potterAppMenuBtn" title="Application menu" aria-label="Application menu" aria-haspopup="menu" aria-expanded="false">
                    ${iconHamburger()}
                </button>
                <div class="potter-app-menu" id="potterAppMenu" data-open="false" aria-hidden="true">
                    <button type="button" class="potter-context-menu-btn" data-app-action="import-obj">Import OBJ</button>
                    <button type="button" class="potter-context-menu-btn" data-app-action="export-obj">Export OBJ</button>
                </div>
            </div>

            <div class="potter-viewport-wrap">
                <canvas id="viewport" class="potter-viewport"></canvas>
            </div>

            <div class="potter-context-menu" id="potterContextMenu" aria-hidden="true"></div>
            <div class="potter-dialog-backdrop" id="potterDialogBackdrop" data-open="false" aria-hidden="true">
                <div class="potter-dialog" role="dialog" aria-modal="true" aria-labelledby="potterDialogTitle">
                    <div class="potter-dialog-title" id="potterDialogTitle"></div>
                    <div class="potter-dialog-body" id="potterDialogBody"></div>
                    <div class="potter-dialog-actions">
                        <button type="button" class="potter-dialog-btn" id="potterDialogCancelBtn">Cancel</button>
                        <button type="button" class="potter-dialog-btn" id="potterDialogNoBtn">No</button>
                        <button type="button" class="potter-dialog-btn" id="potterDialogYesBtn" data-variant="primary">Yes</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    const canvas = root.querySelector<HTMLCanvasElement>("#viewport");
    if (!canvas) throw new Error("Viewport canvas not found");

    const selectionEl = root.querySelector<HTMLDivElement>("#selectionText");
    if (!selectionEl) throw new Error("Missing #selectionText");
    const contextMenuEl = root.querySelector<HTMLDivElement>("#potterContextMenu");
    if (!contextMenuEl) throw new Error("Missing #potterContextMenu");
    const appMenuBtn = root.querySelector<HTMLButtonElement>("#potterAppMenuBtn");
    if (!appMenuBtn) throw new Error("Missing #potterAppMenuBtn");
    const appMenuEl = root.querySelector<HTMLDivElement>("#potterAppMenu");
    if (!appMenuEl) throw new Error("Missing #potterAppMenu");
    const dialogBackdropEl = root.querySelector<HTMLDivElement>("#potterDialogBackdrop");
    if (!dialogBackdropEl) throw new Error("Missing #potterDialogBackdrop");
    const dialogTitleEl = root.querySelector<HTMLDivElement>("#potterDialogTitle");
    if (!dialogTitleEl) throw new Error("Missing #potterDialogTitle");
    const dialogBodyEl = root.querySelector<HTMLDivElement>("#potterDialogBody");
    if (!dialogBodyEl) throw new Error("Missing #potterDialogBody");
    const dialogYesBtn = root.querySelector<HTMLButtonElement>("#potterDialogYesBtn");
    if (!dialogYesBtn) throw new Error("Missing #potterDialogYesBtn");
    const dialogNoBtn = root.querySelector<HTMLButtonElement>("#potterDialogNoBtn");
    if (!dialogNoBtn) throw new Error("Missing #potterDialogNoBtn");
    const dialogCancelBtn = root.querySelector<HTMLButtonElement>("#potterDialogCancelBtn");
    if (!dialogCancelBtn) throw new Error("Missing #potterDialogCancelBtn");

    const radios = Array.from(
        root.querySelectorAll<HTMLInputElement>('input[name="selMode"]'),
    );
    const toolRadios = Array.from(
        root.querySelectorAll<HTMLInputElement>('input[name="editorTool"]'),
    );
    const primitiveButtons = Array.from(
        root.querySelectorAll<HTMLButtonElement>("button[data-primitive]"),
    );
    let contextMenuSelect: ((id: string) => void) | null = null;
    let importObjCb: (() => void) | null = null;
    let exportObjCb: (() => void) | null = null;
    let dialogResolve: ((value: "yes" | "no" | "cancel") => void) | null = null;

    const hideContextMenu = () => {
        contextMenuEl.dataset.open = "false";
        contextMenuEl.setAttribute("aria-hidden", "true");
        contextMenuEl.innerHTML = "";
        contextMenuSelect = null;
    };

    const hideAppMenu = () => {
        appMenuEl.dataset.open = "false";
        appMenuEl.setAttribute("aria-hidden", "true");
        appMenuBtn.setAttribute("aria-expanded", "false");
    };

    const closeDialog = (result: "yes" | "no" | "cancel") => {
        dialogBackdropEl.dataset.open = "false";
        dialogBackdropEl.setAttribute("aria-hidden", "true");
        const resolve = dialogResolve;
        dialogResolve = null;
        resolve?.(result);
    };

    const toggleAppMenu = () => {
        const nextOpen = appMenuEl.dataset.open !== "true";
        appMenuEl.dataset.open = nextOpen ? "true" : "false";
        appMenuEl.setAttribute("aria-hidden", nextOpen ? "false" : "true");
        appMenuBtn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
        if (nextOpen) hideContextMenu();
    };

    const positionContextMenu = (x: number, y: number) => {
        contextMenuEl.style.left = "0px";
        contextMenuEl.style.top = "0px";
        contextMenuEl.dataset.open = "true";
        contextMenuEl.setAttribute("aria-hidden", "false");

        const rect = contextMenuEl.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 8;
        const maxY = window.innerHeight - rect.height - 8;
        contextMenuEl.style.left = `${Math.max(8, Math.min(x, maxX))}px`;
        contextMenuEl.style.top = `${Math.max(8, Math.min(y, maxY))}px`;
    };

    const showContextMenu = (opts: {
        x: number;
        y: number;
        items: ContextMenuItem[];
        onSelect: (id: string) => void;
    }) => {
        contextMenuEl.innerHTML = "";
        contextMenuSelect = opts.onSelect;

        for (const item of opts.items) {
            if (item.separator) {
                const sep = document.createElement("hr");
                sep.className = "potter-context-menu-separator";
                contextMenuEl.appendChild(sep);
                continue;
            }

            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "potter-context-menu-btn";
            btn.textContent = item.label ?? "";
            btn.disabled = !!item.disabled;
            btn.addEventListener("click", () => {
                if (item.disabled) return;
                const onSelect = contextMenuSelect;
                hideContextMenu();
                onSelect?.(item.id);
            });
            contextMenuEl.appendChild(btn);
        }

        positionContextMenu(opts.x, opts.y);
    };

    window.addEventListener("pointerdown", (ev) => {
        if (!contextMenuEl.contains(ev.target as Node)) hideContextMenu();
        if (!appMenuEl.contains(ev.target as Node) && ev.target !== appMenuBtn) hideAppMenu();
    }, { capture: true });
    window.addEventListener("blur", () => {
        hideContextMenu();
        hideAppMenu();
    });
    window.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape") {
            hideContextMenu();
            hideAppMenu();
            if (dialogResolve) closeDialog("cancel");
        }
    });

    appMenuBtn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        toggleAppMenu();
    });
    appMenuEl.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement | null;
        const action = target?.closest<HTMLElement>("[data-app-action]")?.dataset.appAction;
        if (!action) return;
        hideAppMenu();
        if (action === "import-obj") importObjCb?.();
        if (action === "export-obj") exportObjCb?.();
    });
    dialogYesBtn.addEventListener("click", () => closeDialog("yes"));
    dialogNoBtn.addEventListener("click", () => closeDialog("no"));
    dialogCancelBtn.addEventListener("click", () => closeDialog("cancel"));
    dialogBackdropEl.addEventListener("pointerdown", (ev) => {
        if (ev.target === dialogBackdropEl) closeDialog("cancel");
    });

    const setMode = (mode: SelectionMode) => {
        const r = radios.find((x) => x.value === mode);
        if (!r) return;
        // Setting checked programmatically does NOT trigger "change" in browsers,
        // which avoids event loops with main.ts.
        r.checked = true;
    };

    const setTool = (tool: EditorTool) => {
        const radio = toolRadios.find((x) => x.value === tool);
        if (!radio) return;
        radio.checked = true;
    };

    return {
        canvas,
        setSelectionText: (t: string) => (selectionEl.textContent = t),
        setMode,
        setTool,
        onImportObj: (cb) => {
            importObjCb = cb;
        },
        onExportObj: (cb) => {
            exportObjCb = cb;
        },
        confirmYesNoCancel: (opts) => {
            if (dialogResolve) closeDialog("cancel");
            hideContextMenu();
            hideAppMenu();
            dialogTitleEl.textContent = opts.title;
            dialogBodyEl.textContent = opts.message;
            dialogYesBtn.textContent = opts.yesLabel ?? "Yes";
            dialogNoBtn.textContent = opts.noLabel ?? "No";
            dialogCancelBtn.textContent = opts.cancelLabel ?? "Cancel";
            dialogBackdropEl.dataset.open = "true";
            dialogBackdropEl.setAttribute("aria-hidden", "false");
            return new Promise<"yes" | "no" | "cancel">((resolve) => {
                dialogResolve = resolve;
                dialogYesBtn.focus();
            });
        },
        showContextMenu,
        hideContextMenu,
        onModeChange: (cb) => {
            const fire = () => {
                const checked = radios.find((r) => r.checked);
                if (checked) cb(checked.value as SelectionMode);
            };

                radios.forEach((r) =>
                r.addEventListener("change", () => {
                    if (r.checked) cb(r.value as SelectionMode);
                }),
                );

                fire();
        },
        onToolChange: (cb) => {
            const fire = () => {
                const checked = toolRadios.find((r) => r.checked);
                if (checked) cb(checked.value as EditorTool);
            };

            toolRadios.forEach((r) =>
                r.addEventListener("change", () => {
                    if (r.checked) cb(r.value as EditorTool);
                }),
            );

            fire();
        },
        onPrimitiveSwap: (cb) => {
            primitiveButtons.forEach((btn) =>
                btn.addEventListener("click", () => {
                    const kind = btn.dataset.primitive as PrimitiveKind | undefined;
                    if (kind) cb(kind);
                }),
            );
        },
    };
}

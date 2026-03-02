import type { SelectionMode } from "../core/selection/selection";
export type PrimitiveKind = "cube" | "icosahedron" | "truncatedIcosahedron";
export type EditorTool = "select" | "move" | "rotate" | "scale" | "extrude";

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

function iconExtrude(): string {
    return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6" y="8" width="8" height="8"></rect>
    <path d="M14 10l4-4"></path>
    <path d="M18 6v4h-4"></path>
    <path d="M10 8V5"></path>
    <path d="M14 16h3"></path>
    </svg>
    `;
}

export function mountAppShell(root: HTMLElement): {
    canvas: HTMLCanvasElement;
    setSelectionText: (t: string) => void;
    onModeChange: (cb: (mode: SelectionMode) => void) => void;
    setMode: (mode: SelectionMode) => void;
    onToolChange: (cb: (tool: EditorTool) => void) => void;
    setTool: (tool: EditorTool) => void;
    onPrimitiveSwap: (cb: (kind: PrimitiveKind) => void) => void;
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
                    <span class="potter-tool-btn">${iconExtrude()}</span>
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

            <div class="potter-viewport-wrap">
                <canvas id="viewport" class="potter-viewport"></canvas>
            </div>
        </div>
    `;

    const canvas = root.querySelector<HTMLCanvasElement>("#viewport");
    if (!canvas) throw new Error("Viewport canvas not found");

    const selectionEl = root.querySelector<HTMLDivElement>("#selectionText");
    if (!selectionEl) throw new Error("Missing #selectionText");

    const radios = Array.from(
        root.querySelectorAll<HTMLInputElement>('input[name="selMode"]'),
    );
    const toolRadios = Array.from(
        root.querySelectorAll<HTMLInputElement>('input[name="editorTool"]'),
    );
    const primitiveButtons = Array.from(
        root.querySelectorAll<HTMLButtonElement>("button[data-primitive]"),
    );

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

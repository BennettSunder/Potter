import type { SelectionMode } from "../core/selection";

const APP_SHELL_CSS_ID = "potter-app-shell-css";

function ensureAppShellStyles() {
    if (document.getElementById(APP_SHELL_CSS_ID)) return;

    const style = document.createElement("style");
    style.id = APP_SHELL_CSS_ID;
    style.textContent = `
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

export function mountAppShell(root: HTMLElement): {
    canvas: HTMLCanvasElement;
    setSelectionText: (t: string) => void;
    onModeChange: (cb: (mode: SelectionMode) => void) => void;
} {
    ensureAppShellStyles();

    root.innerHTML = `
    <div class="potter-root">
        <div class="potter-panel">
            <strong>Potter</strong>

            <div class="potter-section">
                <!-- <div class="potter-label">Select mode</div> -->
            </div>

            <hr class="potter-divider" />

            <div class="potter-selection-title">Selection:</div>
                <div id="selectionText" class="potter-selection-text">(none)</div>
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
    </div>
    `;

    const canvas = root.querySelector<HTMLCanvasElement>("#viewport");
    if (!canvas) throw new Error("Viewport canvas not found");

    const selectionEl = root.querySelector<HTMLDivElement>("#selectionText");
    if (!selectionEl) throw new Error("Missing #selectionText");

    const radios = Array.from(
        root.querySelectorAll<HTMLInputElement>('input[name="selMode"]'),
    );

    return {
        canvas,
        setSelectionText: (t: string) => (selectionEl.textContent = t),
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

    };
}

import { app } from "../../scripts/app.js";

// Interactive rows×cols picker for GridStitchAdvanced, drawn INSIDE the node.
// Hover the 4×4 grid (fills from the BOTTOM-LEFT) to preview, click to lock.
// Each cell shows its image_i slot number (top-left origin, row-major — matches
// how stitch() lays cells out). The node then exposes exactly rows×cols ports.

// Both stitch nodes get the picker; only the multi-image one grows/shrinks ports.
const TARGETS = {
  GridStitchAdvanced: { dynamicInputs: true },
  GridStitch: { dynamicInputs: false },
};
const GRID = 4; // 4×4 max
const MAX = GRID * GRID; // 16
const CELL = 28;
const GAP = 5;
const HEIGHT = 190; // reserved widget height inside the node

function ensureStyles() {
  if (document.getElementById("gs-picker-styles")) return;
  const s = document.createElement("style");
  s.id = "gs-picker-styles";
  s.textContent = `
    .gs-picker{box-sizing:border-box;height:${HEIGHT}px;display:flex;align-items:center;
      justify-content:center;padding:6px;user-select:none;}
    .gs-card{display:flex;flex-direction:column;align-items:center;gap:11px;padding:4px;
      background:transparent;border:none;box-shadow:none;}
    .gs-grid{display:grid;grid-template-columns:repeat(${GRID},${CELL}px);
      grid-template-rows:repeat(${GRID},${CELL}px);gap:${GAP}px;}
    .gs-cell{width:${CELL}px;height:${CELL}px;border-radius:0;background:#232833;
      border:1px solid #333a47;cursor:pointer;display:flex;align-items:center;justify-content:center;
      font:700 14px ui-sans-serif,system-ui,-apple-system,sans-serif;font-variant-numeric:tabular-nums;
      color:transparent;transition:background-color .1s ease,border-color .1s ease;}
    .gs-cell.preview{background:rgba(16,185,129,.20);border-color:#10b981;color:#d1fae5;}
    .gs-cell.on{background:linear-gradient(180deg,#10b981,#0ea372);border-color:#34d399;
      color:#ffffff;text-shadow:0 1px 1px rgba(0,0,0,.25);}
    .gs-foot{display:flex;align-items:baseline;gap:9px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;}
    .gs-dim{font-size:13px;font-weight:600;color:#e5e7eb;letter-spacing:.03em;}
    .gs-sep{width:1px;height:11px;background:#3a3f4a;align-self:center;}
    .gs-cnt{font-size:12px;color:#8b909b;}
    .gs-cnt b{color:#34d399;font-weight:600;}
  `;
  document.head.appendChild(s);
}

app.registerExtension({
  name: "GridStitch.InteractiveGrid",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    const cfg = TARGETS[nodeData.name];
    if (!cfg) return;

    const onNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;
      buildPicker(this, cfg.dynamicInputs);
      return r;
    };

    const onConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = onConfigure ? onConfigure.apply(this, arguments) : undefined;
      requestAnimationFrame(() => this._gsSync && this._gsSync());
      return r;
    };
  },
});

function buildPicker(node, dynamicInputs) {
  ensureStyles();
  const rowsW = node.widgets && node.widgets.find((w) => w.name === "rows");
  const colsW = node.widgets && node.widgets.find((w) => w.name === "cols");
  if (!rowsW || !colsW || !node.addDOMWidget) return;

  // Keep rows/cols as the serialized backing values, but hide their number boxes.
  for (const w of [rowsW, colsW]) {
    w.hidden = true;
    w.computeSize = () => [0, -4];
  }

  const wrap = document.createElement("div");
  wrap.className = "gs-picker";
  const card = document.createElement("div");
  card.className = "gs-card";
  const grid = document.createElement("div");
  grid.className = "gs-grid";
  const cells = [];
  for (let i = 0; i < MAX; i++) {
    const c = document.createElement("div");
    c.className = "gs-cell";
    c.dataset.i = String(i);
    grid.appendChild(c);
    cells.push(c);
  }
  const foot = document.createElement("div");
  foot.className = "gs-foot";
  card.appendChild(grid);
  card.appendChild(foot);
  wrap.appendChild(card);

  const colOf = (i) => i % GRID;
  const rowBotOf = (i) => GRID - 1 - Math.floor(i / GRID); // 0 = bottom row

  function paint(selCols, selRows, preview) {
    for (let i = 0; i < MAX; i++) {
      const c = colOf(i);
      const rb = rowBotOf(i);
      const on = c < selCols && rb < selRows;
      cells[i].classList.toggle("on", on && !preview);
      cells[i].classList.toggle("preview", on && !!preview);
      // slot number: row-major from the block's TOP-LEFT (matches stitch order)
      cells[i].textContent = on
        ? String((selRows - 1 - rb) * selCols + c + 1)
        : "";
    }
    const n = selCols * selRows;
    foot.innerHTML =
      `<span class="gs-dim">${selCols} × ${selRows}</span>` +
      `<span class="gs-sep"></span>` +
      `<span class="gs-cnt"><b>${n}</b> image${n > 1 ? "s" : ""}</span>`;
  }

  const current = () => ({
    cols: Math.min(GRID, Math.max(1, colsW.value | 0)),
    rows: Math.min(GRID, Math.max(1, rowsW.value | 0)),
  });

  grid.addEventListener("mousemove", (e) => {
    const t = e.target.closest(".gs-cell");
    if (!t) return;
    const i = +t.dataset.i;
    paint(colOf(i) + 1, rowBotOf(i) + 1, true);
  });
  grid.addEventListener("mouseleave", () => {
    const { cols, rows } = current();
    paint(cols, rows, false);
  });
  grid.addEventListener("click", (e) => {
    const t = e.target.closest(".gs-cell");
    if (!t) return;
    const i = +t.dataset.i;
    const selCols = colOf(i) + 1;
    const selRows = rowBotOf(i) + 1;
    colsW.value = selCols;
    rowsW.value = selRows;
    if (dynamicInputs) applyInputs(node, selRows, selCols);
    paint(selCols, selRows, false);
    node.setSize(node.computeSize());
    node.setDirtyCanvas(true, true);
  });

  node.addDOMWidget("gs_picker", "gs_picker", wrap, {
    serialize: false,
    getMinHeight: () => HEIGHT,
    getMaxHeight: () => HEIGHT,
  });

  node._gsSync = () => {
    const { cols, rows } = current();
    if (dynamicInputs) applyInputs(node, rows, cols);
    if (node._gsRatioSync) node._gsRatioSync();
    paint(cols, rows, false);
    node.setSize(node.computeSize());
    node.setDirtyCanvas(true, true);
  };

  wireModeRatio(node);
  requestAnimationFrame(() => node._gsSync());
}

// Show the `ratio` dropdown only in manual mode.
function wireModeRatio(node) {
  const modeW = node.widgets && node.widgets.find((w) => w.name === "mode");
  const ratioW = node.widgets && node.widgets.find((w) => w.name === "ratio");
  if (!modeW || !ratioW) return;

  const update = () => {
    ratioW.hidden = modeW.value !== "manual";
    ratioW.computeSize = ratioW.hidden ? () => [0, -4] : undefined;
    node.setSize(node.computeSize());
    node.setDirtyCanvas(true, true);
  };
  const prev = modeW.callback;
  modeW.callback = function () {
    const r = prev ? prev.apply(this, arguments) : undefined;
    update();
    return r;
  };
  node._gsRatioSync = update;
  update();
}

// Make node have exactly rows*cols contiguous image_i input ports.
function applyInputs(node, rows, cols) {
  const count = Math.min(Math.max(rows * cols, 1), MAX);

  for (let i = (node.inputs || []).length - 1; i >= 0; i--) {
    const inp = node.inputs[i];
    if (inp && inp.name && inp.name.startsWith("image_")) {
      if (parseInt(inp.name.slice(6), 10) > count) node.removeInput(i);
    }
  }
  const have = new Set(
    (node.inputs || [])
      .filter((x) => x.name && x.name.startsWith("image_"))
      .map((x) => x.name),
  );
  for (let k = 1; k <= count; k++) {
    if (!have.has(`image_${k}`)) node.addInput(`image_${k}`, "IMAGE");
  }

  node.setSize(node.computeSize());
  node.setDirtyCanvas(true, true);
}

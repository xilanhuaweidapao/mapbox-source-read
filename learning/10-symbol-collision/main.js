import { mustGetContext, resizeCanvasToDisplaySize, createProgram } from "../_common/gl.js";
import { Transform2D } from "../_common/Transform2D.js";
import { createPanel } from "../_common/ui.js";

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

const transform = new Transform2D({
  width: 2,
  height: 2,
  tileSize: 256,
  center: [0, 0],
  zoom: 2.0,
  bearing: 0,
  renderWorldCopies: true,
});
installInteractions({ canvas, transform });

const panel = createPanel({ title: "10 - Symbol Collision" });
let collisionEnabled = true;
let showBoxes = false;
let cellSize = 64;
let fadeSpeed = 4.0;
let labelCount = 220;

panel.addCheckbox("collisionEnabled", collisionEnabled, (v) => (collisionEnabled = v));
panel.addCheckbox("showBoxes", showBoxes, (v) => (showBoxes = v));
panel.addSlider("cellSize", { min: 24, max: 140, step: 1, value: cellSize }, (v) => (cellSize = v));
panel.addSlider("fadeSpeed", { min: 0.5, max: 10, step: 0.1, value: fadeSpeed }, (v) => (fadeSpeed = v));
panel.addSlider("labelCount", { min: 30, max: 400, step: 1, value: labelCount }, (v) => {
  labelCount = v;
  rebuildLabels();
});
panel.addSeparator();
const stats = panel.addText("Stats", "");

// --- data ---
let labels = [];
let atlas = null;
const state = new Map(); // id -> {opacity}

rebuildLabels();

function rebuildLabels() {
  labels = makeRandomLabels(labelCount);
  atlas = buildAtlas(labels);
  uploadAtlasTexture(atlas);
  state.clear();
  for (const l of labels) state.set(l.id, { opacity: 0 });
}

// --- WebGL resources ---
const VS_TEXT = `
attribute vec2 a_pos;
attribute vec2 a_uv;
attribute float a_alpha;
varying vec2 v_uv;
varying float v_alpha;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
  v_alpha = a_alpha;
}
`;
const FS_TEXT = `
precision mediump float;
uniform sampler2D u_atlas;
varying vec2 v_uv;
varying float v_alpha;
void main() {
  vec4 c = texture2D(u_atlas, v_uv);
  gl_FragColor = vec4(c.rgb, c.a * v_alpha);
}
`;
const progText = createProgram(gl, VS_TEXT, FS_TEXT);

const VS_BOX = `
attribute vec2 a_pos;
uniform vec4 u_color;
varying vec4 v_color;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_color = u_color;
}
`;
const FS_BOX = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }
`;
const progBox = createProgram(gl, VS_BOX, FS_BOX);

const vbo = gl.createBuffer();
const ibo = gl.createBuffer();

const boxVbo = gl.createBuffer();

let atlasTex = gl.createTexture();

gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

function uploadAtlasTexture(atlas) {
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

let lastT = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const placement = placeLabels({
    labels,
    transform,
    collisionEnabled,
    cellSize,
  });

  // 更新 opacity（placed -> up, unplaced -> down）
  let drawn = 0;
  for (const l of labels) {
    const s = state.get(l.id);
    const target = placement.placed.has(l.id) ? 1 : 0;
    const delta = fadeSpeed * dt;
    s.opacity = clamp01(s.opacity + (target > s.opacity ? delta : -delta));
    if (s.opacity > 0.01) drawn++;
  }

  // 构建动态 VBO：把当前要画的 labels 批量写入（位置是 clip 坐标）
  const geom = buildTextGeometry({
    labels,
    atlas,
    state,
    transform,
  });
  uploadGeometry(geom);
  drawText(geom);

  if (showBoxes) {
    const boxGeom = buildBoxGeometry(placement.boxes, canvas.width, canvas.height);
    drawBoxes(boxGeom);
  }

  stats.set(
    `labels=${labels.length}\n` +
      `placed=${placement.placed.size}\n` +
      `drawn(opacity>0.01)=${drawn}\n` +
      `cellSize=${cellSize}`,
  );

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ---------------- placement (collision) ----------------

function placeLabels({ labels, transform, collisionEnabled, cellSize }) {
  const placed = new Set();
  const boxes = [];

  // grid: key -> list of box indices
  const grid = new Map();

  // 简单优先级：越靠近中心的先放
  const center = { x: transform.width / 2, y: transform.height / 2 };
  const order = labels
    .map((l) => {
      const p = transform.mercatorToScreen(l.mx, l.my);
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      return { l, score: dx * dx + dy * dy, p };
    })
    .sort((a, b) => a.score - b.score);

  for (const item of order) {
    const l = item.l;
    const p = item.p;
    const w = l.w;
    const h = l.h;
    const x0 = p.x - w / 2;
    const y0 = p.y - h / 2;
    const x1 = x0 + w;
    const y1 = y0 + h;

    const box = { x0, y0, x1, y1 };
    if (!collisionEnabled || canPlace(box, grid, boxes, cellSize)) {
      placed.add(l.id);
      boxes.push(box);
      insert(box, grid, boxes.length - 1, cellSize);
    }
  }

  return { placed, boxes };
}

function canPlace(box, grid, boxes, cellSize) {
  const cells = cellsFor(box, cellSize);
  for (const key of cells) {
    const list = grid.get(key);
    if (!list) continue;
    for (const idx of list) {
      if (intersects(box, boxes[idx])) return false;
    }
  }
  return true;
}

function insert(box, grid, index, cellSize) {
  const cells = cellsFor(box, cellSize);
  for (const key of cells) {
    const list = grid.get(key);
    if (list) list.push(index);
    else grid.set(key, [index]);
  }
}

function cellsFor(box, cellSize) {
  const minX = Math.floor(box.x0 / cellSize);
  const maxX = Math.floor(box.x1 / cellSize);
  const minY = Math.floor(box.y0 / cellSize);
  const maxY = Math.floor(box.y1 / cellSize);
  const out = [];
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) out.push(`${x},${y}`);
  }
  return out;
}

function intersects(a, b) {
  return !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.y1 <= b.y0 || a.y0 >= b.y1);
}

// ---------------- atlas ----------------

function buildAtlas(labels) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext("2d");

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = "16px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
  ctx.textBaseline = "top";

  const padding = 2;
  let x = padding;
  let y = padding;
  let rowH = 0;

  for (const l of labels) {
    const m = ctx.measureText(l.text);
    const w = Math.ceil(m.width) + padding * 2;
    const h = 18 + padding * 2;

    if (x + w + padding > canvas.width) {
      x = padding;
      y += rowH + padding;
      rowH = 0;
    }
    if (y + h + padding > canvas.height) {
      // 够用就行：超出就停止（学习用）
      break;
    }

    // 画一个轻微底色，让文字更清晰（也更容易看到 alpha）
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    roundRect(ctx, x, y, w, h, 4);
    ctx.fill();

    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(l.text, x + padding, y + padding);

    l.u0 = x / canvas.width;
    l.v0 = y / canvas.height;
    l.u1 = (x + w) / canvas.width;
    l.v1 = (y + h) / canvas.height;
    l.w = w;
    l.h = h;

    x += w + padding;
    rowH = Math.max(rowH, h);
  }

  return { canvas, width: canvas.width, height: canvas.height };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------------- geometry build + draw ----------------

function buildTextGeometry({ labels, atlas, state, transform }) {
  const verts = [];
  const idx = [];
  let vCount = 0;

  const w = transform.width;
  const h = transform.height;

  for (const l of labels) {
    const s = state.get(l.id);
    if (!s || s.opacity <= 0.01) continue;
    if (l.u0 == null) continue; // atlas 没放下

    const p = transform.mercatorToScreen(l.mx, l.my);
    const x0 = p.x - l.w / 2;
    const y0 = p.y - l.h / 2;
    const x1 = x0 + l.w;
    const y1 = y0 + l.h;

    // pixel -> clip
    const c0 = toClip(x0, y0, w, h);
    const c1 = toClip(x1, y1, w, h);

    // 4 vertices: pos(x,y) + uv(u,v) + alpha
    verts.push(
      c0.x,
      c0.y,
      l.u0,
      l.v0,
      s.opacity, // 0
      c1.x,
      c0.y,
      l.u1,
      l.v0,
      s.opacity, // 1
      c1.x,
      c1.y,
      l.u1,
      l.v1,
      s.opacity, // 2
      c0.x,
      c1.y,
      l.u0,
      l.v1,
      s.opacity, // 3
    );

    idx.push(vCount + 0, vCount + 1, vCount + 2, vCount + 0, vCount + 2, vCount + 3);
    vCount += 4;
  }

  return {
    vertexData: new Float32Array(verts),
    indexData: new Uint16Array(idx),
    indexCount: idx.length,
  };
}

function uploadGeometry(geom) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, geom.vertexData, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geom.indexData, gl.DYNAMIC_DRAW);
}

function drawText(geom) {
  gl.useProgram(progText);

  const aPos = gl.getAttribLocation(progText, "a_pos");
  const aUV = gl.getAttribLocation(progText, "a_uv");
  const aAlpha = gl.getAttribLocation(progText, "a_alpha");
  const uAtlas = gl.getUniformLocation(progText, "u_atlas");

  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

  const stride = 5 * 4;
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 2 * 4);
  gl.enableVertexAttribArray(aAlpha);
  gl.vertexAttribPointer(aAlpha, 1, gl.FLOAT, false, stride, 4 * 4);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.uniform1i(uAtlas, 0);

  gl.drawElements(gl.TRIANGLES, geom.indexCount, gl.UNSIGNED_SHORT, 0);
}

function buildBoxGeometry(boxes, width, height) {
  const v = [];
  for (const b of boxes) {
    const p0 = toClip(b.x0, b.y0, width, height);
    const p1 = toClip(b.x1, b.y0, width, height);
    const p2 = toClip(b.x1, b.y1, width, height);
    const p3 = toClip(b.x0, b.y1, width, height);
    // 4 edges (8 vertices)
    v.push(p0.x, p0.y, p1.x, p1.y, p1.x, p1.y, p2.x, p2.y, p2.x, p2.y, p3.x, p3.y, p3.x, p3.y, p0.x, p0.y);
  }
  return new Float32Array(v);
}

function drawBoxes(boxVertices) {
  gl.useProgram(progBox);
  const aPos = gl.getAttribLocation(progBox, "a_pos");
  const uColor = gl.getUniformLocation(progBox, "u_color");

  gl.bindBuffer(gl.ARRAY_BUFFER, boxVbo);
  gl.bufferData(gl.ARRAY_BUFFER, boxVertices, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.uniform4f(uColor, 0.2, 1.0, 0.6, 0.25);
  gl.drawArrays(gl.LINES, 0, boxVertices.length / 2);
}

function toClip(px, py, width, height) {
  return { x: (px / width) * 2 - 1, y: 1 - (py / height) * 2 };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// ---------------- data generation ----------------

function makeRandomLabels(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const lng = -180 + Math.random() * 360;
    const lat = -70 + Math.random() * 140; // 避开极区（Mercator 非常挤）
    const mx = (lng + 180) / 360;
    const my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
    out.push({
      id: `L${i}`,
      text: `Label ${i}`,
      lng,
      lat,
      mx,
      my,
      w: 0,
      h: 0,
      u0: null,
      v0: null,
      u1: null,
      v1: null,
    });
  }
  return out;
}

function installInteractions({ canvas, transform }) {
  let dragging = false;
  let last = { x: 0, y: 0 };
  canvas.addEventListener("mousedown", (e) => {
    dragging = true;
    last = { x: e.clientX, y: e.clientY };
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - last.x;
    const dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    transform.panByPixels(dx, dy);
  });
  window.addEventListener("mouseup", () => (dragging = false));

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) * (canvas.width / rect.width);
      const y = (e.clientY - rect.top) * (canvas.height / rect.height);
      transform.zoomByDelta(e.deltaY, { x, y });
    },
    { passive: false },
  );
}


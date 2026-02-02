import { createProgram, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";
import { Transform2D } from "../_common/Transform2D.js";
import { createPanel } from "../_common/ui.js";

const TILE_SIZE = 256;

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true, stencil: true });

const panel = createPanel({ title: "09 - Stencil Clip" });
let clipEnabled = true;
let expand = 0.03; // tile 内容放大比例（越大越容易观察 overdraw）
let showBorders = true;

panel.addCheckbox("clipEnabled", clipEnabled, (v) => (clipEnabled = v));
panel.addSlider("expand", { min: 0, max: 0.08, step: 0.001, value: expand }, (v) => (expand = v));
panel.addCheckbox("showBorders", showBorders, (v) => (showBorders = v));
panel.addSeparator();
const stats = panel.addText("Info", "");

const transform = new Transform2D({
  width: 2,
  height: 2,
  tileSize: TILE_SIZE,
  center: [0, 0],
  zoom: 2.0,
  bearing: 0,
  renderWorldCopies: true,
});
installInteractions({ canvas, transform });

// --- programs ---
const VS_TILE = `
attribute vec2 a_unit;
varying vec2 v_uv;
uniform mat4 u_matrix;
uniform vec2 u_origin;
uniform vec2 u_scale;
void main() {
  vec2 merc = u_origin + a_unit * u_scale;
  gl_Position = u_matrix * vec4(merc, 0.0, 1.0);
  v_uv = a_unit;
}
`;
const FS_TILE = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
void main() {
  gl_FragColor = texture2D(u_tex, v_uv);
}
`;
const progTile = createProgram(gl, VS_TILE, FS_TILE);

const VS_SOLID = `
attribute vec2 a_unit;
uniform mat4 u_matrix;
uniform vec2 u_origin;
uniform vec2 u_scale;
void main() {
  vec2 merc = u_origin + a_unit * u_scale;
  gl_Position = u_matrix * vec4(merc, 0.0, 1.0);
}
`;
const FS_SOLID = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }
`;
const progSolid = createProgram(gl, VS_SOLID, FS_SOLID);

// unit quad buffers
const quad = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const idxTri = new Uint16Array([0, 1, 2, 0, 2, 3]);
const idxLine = new Uint16Array([0, 1, 2, 3]);
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
const iboTri = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboTri);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxTri, gl.STATIC_DRAW);
const iboLine = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboLine);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idxLine, gl.STATIC_DRAW);

const tiles = new TileStore(gl);

let frameId = 0;
function frame() {
  frameId++;

  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clearStencil(0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

  const z = Math.max(0, Math.floor(transform.zoom));
  const visible = getVisibleTiles(transform, z);
  tiles.setMaxParallel(10);
  tiles.setMaxCache(200);
  tiles.markAndRequest(visible, frameId);

  const m = transform.getMercatorToClipMatrix();

  // 逐 tile：mask pass + content pass
  let stencilRef = 1;
  for (const t of visible) {
    const entry = tiles.get(t.key);
    if (!entry?.texture) continue;

    if (clipEnabled) {
      // --- Mask pass：只写 stencil，不写颜色 ---
      gl.enable(gl.STENCIL_TEST);
      gl.stencilMask(0xff);
      gl.stencilFunc(gl.ALWAYS, stencilRef, 0xff);
      gl.stencilOp(gl.REPLACE, gl.REPLACE, gl.REPLACE);
      gl.colorMask(false, false, false, false);

      drawSolidRect({ m, originX: t.originX, originY: t.originY, scale: t.scale, color: [0, 0, 0, 0] });

      // --- Content pass：只在 stencil==ref 的地方输出颜色 ---
      gl.colorMask(true, true, true, true);
      gl.stencilMask(0x00);
      gl.stencilFunc(gl.EQUAL, stencilRef, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);

      const expanded = expandRect(t.originX, t.originY, t.scale, expand);
      drawTile({ m, originX: expanded.originX, originY: expanded.originY, scale: expanded.scale, texture: entry.texture });

      stencilRef++;
    } else {
      gl.disable(gl.STENCIL_TEST);
      const expanded = expandRect(t.originX, t.originY, t.scale, expand);
      drawTile({ m, originX: expanded.originX, originY: expanded.originY, scale: expanded.scale, texture: entry.texture });
    }
  }

  gl.disable(gl.STENCIL_TEST);
  gl.colorMask(true, true, true, true);

  if (showBorders) {
    // 用线框把 tile 边界画出来（便于观察）
    for (const t of visible) {
      drawBorder({ m, originX: t.originX, originY: t.originY, scale: t.scale });
    }
  }

  stats.set(`z=${z} visible=${visible.length}\nclip=${clipEnabled} expand=${expand.toFixed(3)}`);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function drawTile({ m, originX, originY, scale, texture }) {
  gl.useProgram(progTile);
  bindQuad(progTile, iboTri);
  gl.uniformMatrix4fv(gl.getUniformLocation(progTile, "u_matrix"), false, m);
  gl.uniform2f(gl.getUniformLocation(progTile, "u_origin"), originX, originY);
  gl.uniform2f(gl.getUniformLocation(progTile, "u_scale"), scale, scale);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(gl.getUniformLocation(progTile, "u_tex"), 0);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function drawSolidRect({ m, originX, originY, scale, color }) {
  gl.useProgram(progSolid);
  bindQuad(progSolid, iboTri);
  gl.uniformMatrix4fv(gl.getUniformLocation(progSolid, "u_matrix"), false, m);
  gl.uniform2f(gl.getUniformLocation(progSolid, "u_origin"), originX, originY);
  gl.uniform2f(gl.getUniformLocation(progSolid, "u_scale"), scale, scale);
  gl.uniform4f(gl.getUniformLocation(progSolid, "u_color"), color[0], color[1], color[2], color[3]);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
}

function drawBorder({ m, originX, originY, scale }) {
  gl.useProgram(progSolid);
  bindQuad(progSolid, iboLine);
  gl.uniformMatrix4fv(gl.getUniformLocation(progSolid, "u_matrix"), false, m);
  gl.uniform2f(gl.getUniformLocation(progSolid, "u_origin"), originX, originY);
  gl.uniform2f(gl.getUniformLocation(progSolid, "u_scale"), scale, scale);
  gl.uniform4f(gl.getUniformLocation(progSolid, "u_color"), 1, 1, 1, 0.25);
  gl.drawElements(gl.LINE_LOOP, 4, gl.UNSIGNED_SHORT, 0);
}

function bindQuad(program, ibo) {
  const a = gl.getAttribLocation(program, "a_unit");
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
}

function expandRect(originX, originY, scale, factor) {
  const d = scale * factor;
  return { originX: originX - d, originY: originY - d, scale: scale + d * 2 };
}

// 视口 → 可视 tiles（同 05 思路）
function getVisibleTiles(transform, z) {
  const tilesAtZ = 1 << z;
  const corners = [
    transform.screenToMercator(0, 0),
    transform.screenToMercator(transform.width, 0),
    transform.screenToMercator(0, transform.height),
    transform.screenToMercator(transform.width, transform.height),
  ];
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  minY = Math.max(0, minY);
  maxY = Math.min(1, maxY);

  const minTileX = Math.floor(minX * tilesAtZ);
  const maxTileX = Math.floor(maxX * tilesAtZ);
  const minTileY = Math.floor(minY * tilesAtZ);
  const maxTileY = Math.floor(maxY * tilesAtZ);

  const out = [];
  for (let ty = minTileY; ty <= maxTileY; ty++) {
    if (ty < 0 || ty >= tilesAtZ) continue;
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const wrap = Math.floor(tx / tilesAtZ);
      const x = ((tx % tilesAtZ) + tilesAtZ) % tilesAtZ;
      const y = ty;
      out.push({
        key: `${z}/${wrap}/${x}/${y}`,
        z,
        x,
        y,
        wrap,
        originX: (x + wrap * tilesAtZ) / tilesAtZ,
        originY: y / tilesAtZ,
        scale: 1 / tilesAtZ,
      });
    }
  }
  return out;
}

class TileStore {
  constructor(gl) {
    this.gl = gl;
    this._entries = new Map();
    this._queue = [];
    this._inFlight = 0;
    this._maxParallel = 8;
    this._maxCache = 200;
  }
  setMaxParallel(n) {
    this._maxParallel = n;
  }
  setMaxCache(n) {
    this._maxCache = n;
  }
  get(key) {
    return this._entries.get(key);
  }
  markAndRequest(visible, frameId) {
    for (const t of visible) {
      const e = this._entries.get(t.key);
      if (e) {
        e.lastUsedFrame = frameId;
        continue;
      }
      this._entries.set(t.key, { state: "queued", lastUsedFrame: frameId, texture: null });
      this._queue.push(t);
    }
    this._drainQueue();
    this._evict(frameId);
  }
  _drainQueue() {
    while (this._inFlight < this._maxParallel && this._queue.length) {
      const t = this._queue.shift();
      const e = this._entries.get(t.key);
      if (!e || e.state !== "queued") continue;
      e.state = "loading";
      this._inFlight++;
      fakeFetchTileImage(t, TILE_SIZE)
        .then((img) => {
          const tex = this.gl.createTexture();
          this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);
          const existing = this._entries.get(t.key);
          if (existing) {
            existing.texture = tex;
            existing.state = "ready";
          } else {
            this.gl.deleteTexture(tex);
          }
        })
        .finally(() => {
          this._inFlight--;
          this._drainQueue();
        });
    }
  }
  _evict(frameId) {
    if (this._entries.size <= this._maxCache) return;
    const items = Array.from(this._entries.entries());
    items.sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);
    const target = this._entries.size - this._maxCache;
    for (let i = 0; i < target; i++) {
      const [key, e] = items[i];
      if (e.lastUsedFrame === frameId) continue;
      if (e.texture) this.gl.deleteTexture(e.texture);
      this._entries.delete(key);
    }
  }
}

function fakeFetchTileImage(tile, tileSize) {
  const delay = 70 + Math.random() * 200;
  return new Promise((resolve) => {
    setTimeout(async () => {
      const c = document.createElement("canvas");
      c.width = tileSize;
      c.height = tileSize;
      const ctx = c.getContext("2d");

      const r = (tile.x * 37 + tile.z * 13) % 255;
      const g = (tile.y * 53 + tile.z * 29) % 255;
      const b = (tile.x * 17 + tile.y * 19) % 255;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, tileSize, tileSize);

      // 画粗边框：当我们把 quad 放大后，这个边框会“压到相邻 tile 上”，clip 会把它裁掉
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 10;
      ctx.strokeRect(5, 5, tileSize - 10, tileSize - 10);

      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(12, 12, tileSize - 24, 44);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(`${tile.z}/${tile.wrap}/${tile.x}/${tile.y}`, 16, 40);

      if (typeof createImageBitmap === "function") {
        resolve(await createImageBitmap(c));
      } else {
        resolve(c);
      }
    }, delay);
  });
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

  window.addEventListener("keydown", (e) => {
    if (e.key === "q" || e.key === "Q") transform.setBearing(transform.bearing - 10);
    if (e.key === "e" || e.key === "E") transform.setBearing(transform.bearing + 10);
  });
}


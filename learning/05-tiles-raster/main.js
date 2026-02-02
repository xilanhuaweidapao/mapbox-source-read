import { createProgram, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";
import { Transform2D } from "../_common/Transform2D.js";
import { createPanel } from "../_common/ui.js";

const TILE_SIZE = 256;

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

// ---------- UI ----------
const panel = createPanel({ title: "05 - Tiles Raster" });
let maxParallel = 8;
let maxCache = 120;
let showBorders = true;
let rasterOpacity = 1.0;

panel.addSlider("maxParallel", { min: 1, max: 32, step: 1, value: maxParallel }, (v) => (maxParallel = v));
panel.addSlider("maxCache", { min: 20, max: 400, step: 1, value: maxCache }, (v) => (maxCache = v));
panel.addCheckbox("showBorders", showBorders, (v) => (showBorders = v));
panel.addSlider("opacity", { min: 0, max: 1, step: 0.01, value: rasterOpacity }, (v) => (rasterOpacity = v));
panel.addSeparator();
const stats = panel.addText("Stats", "");

// ---------- Transform (pan/zoom/bearing) ----------
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

// ---------- Shaders ----------
// 使用 unit quad + per-tile origin/scale，把每个 tile 映射到 mercator 坐标空间
const VS_TILE = `
attribute vec2 a_unit;
varying vec2 v_uv;

uniform mat4 u_matrix;
uniform vec2 u_origin; // tile 左上角（mercator）
uniform vec2 u_scale;  // tile 尺寸（mercator）

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
uniform float u_opacity;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  c.a *= u_opacity;
  gl_FragColor = c;
}
`;

const VS_LINE = `
attribute vec2 a_unit;
uniform mat4 u_matrix;
uniform vec2 u_origin;
uniform vec2 u_scale;
void main() {
  vec2 merc = u_origin + a_unit * u_scale;
  gl_Position = u_matrix * vec4(merc, 0.0, 1.0);
}
`;

const FS_LINE = `
precision mediump float;
uniform vec4 u_color;
void main() { gl_FragColor = u_color; }
`;

const progTile = createProgram(gl, VS_TILE, FS_TILE);
const progLine = createProgram(gl, VS_LINE, FS_LINE);

// ---------- Shared geometry (unit quad) ----------
// a_unit: (0,0)(1,0)(1,1)(0,1)
const quad = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
const quadIdxTriangles = new Uint16Array([0, 1, 2, 0, 2, 3]);
const quadIdxLineLoop = new Uint16Array([0, 1, 2, 3]);

const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

const iboTri = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboTri);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIdxTriangles, gl.STATIC_DRAW);

const iboLine = gl.createBuffer();
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, iboLine);
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, quadIdxLineLoop, gl.STATIC_DRAW);

class TileStore {
  constructor(gl) {
    this.gl = gl;
    this._entries = new Map(); // key -> {texture, lastUsedFrame, state}
    this._queue = [];
    this._inFlight = 0;
    this._maxParallel = 8;
    this._maxCache = 120;
    this.lastEvicted = 0;
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

  cacheSize() {
    return this._entries.size;
  }

  inFlightCount() {
    return this._inFlight;
  }

  queueCount() {
    return this._queue.length;
  }

  markAndRequest(visibleTiles, frameId) {
    for (const t of visibleTiles) {
      const existing = this._entries.get(t.key);
      if (existing) {
        existing.lastUsedFrame = frameId;
        continue;
      }

      // 新 tile：加入缓存占位并排队请求
      this._entries.set(t.key, {
        state: "queued",
        lastUsedFrame: frameId,
        texture: null,
      });
      this._queue.push(t);
    }

    this._drainQueue();
    this._evictLRU(frameId);
  }

  _drainQueue() {
    while (this._inFlight < this._maxParallel && this._queue.length) {
      const t = this._queue.shift();
      const entry = this._entries.get(t.key);
      if (!entry || entry.state !== "queued") continue;
      entry.state = "loading";
      this._inFlight++;

      fakeFetchTileImage(t, TILE_SIZE)
        .then((img) => {
          const tex = this.gl.createTexture();
          this.gl.bindTexture(this.gl.TEXTURE_2D, tex);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.LINEAR);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.LINEAR);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
          this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
          this.gl.pixelStorei(this.gl.UNPACK_FLIP_Y_WEBGL, 0);
          this.gl.texImage2D(this.gl.TEXTURE_2D, 0, this.gl.RGBA, this.gl.RGBA, this.gl.UNSIGNED_BYTE, img);

          const now = performance.now();
          const existing = this._entries.get(t.key);
          if (existing) {
            existing.state = "ready";
            existing.texture = tex;
            existing.loadedAt = now;
          } else {
            this.gl.deleteTexture(tex);
          }
        })
        .catch((err) => {
          console.error("tile load error", err);
          const existing = this._entries.get(t.key);
          if (existing) existing.state = "error";
        })
        .finally(() => {
          this._inFlight--;
          this._drainQueue();
        });
    }
  }

  _evictLRU(frameId) {
    this.lastEvicted = 0;
    if (this._entries.size <= this._maxCache) return;

    // 简单 LRU：按 lastUsedFrame 从小到大淘汰
    const items = Array.from(this._entries.entries());
    items.sort((a, b) => a[1].lastUsedFrame - b[1].lastUsedFrame);

    const target = this._entries.size - this._maxCache;
    for (let i = 0; i < target; i++) {
      const [key, entry] = items[i];
      // 保护：本帧刚用过的不淘汰（避免边界抖动）
      if (entry.lastUsedFrame === frameId) continue;
      if (entry.texture) this.gl.deleteTexture(entry.texture);
      this._entries.delete(key);
      this.lastEvicted++;
    }
  }
}

// ---------- Tile Store (queue + cache + textures) ----------
const tiles = new TileStore(gl);

let frameId = 0;
function frame() {
  frameId++;

  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const tileZ = Math.max(0, Math.floor(transform.zoom));
  const visible = getVisibleTiles(transform, tileZ);

  tiles.setMaxParallel(maxParallel);
  tiles.setMaxCache(maxCache);
  tiles.markAndRequest(visible, frameId);

  const m = transform.getMercatorToClipMatrix();

  // draw raster tiles
  gl.useProgram(progTile);
  bindCommon(progTile, vbo, iboTri);
  gl.uniformMatrix4fv(gl.getUniformLocation(progTile, "u_matrix"), false, m);
  gl.uniform1f(gl.getUniformLocation(progTile, "u_opacity"), rasterOpacity);
  gl.activeTexture(gl.TEXTURE0);
  gl.uniform1i(gl.getUniformLocation(progTile, "u_tex"), 0);

  for (const t of visible) {
    const entry = tiles.get(t.key);
    if (!entry?.texture) continue;

    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.uniform2f(gl.getUniformLocation(progTile, "u_origin"), t.originX, t.originY);
    gl.uniform2f(gl.getUniformLocation(progTile, "u_scale"), t.scale, t.scale);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }

  // optional borders
  if (showBorders) {
    gl.useProgram(progLine);
    bindCommon(progLine, vbo, iboLine);
    gl.uniformMatrix4fv(gl.getUniformLocation(progLine, "u_matrix"), false, m);
    gl.uniform4f(gl.getUniformLocation(progLine, "u_color"), 1, 1, 1, 0.25);
    for (const t of visible) {
      gl.uniform2f(gl.getUniformLocation(progLine, "u_origin"), t.originX, t.originY);
      gl.uniform2f(gl.getUniformLocation(progLine, "u_scale"), t.scale, t.scale);
      gl.drawElements(gl.LINE_LOOP, 4, gl.UNSIGNED_SHORT, 0);
    }
  }

  const c = transform.getCenter();
  stats.set(
    `z=${tileZ} visible=${visible.length}\n` +
      `center=(${c.lng.toFixed(4)}, ${c.lat.toFixed(4)}) zoom=${transform.zoom.toFixed(2)} bearing=${transform.bearing.toFixed(
        1,
      )}°\n` +
      `cache=${tiles.cacheSize()} inFlight=${tiles.inFlightCount()} queued=${tiles.queueCount()} evicted=${tiles.lastEvicted}`,
  );

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

function bindCommon(program, vbo, ibo) {
  const aUnit = gl.getAttribLocation(program, "a_unit");
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(aUnit);
  gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
}

// 计算可视 tiles：把屏幕四角反投影到 mercator，再映射到 tile x/y 范围
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

  // Y 方向 Mercator 理论范围 [0,1]，这里做 clamp，避免极端拖拽出现负值
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
      const key = `${z}/${wrap}/${x}/${y}`;
      out.push({
        key,
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
  window.addEventListener("mouseup", () => {
    dragging = false;
  });

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

function fakeFetchTileImage(tile, tileSize) {
  // 模拟网络延迟：80~300ms
  const delay = 80 + Math.random() * 220;
  return new Promise((resolve) => {
    setTimeout(async () => {
      const c = document.createElement("canvas");
      c.width = tileSize;
      c.height = tileSize;
      const ctx = c.getContext("2d");

      // 背景色根据 z/x/y 变化（便于观察拼接）
      const r = (tile.x * 37 + tile.z * 13) % 255;
      const g = (tile.y * 53 + tile.z * 29) % 255;
      const b = (tile.x * 17 + tile.y * 19) % 255;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(0, 0, tileSize, tileSize);

      // 画一个“边框”，配合 line filtering 能看出边缘覆盖
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, tileSize - 6, tileSize - 6);

      // 写 z/x/y
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(10, 10, tileSize - 20, 56);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "18px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(`z/x/y`, 16, 34);
      ctx.fillText(`${tile.z}/${tile.wrap}/${tile.x}/${tile.y}`, 16, 58);

      // 小格子（帮助观察缩放/旋转）
      ctx.strokeStyle = "rgba(255,255,255,0.20)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 8; i++) {
        const p = (i * tileSize) / 8;
        ctx.beginPath();
        ctx.moveTo(p + 0.5, 0);
        ctx.lineTo(p + 0.5, tileSize);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p + 0.5);
        ctx.lineTo(tileSize, p + 0.5);
        ctx.stroke();
      }

      if (typeof createImageBitmap === "function") {
        const bmp = await createImageBitmap(c);
        resolve(bmp);
      } else {
        resolve(c);
      }
    }, delay);
  });
}


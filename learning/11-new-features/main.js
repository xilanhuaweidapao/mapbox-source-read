import { mustGetContext, resizeCanvasToDisplaySize, createProgram } from "../_common/gl.js";
import { Transform2D } from "../_common/Transform2D.js";
import { createPanel } from "../_common/ui.js";

const TILE_SIZE = 256;

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

const transform = new Transform2D({
  width: 2,
  height: 2,
  tileSize: TILE_SIZE,
  center: [0, 0],
  zoom: 2.2,
  bearing: 0,
  renderWorldCopies: true,
});
installInteractions({ canvas, transform });

// --- UI ---
const panel = createPanel({ title: "11 - New Features" });
let showBorders = true;
panel.addCheckbox("show tile borders", showBorders, (v) => (showBorders = v));
panel.addButton("Screenshot", () => screenshot());
panel.addSeparator();
const picked = panel.addText("Picked", "click a point");
panel.addSeparator();
const info = panel.addText("Info", "");

// --- Data: random points ---
const points = makePoints(120);
let selectedId = null;

canvas.addEventListener("click", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = (e.clientX - rect.left) * (canvas.width / rect.width);
  const y = (e.clientY - rect.top) * (canvas.height / rect.height);
  const hit = pickNearestPoint({ x, y, radius: 12 });
  selectedId = hit?.id ?? null;
  picked.set(hit ? `id=${hit.id}\nname=${hit.name}\nlng=${hit.lng.toFixed(4)} lat=${hit.lat.toFixed(4)}` : "none");
});

function pickNearestPoint({ x, y, radius }) {
  let best = null;
  let bestD2 = radius * radius;
  for (const p of points) {
    const s = transform.mercatorToScreen(p.mx, p.my);
    const dx = s.x - x;
    const dy = s.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  return best;
}

function screenshot() {
  // 注意：如果使用跨域图片纹理且未正确 CORS，canvas 会被 taint，toDataURL 会失败。
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = `map-screenshot-${Date.now()}.png`;
  a.click();
}

// --- Raster tiles (复用 05 的思路) ---
const raster = new RasterRenderer(gl);

// --- Circle points ---
const circle = new CircleRenderer(gl);

let frameId = 0;
function frame() {
  frameId++;

  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  // background
  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const z = Math.max(0, Math.floor(transform.zoom));
  raster.draw({ transform, tileZ: z, frameId });
  if (showBorders) raster.drawBorders({ transform, tileZ: z });

  circle.draw({ transform, points, selectedId });

  const c = transform.getCenter();
  info.set(
    `center=(${c.lng.toFixed(4)}, ${c.lat.toFixed(4)})\n` +
      `zoom=${transform.zoom.toFixed(2)} bearing=${transform.bearing.toFixed(1)}°\n` +
      `tiles visible=${raster.lastVisibleCount}`,
  );

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ---------------- RasterRenderer ----------------

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
void main() { gl_FragColor = texture2D(u_tex, v_uv); }
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

class RasterRenderer {
  constructor(gl) {
    this.gl = gl;
    this.tiles = new TileStore(gl);
    this.progTile = createProgram(gl, VS_TILE, FS_TILE);
    this.progLine = createProgram(gl, VS_LINE, FS_LINE);
    this.lastVisibleCount = 0;

    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);

    this.iboTri = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iboTri);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);

    this.iboLine = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.iboLine);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 3]), gl.STATIC_DRAW);
  }

  draw({ transform, tileZ, frameId }) {
    const visible = getVisibleTiles(transform, tileZ);
    this.lastVisibleCount = visible.length;
    this.tiles.setMaxParallel(10);
    this.tiles.setMaxCache(220);
    this.tiles.markAndRequest(visible, frameId);

    const gl = this.gl;
    const m = transform.getMercatorToClipMatrix();

    gl.useProgram(this.progTile);
    bindQuad(gl, this.progTile, this.vbo, this.iboTri);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progTile, "u_matrix"), false, m);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(this.progTile, "u_tex"), 0);

    for (const t of visible) {
      const e = this.tiles.get(t.key);
      if (!e?.texture) continue;
      gl.bindTexture(gl.TEXTURE_2D, e.texture);
      gl.uniform2f(gl.getUniformLocation(this.progTile, "u_origin"), t.originX, t.originY);
      gl.uniform2f(gl.getUniformLocation(this.progTile, "u_scale"), t.scale, t.scale);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
  }

  drawBorders({ transform, tileZ }) {
    const visible = getVisibleTiles(transform, tileZ);
    const gl = this.gl;
    const m = transform.getMercatorToClipMatrix();
    gl.useProgram(this.progLine);
    bindQuad(gl, this.progLine, this.vbo, this.iboLine);
    gl.uniformMatrix4fv(gl.getUniformLocation(this.progLine, "u_matrix"), false, m);
    gl.uniform4f(gl.getUniformLocation(this.progLine, "u_color"), 1, 1, 1, 0.25);
    for (const t of visible) {
      gl.uniform2f(gl.getUniformLocation(this.progLine, "u_origin"), t.originX, t.originY);
      gl.uniform2f(gl.getUniformLocation(this.progLine, "u_scale"), t.scale, t.scale);
      gl.drawElements(gl.LINE_LOOP, 4, gl.UNSIGNED_SHORT, 0);
    }
  }
}

function bindQuad(gl, program, vbo, ibo) {
  const a = gl.getAttribLocation(program, "a_unit");
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
}

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
        originX: (x + wrap * tilesAtZ) / tilesAtZ,
        originY: y / tilesAtZ,
        scale: 1 / tilesAtZ,
        z,
        x,
        y,
        wrap,
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
    this._maxParallel = 10;
    this._maxCache = 220;
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
  const delay = 50 + Math.random() * 150;
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
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 6;
      ctx.strokeRect(3, 3, tileSize - 6, tileSize - 6);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(10, 10, tileSize - 20, 38);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(`${tile.z}/${tile.wrap}/${tile.x}/${tile.y}`, 14, 36);
      if (typeof createImageBitmap === "function") resolve(await createImageBitmap(c));
      else resolve(c);
    }, delay);
  });
}

// ---------------- CircleRenderer ----------------

const VS_CIRCLE = `
attribute vec2 a_pos;
uniform mat4 u_matrix;
uniform float u_radius;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_radius * 2.0;
}
`;
const FS_CIRCLE = `
precision mediump float;
uniform vec4 u_color;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  if (dot(p,p) > 1.0) discard;
  gl_FragColor = u_color;
}
`;

class CircleRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, VS_CIRCLE, FS_CIRCLE);
    this.vbo = gl.createBuffer();
  }

  draw({ transform, points, selectedId }) {
    const gl = this.gl;
    const m = transform.getMercatorToClipMatrix();

    const verts = [];
    for (const p of points) verts.push(p.mx, p.my);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);

    gl.useProgram(this.program);
    const aPos = gl.getAttribLocation(this.program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "u_matrix"), false, m);

    // 先画全部点
    gl.uniform1f(gl.getUniformLocation(this.program, "u_radius"), 5.5);
    gl.uniform4f(gl.getUniformLocation(this.program, "u_color"), 1.0, 0.9, 0.2, 1.0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.POINTS, 0, points.length);

    // 再画选中点（更大、更亮）
    if (selectedId) {
      const idx = points.findIndex((p) => p.id === selectedId);
      if (idx >= 0) {
        gl.uniform1f(gl.getUniformLocation(this.program, "u_radius"), 9.0);
        gl.uniform4f(gl.getUniformLocation(this.program, "u_color"), 1.0, 0.2, 0.2, 1.0);
        gl.drawArrays(gl.POINTS, idx, 1);
      }
    }
  }
}

// ---------------- points + interaction ----------------

function makePoints(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const lng = -180 + Math.random() * 360;
    const lat = -70 + Math.random() * 140;
    const mx = (lng + 180) / 360;
    const my = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
    out.push({ id: `P${i}`, name: `Point ${i}`, lng, lat, mx, my });
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

  window.addEventListener("keydown", (e) => {
    if (e.key === "q" || e.key === "Q") transform.setBearing(transform.bearing - 10);
    if (e.key === "e" || e.key === "E") transform.setBearing(transform.bearing + 10);
  });
}


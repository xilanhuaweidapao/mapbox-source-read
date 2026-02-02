import { createProgram, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";
import { Transform2D } from "../_common/Transform2D.js";
import { createPanel } from "../_common/ui.js";

const TILE_SIZE = 256;

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

// 迷你 Transform（可拖拽/滚轮缩放）
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

// --- Mini Style JSON（只支持极少字段） ---
const STYLES = {
  dark: {
    version: 8,
    sources: {
      raster: { type: "raster", tileSize: 256 },
      points: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            pt(0, 0, "Null Island"),
            pt(116.4074, 39.9042, "Beijing"),
            pt(-74.006, 40.7128, "New York"),
            pt(151.2093, -33.8688, "Sydney"),
          ],
        },
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#0b1020" } },
      { id: "r", type: "raster", source: "raster", paint: { "raster-opacity": 1.0 } },
      { id: "c", type: "circle", source: "points", paint: { "circle-radius": 7, "circle-color": "#ffd84a" } },
    ],
  },
  light: {
    version: 8,
    sources: {
      raster: { type: "raster", tileSize: 256 },
      points: {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            pt(0, 0, "Null Island"),
            pt(2.3522, 48.8566, "Paris"),
            pt(139.6917, 35.6895, "Tokyo"),
            pt(-58.3816, -34.6037, "Buenos Aires"),
          ],
        },
      },
    },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#f5f7fb" } },
      { id: "r", type: "raster", source: "raster", paint: { "raster-opacity": 0.9 } },
      { id: "c", type: "circle", source: "points", paint: { "circle-radius": 8, "circle-color": "#1060ff" } },
    ],
  },
};

function pt(lng, lat, name) {
  return { type: "Feature", properties: { name }, geometry: { type: "Point", coordinates: [lng, lat] } };
}

let style = STYLES.dark;

// --- UI ---
const panel = createPanel({ title: "06 - Style Min" });
panel.addSelect(
  "style",
  [
    { label: "dark", value: "dark" },
    { label: "light", value: "light" },
  ],
  "dark",
  (v) => {
    style = STYLES[v];
  },
);
let showCircles = true;
panel.addCheckbox("show circles", showCircles, (v) => (showCircles = v));

let overrideRasterOpacity = null;
panel.addSlider("raster-opacity", { min: 0, max: 1, step: 0.01, value: 1 }, (v) => (overrideRasterOpacity = v));
panel.addSeparator();
const info = panel.addText("Info", "");

// --- Raster renderer (复用 05 的思想，但这里更简单) ---
const raster = new RasterRenderer(gl);

// --- Circle renderer（gl.POINTS 画圆） ---
const circle = new CircleRenderer(gl);

let frameId = 0;
function frame() {
  frameId++;

  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  // style layers：按顺序绘制
  for (const layer of style.layers) {
    if (layer.type === "background") {
      const c = layer.paint?.["background-color"] || "#000";
      const rgb = hexToRgb01(c);
      gl.clearColor(rgb.r, rgb.g, rgb.b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      continue;
    }

    if (layer.type === "raster") {
      const opacity =
        overrideRasterOpacity != null ? overrideRasterOpacity : layer.paint?.["raster-opacity"] ?? 1.0;
      raster.draw({ transform, opacity, tileZ: Math.max(0, Math.floor(transform.zoom)), frameId });
      continue;
    }

    if (layer.type === "circle" && showCircles) {
      const src = style.sources[layer.source];
      const radius = layer.paint?.["circle-radius"] ?? 6;
      const color = hexToRgb01(layer.paint?.["circle-color"] || "#fff");
      circle.draw({ transform, geojson: src.data, radius, color });
      continue;
    }
  }

  const c = transform.getCenter();
  info.set(
    `center=(${c.lng.toFixed(4)}, ${c.lat.toFixed(4)})\nzoom=${transform.zoom.toFixed(2)} bearing=${transform.bearing.toFixed(
      1,
    )}°`,
  );

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ----------------- Renderers -----------------

class RasterRenderer {
  constructor(gl) {
    this.gl = gl;
    this.tiles = new TileStore(gl);
    this.program = createProgram(gl, VS_TILE, FS_TILE);

    // unit quad
    this.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    this.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
  }

  draw({ transform, opacity, tileZ, frameId }) {
    const visible = getVisibleTiles(transform, tileZ);
    this.tiles.setMaxParallel(8);
    this.tiles.setMaxCache(160);
    this.tiles.markAndRequest(visible, frameId);

    const gl = this.gl;
    const m = transform.getMercatorToClipMatrix();

    gl.useProgram(this.program);
    bindUnitQuad(gl, this.program, this.vbo, this.ibo);

    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "u_matrix"), false, m);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_opacity"), opacity);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(this.program, "u_tex"), 0);

    for (const t of visible) {
      const entry = this.tiles.get(t.key);
      if (!entry?.texture) continue;
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      gl.uniform2f(gl.getUniformLocation(this.program, "u_origin"), t.originX, t.originY);
      gl.uniform2f(gl.getUniformLocation(this.program, "u_scale"), t.scale, t.scale);
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
  }
}

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
uniform float u_opacity;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  c.a *= u_opacity;
  gl_FragColor = c;
}
`;

class CircleRenderer {
  constructor(gl) {
    this.gl = gl;
    this.program = createProgram(gl, VS_CIRCLE, FS_CIRCLE);
    this.vbo = gl.createBuffer();
  }

  draw({ transform, geojson, radius, color }) {
    const gl = this.gl;
    const m = transform.getMercatorToClipMatrix();

    const pts = [];
    for (const f of geojson.features) {
      const [lng, lat] = f.geometry.coordinates;
      const x = (lng + 180) / 360;
      const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
      pts.push(x, y);
    }

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pts), gl.DYNAMIC_DRAW);

    const aPos = gl.getAttribLocation(this.program, "a_pos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(gl.getUniformLocation(this.program, "u_matrix"), false, m);
    gl.uniform1f(gl.getUniformLocation(this.program, "u_radius"), radius);
    gl.uniform4f(gl.getUniformLocation(this.program, "u_color"), color.r, color.g, color.b, 1);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawArrays(gl.POINTS, 0, pts.length / 2);
  }
}

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
  float d = dot(p,p);
  if (d > 1.0) discard;
  gl_FragColor = u_color;
}
`;

function bindUnitQuad(gl, program, vbo, ibo) {
  const a = gl.getAttribLocation(program, "a_unit");
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.enableVertexAttribArray(a);
  gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
}

// 视口 → 可视 tiles（和 05 类似）
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
    this._maxCache = 160;
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
  const delay = 60 + Math.random() * 180;
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
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(10, 10, tileSize - 20, 40);
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = "16px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
      ctx.fillText(`${tile.z}/${tile.wrap}/${tile.x}/${tile.y}`, 16, 38);
      if (typeof createImageBitmap === "function") {
        resolve(await createImageBitmap(c));
      } else {
        resolve(c);
      }
    }, delay);
  });
}

function hexToRgb01(hex) {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
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


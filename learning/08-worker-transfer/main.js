import { mustGetContext, resizeCanvasToDisplaySize, createProgram } from "../_common/gl.js";
import { Transform2D } from "../_common/Transform2D.js";
import { createPanel } from "../_common/ui.js";

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

const transform = new Transform2D({
  width: 2,
  height: 2,
  tileSize: 256,
  center: [0, 20],
  zoom: 1.2,
  bearing: 0,
  renderWorldCopies: true,
});
installInteractions({ canvas, transform });

const panel = createPanel({ title: "08 - Worker Transfer" });
const btnW = panel.addButton("Rebuild in Worker", () => rebuildInWorker());
const btnM = panel.addButton("Rebuild in Main", () => rebuildInMain());
panel.addSeparator();
const stats = panel.addText("Stats", "");

// 大一点的数据：一条长折线 + 一个凸多边形
const geojson = makeDataset();

// shaders（同 07）
const VS = `
attribute vec2 a_pos;
attribute vec4 a_color;
uniform mat4 u_matrix;
varying vec4 v_color;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  v_color = a_color;
}
`;
const FS = `
precision mediump float;
varying vec4 v_color;
void main() { gl_FragColor = v_color; }
`;

const program = createProgram(gl, VS, FS);
const aPos = gl.getAttribLocation(program, "a_pos");
const aColor = gl.getAttribLocation(program, "a_color");
const uMatrix = gl.getUniformLocation(program, "u_matrix");

gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

// 当前 GPU 资源
let fillGpu = null;
let lineGpu = null;
let lastBuildMs = 0;
let lastUploadMs = 0;
let mode = "worker";

// 启动 worker 并先构建一次
const worker = new Worker("./worker.js");
worker.onmessage = (e) => {
  if (e.data.type !== "built") return;
  mode = "worker";
  lastBuildMs = e.data.buildMs;

  const t0 = performance.now();
  disposeGpu();
  fillGpu = uploadBucket(gl, e.data.fill);
  lineGpu = uploadBucket(gl, e.data.line);
  lastUploadMs = performance.now() - t0;
};

rebuildInWorker();

function rebuildInWorker() {
  worker.postMessage({ type: "build", geojson });
}

function rebuildInMain() {
  mode = "main";
  const t0 = performance.now();
  const fill = buildFillBucket(geojson);
  const line = buildLineBucket(geojson);
  lastBuildMs = performance.now() - t0;

  const t1 = performance.now();
  disposeGpu();
  fillGpu = uploadBucket(gl, fill);
  lineGpu = uploadBucket(gl, line);
  lastUploadMs = performance.now() - t1;
}

function frame() {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniformMatrix4fv(uMatrix, false, transform.getMercatorToClipMatrix());

  if (fillGpu) {
    bindBucket(gl, fillGpu, aPos, aColor);
    gl.drawElements(gl.TRIANGLES, fillGpu.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  if (lineGpu) {
    bindBucket(gl, lineGpu, aPos, aColor);
    gl.drawElements(gl.LINES, lineGpu.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  stats.set(
    `mode=${mode}\n` +
      `build=${lastBuildMs.toFixed(2)}ms\n` +
      `upload=${lastUploadMs.toFixed(2)}ms\n` +
      `line vertices=${lineGpu ? lineGpu.vertexCount : 0}`,
  );

  requestAnimationFrame(frame);
}

frame();

window.addEventListener("beforeunload", () => worker.terminate());

// ---------------- dataset + bucket build (main thread version) ----------------

function makeDataset() {
  const features = [];

  // 一个凸多边形
  features.push({
    type: "Feature",
    properties: { color: [80, 200, 255, 120] },
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-12, 36],
          [25, 36],
          [30, 52],
          [10, 60],
          [-15, 52],
          [-12, 36],
        ],
      ],
    },
  });

  // 一条很长的折线：随机游走（让 build 有一定成本）
  const coords = [];
  let lng = -120;
  let lat = 10;
  for (let i = 0; i < 5000; i++) {
    lng += (Math.random() - 0.5) * 0.08;
    lat += (Math.random() - 0.5) * 0.05;
    coords.push([lng, lat]);
  }
  features.push({
    type: "Feature",
    properties: { color: [255, 170, 80, 255] },
    geometry: { type: "LineString", coordinates: coords },
  });

  return { type: "FeatureCollection", features };
}

function lngLatToMercator(lng, lat) {
  const x = (lng + 180) / 360;
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360;
  return { x, y };
}

function buildFillBucket(fc) {
  const positions = [];
  const colors = [];
  const indices = [];
  for (const feature of fc.features) {
    if (feature.geometry.type !== "Polygon") continue;
    const ring = feature.geometry.coordinates[0];
    const base = positions.length / 2;
    const rgba = feature.properties.color;
    for (let i = 0; i < ring.length - 1; i++) {
      const m = lngLatToMercator(ring[i][0], ring[i][1]);
      positions.push(m.x, m.y);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }
    const n = ring.length - 1;
    for (let i = 1; i < n - 1; i++) indices.push(base + 0, base + i, base + i + 1);
  }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), indices: new Uint16Array(indices), vertexCount: positions.length / 2 };
}

function buildLineBucket(fc) {
  const positions = [];
  const colors = [];
  const indices = [];
  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    const base = positions.length / 2;
    const rgba = feature.properties.color;
    for (let i = 0; i < coords.length; i++) {
      const m = lngLatToMercator(coords[i][0], coords[i][1]);
      positions.push(m.x, m.y);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }
    for (let i = 0; i < coords.length - 1; i++) indices.push(base + i, base + i + 1);
  }
  return { positions: new Float32Array(positions), colors: new Uint8Array(colors), indices: new Uint16Array(indices), vertexCount: positions.length / 2 };
}

// ---------------- upload + draw ----------------

function uploadBucket(gl, bucket) {
  const pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, bucket.positions, gl.STATIC_DRAW);

  const col = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, col);
  gl.bufferData(gl.ARRAY_BUFFER, bucket.colors, gl.STATIC_DRAW);

  const idx = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, bucket.indices, gl.STATIC_DRAW);

  return { pos, col, idx, indexCount: bucket.indices.length, vertexCount: bucket.vertexCount };
}

function bindBucket(gl, gpu, aPos, aColor) {
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.pos);
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.col);
  gl.enableVertexAttribArray(aColor);
  gl.vertexAttribPointer(aColor, 4, gl.UNSIGNED_BYTE, true, 0, 0);

  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.idx);
}

function disposeGpu() {
  if (fillGpu) {
    gl.deleteBuffer(fillGpu.pos);
    gl.deleteBuffer(fillGpu.col);
    gl.deleteBuffer(fillGpu.idx);
    fillGpu = null;
  }
  if (lineGpu) {
    gl.deleteBuffer(lineGpu.pos);
    gl.deleteBuffer(lineGpu.col);
    gl.deleteBuffer(lineGpu.idx);
    lineGpu = null;
  }
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


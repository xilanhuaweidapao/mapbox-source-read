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

const panel = createPanel({ title: "07 - Vector Bucket" });
let showFill = true;
let showLine = true;
panel.addCheckbox("show fill", showFill, (v) => (showFill = v));
panel.addCheckbox("show line", showLine, (v) => (showLine = v));
panel.addSeparator();
const info = panel.addText("Bucket", "");

// 一个很小的 GeoJSON（凸多边形 + 线）
const geojson = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: { color: [80, 200, 255, 140] },
      geometry: {
        type: "Polygon",
        // 一个凸多边形（大致在欧洲附近）
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
    },
    {
      type: "Feature",
      properties: { color: [255, 170, 80, 255] },
      geometry: {
        type: "LineString",
        coordinates: [
          [-74.006, 40.7128], // New York
          [-0.1276, 51.5072], // London
          [116.4074, 39.9042], // Beijing
          [139.6917, 35.6895], // Tokyo
        ],
      },
    },
  ],
};

// build buckets（纯数据对象：typed arrays）
const fillBucket = buildFillBucket(geojson);
const lineBucket = buildLineBucket(geojson);

// upload buckets（WebGL buffers）
const fillGpu = uploadBucket(gl, fillBucket);
const lineGpu = uploadBucket(gl, lineBucket);

// 一个通用 shader：a_pos (vec2) + a_color (UNSIGNED_BYTE normalized)
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

function frame() {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniformMatrix4fv(uMatrix, false, transform.getMercatorToClipMatrix());

  if (showFill) {
    bindBucket(gl, fillGpu, aPos, aColor);
    gl.drawElements(gl.TRIANGLES, fillGpu.indexCount, gl.UNSIGNED_SHORT, 0);
  }
  if (showLine) {
    bindBucket(gl, lineGpu, aPos, aColor);
    gl.drawElements(gl.LINES, lineGpu.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  info.set(
    `fill: vertices=${fillBucket.vertexCount} indices=${fillBucket.indices.length}\n` +
      `line: vertices=${lineBucket.vertexCount} indices=${lineBucket.indices.length}\n` +
      `color attr: UNSIGNED_BYTE normalized`,
  );

  requestAnimationFrame(frame);
}

frame();

// ---------------- bucket build ----------------

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
    const baseIndex = positions.length / 2;
    const rgba = feature.properties.color || [80, 200, 255, 180];

    // 顶点
    for (let i = 0; i < ring.length - 1; i++) {
      const [lng, lat] = ring[i];
      const m = lngLatToMercator(lng, lat);
      positions.push(m.x, m.y);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    const n = ring.length - 1; // 去掉闭合点
    // 最小三角化：凸多边形 triangle fan：0,i,i+1
    for (let i = 1; i < n - 1; i++) {
      indices.push(baseIndex + 0, baseIndex + i, baseIndex + i + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 2,
  };
}

function buildLineBucket(fc) {
  const positions = [];
  const colors = [];
  const indices = [];

  for (const feature of fc.features) {
    if (feature.geometry.type !== "LineString") continue;
    const coords = feature.geometry.coordinates;
    const baseIndex = positions.length / 2;
    const rgba = feature.properties.color || [255, 170, 80, 255];

    for (let i = 0; i < coords.length; i++) {
      const [lng, lat] = coords[i];
      const m = lngLatToMercator(lng, lat);
      positions.push(m.x, m.y);
      colors.push(rgba[0], rgba[1], rgba[2], rgba[3]);
    }

    for (let i = 0; i < coords.length - 1; i++) {
      indices.push(baseIndex + i, baseIndex + i + 1);
    }
  }

  return {
    positions: new Float32Array(positions),
    colors: new Uint8Array(colors),
    indices: new Uint16Array(indices),
    vertexCount: positions.length / 2,
  };
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

  return { pos, col, idx, indexCount: bucket.indices.length };
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


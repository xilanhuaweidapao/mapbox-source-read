import { createBuffer, createProgram, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";
import { Transform2D } from "../_common/Transform2D.js";
import { createPanel } from "../_common/ui.js";

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

const panel = createPanel({ title: "04 - Transform" });
const info = panel.addText("State", "");
panel.addSeparator();
const hint = panel.addText("Hint", "Drag/Wheel/Q/E");

const transform = new Transform2D({
  width: 2,
  height: 2,
  tileSize: 256,
  center: [0, 0],
  zoom: 1.5,
  bearing: 0,
  renderWorldCopies: true,
});

// 一个简单的“线 + 点”渲染器：输入 mercator 坐标（x,y），用 u_matrix 投影到 clip。
const VS = `
attribute vec2 a_pos;
uniform mat4 u_matrix;
uniform float u_pointSize;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
  gl_PointSize = u_pointSize;
}
`;
const FS = `
precision mediump float;
uniform vec4 u_color;
uniform bool u_circle;
void main() {
  if (u_circle) {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
  }
  gl_FragColor = u_color;
}
`;

const program = createProgram(gl, VS, FS);
gl.useProgram(program);
const aPos = gl.getAttribLocation(program, "a_pos");
const uMatrix = gl.getUniformLocation(program, "u_matrix");
const uColor = gl.getUniformLocation(program, "u_color");
const uPointSize = gl.getUniformLocation(program, "u_pointSize");
const uCircle = gl.getUniformLocation(program, "u_circle");

// 生成一个“世界网格”（mercator 0..1 的线）
const gridVertices = buildGridLines();
const gridVbo = createBuffer(gl, gl.ARRAY_BUFFER, gridVertices, gl.STATIC_DRAW);
const gridCount = gridVertices.length / 2;

// 一些“固定点”（示例：几个经纬度）
const points = [
  { name: "Null Island", lng: 0, lat: 0 },
  { name: "Beijing", lng: 116.4074, lat: 39.9042 },
  { name: "New York", lng: -74.006, lat: 40.7128 },
  { name: "Sydney", lng: 151.2093, lat: -33.8688 },
  { name: "Quito", lng: -78.4678, lat: -0.1807 },
];
const pointVertices = buildPointVertices(points);
const pointVbo = createBuffer(gl, gl.ARRAY_BUFFER, pointVertices, gl.STATIC_DRAW);
const pointCount = pointVertices.length / 2;

gl.enableVertexAttribArray(aPos);

function buildGridLines() {
  const lines = [];
  // 经线/纬线：每 0.1 画一条
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // vertical line x=t, y 0..1
    lines.push(t, 0, t, 1);
    // horizontal line y=t, x 0..1
    lines.push(0, t, 1, t);
  }
  return new Float32Array(lines);
}

function buildPointVertices(list) {
  const out = [];
  for (const p of list) {
    // 复用 Transform2D 的 mercator 公式：我们只需要 lng/lat -> mercator
    const mx = (p.lng + 180) / 360;
    const my =
      (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (p.lat * Math.PI) / 360))) / 360;
    out.push(mx, my);
  }
  return new Float32Array(out);
}

// 交互：拖拽平移
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

// 交互：滚轮缩放（以鼠标点为锚）
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

// 交互：Q/E 旋转
window.addEventListener("keydown", (e) => {
  if (e.key === "q" || e.key === "Q") transform.setBearing(transform.bearing - 10);
  if (e.key === "e" || e.key === "E") transform.setBearing(transform.bearing + 10);
});

function frame() {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    transform.setSize(canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const m = transform.getMercatorToClipMatrix();
  gl.useProgram(program);
  gl.uniformMatrix4fv(uMatrix, false, m);

  // draw grid lines
  gl.bindBuffer(gl.ARRAY_BUFFER, gridVbo);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform4f(uColor, 0.2, 0.6, 1.0, 0.22);
  gl.uniform1f(uPointSize, 1.0);
  gl.uniform1i(uCircle, 0);
  gl.drawArrays(gl.LINES, 0, gridCount);

  // draw points
  gl.bindBuffer(gl.ARRAY_BUFFER, pointVbo);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform4f(uColor, 1.0, 0.9, 0.2, 1.0);
  gl.uniform1f(uPointSize, 10.0);
  gl.uniform1i(uCircle, 1);
  gl.drawArrays(gl.POINTS, 0, pointCount);

  const c = transform.getCenter();
  info.set(
    `center.lng=${c.lng.toFixed(5)}\n` +
      `center.lat=${c.lat.toFixed(5)}\n` +
      `zoom=${transform.zoom.toFixed(3)}\n` +
      `bearing=${transform.bearing.toFixed(1)}°\n` +
      `worldSize=${transform.worldSize.toFixed(1)}px`,
  );
  hint.set("拖拽平移，滚轮缩放（以鼠标为锚），Q/E 旋转");

  requestAnimationFrame(frame);
}

frame();

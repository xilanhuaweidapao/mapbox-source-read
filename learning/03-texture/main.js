import { createBuffer, createProgram, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";
import { createPanel } from "../_common/ui.js";

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true, premultipliedAlpha: true });

const panel = createPanel({ title: "03 - Texture" });

let filter = "LINEAR";
let flipY = false;
let premultiplyAlpha = true;
let opacity = 1.0;

panel.addSelect(
  "Filter",
  [
    { label: "NEAREST", value: "NEAREST" },
    { label: "LINEAR", value: "LINEAR" },
  ],
  filter,
  (v) => {
    filter = v;
    uploadTexture();
  },
);
panel.addCheckbox("flipY", flipY, (v) => {
  flipY = v;
  uploadTexture();
});
panel.addCheckbox("premultiplyAlpha", premultiplyAlpha, (v) => {
  premultiplyAlpha = v;
  uploadTexture();
});
panel.addSlider("opacity", { min: 0, max: 1, step: 0.01, value: opacity }, (v) => (opacity = v));

panel.addSeparator();
const info = panel.addText("Info", "");

const VS = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}
`;

const FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_opacity;
varying vec2 v_uv;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  c.a *= u_opacity;
  gl_FragColor = c;
}
`;

const program = createProgram(gl, VS, FS);
gl.useProgram(program);

const aPos = gl.getAttribLocation(program, "a_pos");
const aUV = gl.getAttribLocation(program, "a_uv");
const uTex = gl.getUniformLocation(program, "u_tex");
const uOpacity = gl.getUniformLocation(program, "u_opacity");

// 一个贴图矩形（全屏中间一块）
const quad = new Float32Array([
  // x, y, u, v
  -0.7, -0.7, 0, 0,
  0.7, -0.7, 1, 0,
  0.7, 0.7, 1, 1,
  -0.7, 0.7, 0, 1,
]);
const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

const vbo = createBuffer(gl, gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
const ibo = createBuffer(gl, gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);

const stride = 4 * 4;
gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
gl.enableVertexAttribArray(aUV);
gl.vertexAttribPointer(aUV, 2, gl.FLOAT, false, stride, 2 * 4);

// 生成一张“测试纹理”（离线、无跨域问题）
const testCanvas = makeTestCanvas();
const tex = gl.createTexture();
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.uniform1i(uTex, 0);

// 透明图叠加时，打开 blending 才能看到 alpha 效果
gl.enable(gl.BLEND);
// 这里使用“预乘 alpha”的常见 blend 配置：
// premultiplied: src=ONE, dst=ONE_MINUS_SRC_ALPHA
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

uploadTexture();

function uploadTexture() {
  gl.bindTexture(gl.TEXTURE_2D, tex);

  // 这些像素存储状态是 WebGL 的全局状态（仓库会用 gl/value.js 做缓存）
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY ? 1 : 0);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplyAlpha ? 1 : 0);

  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, testCanvas);

  const f = filter === "NEAREST" ? gl.NEAREST : gl.LINEAR;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function makeTestCanvas() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext("2d");

  // 背景（透明）
  ctx.clearRect(0, 0, c.width, c.height);

  // 画一个带柔和 alpha 的圆形（透明边缘非常适合观察 premultiply 的差异）
  const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 58);
  g.addColorStop(0.0, "rgba(255, 80, 80, 1.0)");
  g.addColorStop(0.7, "rgba(255, 80, 80, 0.6)");
  g.addColorStop(1.0, "rgba(255, 80, 80, 0.0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();

  // 叠一层白色网格线（让你更容易看到过滤差异）
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = i * 16;
    ctx.beginPath();
    ctx.moveTo(p + 0.5, 0);
    ctx.lineTo(p + 0.5, 128);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, p + 0.5);
    ctx.lineTo(128, p + 0.5);
    ctx.stroke();
  }

  // 文字标签
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(6, 6, 70, 18);
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("alpha test", 10, 20);

  return c;
}

function frame() {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  // 背景设置成“偏亮”能更明显看到透明边缘
  gl.clearColor(0.12, 0.13, 0.16, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniform1f(uOpacity, opacity);
  gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

  info.set(
    `filter=${filter}\nflipY=${flipY}\npremultiplyAlpha=${premultiplyAlpha}\nblend=ONE / ONE_MINUS_SRC_ALPHA`,
  );

  requestAnimationFrame(frame);
}

frame();


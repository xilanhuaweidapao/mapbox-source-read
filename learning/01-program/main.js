import { createBuffer, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";
import { createPanel } from "../_common/ui.js";

class Program {
  constructor(gl, vertexSource, fragmentSource) {
    this.gl = gl;
    this.program = this._createProgram(vertexSource, fragmentSource);
    this._attribCache = new Map();
    this._uniformCache = new Map();
  }

  use() {
    this.gl.useProgram(this.program);
  }

  attrib(name) {
    if (this._attribCache.has(name)) return this._attribCache.get(name);
    const loc = this.gl.getAttribLocation(this.program, name);
    this._attribCache.set(name, loc);
    return loc;
  }

  uniform(name) {
    if (this._uniformCache.has(name)) return this._uniformCache.get(name);
    const loc = this.gl.getUniformLocation(this.program, name);
    this._uniformCache.set(name, loc);
    return loc;
  }

  dispose() {
    this.gl.deleteProgram(this.program);
  }

  _createProgram(vsSource, fsSource) {
    const gl = this.gl;
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program) || "";
      gl.deleteProgram(program);
      throw new Error(`Program link failed:\n${log}`);
    }
    return program;
  }
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "";
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed:\n${log}\n\nSource:\n${source}`);
  }
  return shader;
}

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

const panel = createPanel({ title: "01 - Program Wrapper" });
let mode = "vertex";
panel.addSelect(
  "Program",
  [
    { label: "VertexColor", value: "vertex" },
    { label: "UniformColor", value: "uniform" },
  ],
  mode,
  (v) => {
    mode = v;
  },
);

const timeSpeed = { value: 1.0 };
panel.addSlider("u_time speed", { min: 0, max: 3, step: 0.01, value: timeSpeed.value }, (v) => (timeSpeed.value = v));

panel.addSeparator();
const info = panel.addText("Info", "");

// 共享一份顶点 buffer：三角形（位置 + 颜色）
const vertexData = new Float32Array([
  -0.7, -0.6, 1, 0, 0,
  0.7, -0.6, 0, 1, 0,
  0.0, 0.7, 0, 0, 1,
]);
const vbo = createBuffer(gl, gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);
const stride = 5 * 4;

// Program A：颜色来自顶点属性
const VS_VERTEX = `
attribute vec2 a_pos;
attribute vec3 a_color;
varying vec3 v_color;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_color = a_color;
}
`;
const FS_VERTEX = `
precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`;

// Program B：颜色来自 uniform，演示“program 切换时 attribute 集合不同”
const VS_UNIFORM = `
attribute vec2 a_pos;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;
const FS_UNIFORM = `
precision mediump float;
uniform vec3 u_color;
void main() {
  gl_FragColor = vec4(u_color, 1.0);
}
`;

const progVertex = new Program(gl, VS_VERTEX, FS_VERTEX);
const progUniform = new Program(gl, VS_UNIFORM, FS_UNIFORM);

function bindTriangleAttributes(program) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

  const aPos = program.attrib("a_pos");
  if (aPos >= 0) {
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
  }

  const aColor = program.attrib("a_color");
  if (aColor >= 0) {
    gl.enableVertexAttribArray(aColor);
    gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 2 * 4);
  }
}

let lastT = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000);
  lastT = t;

  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  const program = mode === "vertex" ? progVertex : progUniform;
  program.use();
  bindTriangleAttributes(program);

  if (mode === "uniform") {
    const uColor = program.uniform("u_color");
    const s = Math.sin(t * 0.001 * timeSpeed.value) * 0.5 + 0.5;
    gl.uniform3f(uColor, 0.2 + 0.8 * s, 0.4, 1.0 - 0.7 * s);
  }

  gl.drawArrays(gl.TRIANGLES, 0, 3);

  info.set(
    `mode=${mode}\n` +
      `attrib a_pos=${program.attrib("a_pos")} a_color=${program.attrib("a_color")}\n` +
      `uniform u_color=${String(program.uniform("u_color"))}`,
  );

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);


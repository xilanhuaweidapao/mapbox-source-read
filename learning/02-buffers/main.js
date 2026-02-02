import { createProgram, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";
import { createPanel } from "../_common/ui.js";

class VertexBuffer {
  constructor(gl, data, usage = gl.STATIC_DRAW) {
    this.gl = gl;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, usage);
  }
  bind() {
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.buffer);
  }
  destroy() {
    this.gl.deleteBuffer(this.buffer);
  }
}

class IndexBuffer {
  constructor(gl, data, usage = gl.STATIC_DRAW) {
    this.gl = gl;
    this.count = data.length;
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, usage);
  }
  bind() {
    this.gl.bindBuffer(this.gl.ELEMENT_ARRAY_BUFFER, this.buffer);
  }
  destroy() {
    this.gl.deleteBuffer(this.buffer);
  }
}

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

const panel = createPanel({ title: "02 - Buffers" });
let angle = 0.0;
panel.addSlider("angle", { min: -Math.PI, max: Math.PI, step: 0.001, value: angle }, (v) => (angle = v));

const VS = `
attribute vec2 a_pos;
attribute vec3 a_color;
uniform float u_angle;
varying vec3 v_color;
void main() {
  float c = cos(u_angle);
  float s = sin(u_angle);
  vec2 p = vec2(
    c * a_pos.x - s * a_pos.y,
    s * a_pos.x + c * a_pos.y
  );
  gl_Position = vec4(p, 0.0, 1.0);
  v_color = a_color;
}
`;

const FS = `
precision mediump float;
varying vec3 v_color;
void main() {
  gl_FragColor = vec4(v_color, 1.0);
}
`;

const program = createProgram(gl, VS, FS);
gl.useProgram(program);

const aPos = gl.getAttribLocation(program, "a_pos");
const aColor = gl.getAttribLocation(program, "a_color");
const uAngle = gl.getUniformLocation(program, "u_angle");

// 一个矩形（两个三角形），4 个顶点，交错布局：pos(2f) + color(3f)
const vertices = new Float32Array([
  -0.5, -0.5, 1, 0, 0, // 0
  0.5, -0.5, 0, 1, 0, // 1
  0.5, 0.5, 0, 0, 1, // 2
  -0.5, 0.5, 1, 1, 0, // 3
]);

const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

const vbo = new VertexBuffer(gl, vertices);
const ibo = new IndexBuffer(gl, indices);

vbo.bind();
ibo.bind();

const stride = 5 * 4; // 每顶点 5 个 float
const posOffset = 0;
const colorOffset = 2 * 4;

console.log("[02] stride(bytes) =", stride, "posOffset =", posOffset, "colorOffset =", colorOffset);

gl.enableVertexAttribArray(aPos);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, posOffset);

gl.enableVertexAttribArray(aColor);
gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, colorOffset);

function frame() {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  gl.useProgram(program);
  gl.uniform1f(uAngle, angle);

  gl.drawElements(gl.TRIANGLES, ibo.count, gl.UNSIGNED_SHORT, 0);

  requestAnimationFrame(frame);
}

frame();


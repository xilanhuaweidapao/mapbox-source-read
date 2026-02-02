import { createBuffer, createProgram, getLocations, mustGetContext, resizeCanvasToDisplaySize } from "../_common/gl.js";

const canvas = document.getElementById("c");
const gl = mustGetContext(canvas, { antialias: true, alpha: true });

console.log("WebGL VERSION:", gl.getParameter(gl.VERSION));
console.log("GLSL VERSION:", gl.getParameter(gl.SHADING_LANGUAGE_VERSION));
console.log("RENDERER:", gl.getParameter(gl.RENDERER));

// 1) 写两个最小 shader：顶点 shader 负责输出 gl_Position，片元 shader 输出颜色
const VS = `
attribute vec2 a_pos;
attribute vec3 a_color;
varying vec3 v_color;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
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
const loc = getLocations(gl, program, { attribs: ["a_pos", "a_color"] });

// 2) 顶点数据：3 个顶点，每个顶点 = vec2(pos) + vec3(color)，采用 interleaved（交错）布局
//
// [x, y, r, g, b, x, y, r, g, b, ...]
const vertexData = new Float32Array([
  -0.6, -0.6, 1, 0, 0,
  0.6, -0.6, 0, 1, 0,
  0.0, 0.6, 0, 0, 1,
]);

const vbo = createBuffer(gl, gl.ARRAY_BUFFER, vertexData, gl.STATIC_DRAW);

// 3) 绑定 buffer + 描述 attribute 如何从 buffer 里“解码”
gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);

const stride = 5 * 4; // 5 floats * 4 bytes

gl.enableVertexAttribArray(loc.attribs.a_pos);
gl.vertexAttribPointer(loc.attribs.a_pos, 2, gl.FLOAT, false, stride, 0);

gl.enableVertexAttribArray(loc.attribs.a_color);
gl.vertexAttribPointer(loc.attribs.a_color, 3, gl.FLOAT, false, stride, 2 * 4);

function frame() {
  if (resizeCanvasToDisplaySize(canvas)) {
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  gl.clearColor(0.05, 0.07, 0.12, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // 4) 画！最小闭环：drawArrays(TRIANGLES, firstVertex, vertexCount)
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  requestAnimationFrame(frame);
}

frame();


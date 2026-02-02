export function createShader(gl, type, source) {
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

export function createProgram(gl, vertexSource, fragmentSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
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

export function getLocations(gl, program, { attribs = [], uniforms = [] } = {}) {
  const a = {};
  for (const name of attribs) a[name] = gl.getAttribLocation(program, name);

  const u = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(program, name);

  return { attribs: a, uniforms: u };
}

export function createBuffer(gl, target, data, usage = gl.STATIC_DRAW) {
  const buffer = gl.createBuffer();
  gl.bindBuffer(target, buffer);
  gl.bufferData(target, data, usage);
  return buffer;
}

export function resizeCanvasToDisplaySize(canvas, { maxScale = 2 } = {}) {
  const dpr = Math.min(maxScale, window.devicePixelRatio || 1);
  const displayWidth = Math.floor(canvas.clientWidth * dpr);
  const displayHeight = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    return true;
  }
  return false;
}

export function mustGetContext(canvas, options = {}) {
  const gl = canvas.getContext("webgl", options);
  if (!gl) throw new Error("WebGL not supported (canvas.getContext('webgl') returned null)");
  return gl;
}


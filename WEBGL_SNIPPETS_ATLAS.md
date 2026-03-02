# WebGL 代码片段速查手册（WEBGL_SNIPPETS_ATLAS）

> 目标：用“最小模板 + 仓库真实片段 + 文件定位 + 排障 + 回顾卡”形成可反复复习的 WebGL 手册，并能直接支撑你阅读本仓库（Mapbox GL JS v1 风格实现）。

---

## 目录（API 分类主结构）

1. Context 与状态缓存（state machine、dirty flag、setDefault）  
2. Program 与 Shader（compile/link、attribute 绑定、uniform location）  
3. Buffer 与 VAO（VBO/IBO、vertexAttribPointer、OES_vertex_array_object）  
4. Uniform 绑定层（typed uniform wrapper、矩阵/颜色更新策略）  
5. Texture 与采样（pixelStore、premultiply、mipmap、NPOT、atlas）  
6. Framebuffer 与离屏渲染（FBO、attachment、offscreen pass）  
7. 深度/模板/混合/剔除（Depth/Stencil/Blend/Cull 组合策略）  
8. Draw Call 模板（program.draw、segments、drawElements）  
9. 图层级 Recipes（全 draw_* 覆盖）  
10. 数据到 GPU 链路（StructArray、ProgramConfiguration、Bucket、Tile.upload）  
11. Worker 与 transferable 链路（worker parse/build -> main thread deserialize/upload）  
12. learning 示例映射（00-11 对主仓库）  
13. 常见问题速查（按症状反查）  
14. 回顾卡片总表（每日/每周复习）  
15. 附录 A：仓库调用链索引（Map -> Painter -> draw_* -> program -> shaders -> data/source）  
16. 附录 B：术语与文件导航速查  

---

## 1. Context 与状态缓存（state machine、dirty flag、setDefault）

### 本章目标
理解“WebGL 是状态机”在仓库中的工程化落地：如何用 `Context` + `Value` 封装避免重复状态切换、减少 driver 调用、稳定多 pass 渲染。

### 最小模板（可记忆）
```js
// 1) 统一入口管理状态，而不是到处直接 gl.xxx
class StateCache {
  constructor(gl) {
    this.gl = gl;
    this.currentProgram = null;
    this.currentBlend = null;
  }
  useProgram(p) {
    if (this.currentProgram !== p) {
      this.gl.useProgram(p);
      this.currentProgram = p;
    }
  }
  setBlend(enabled) {
    if (this.currentBlend !== enabled) {
      enabled ? this.gl.enable(this.gl.BLEND) : this.gl.disable(this.gl.BLEND);
      this.currentBlend = enabled;
    }
  }
}
```

### 仓库片段（节选）
```js
// gl/context.js
this.clearColor = new ClearColor(this);
this.depthTest = new DepthTest(this);
this.blend = new Blend(this);
this.program = new Program(this);

// gl/value.js
set(v) {
  if (v === this.current && !this.dirty) return;
  this.gl.useProgram(v);
  this.current = v;
  this.dirty = false;
}
```

### 源码定位（文件路径）
- `gl/context.js`
- `gl/value.js`
- `render/painter.js`

### 常见坑与排查
1. 自定义图层污染状态：渲染后未恢复导致后续图层错乱。  
排查：看 `Painter#setCustomLayerDefaults()` 与 `context.setDirty()` 是否被正确调用。
2. 以为“每帧全量 set 状态”无害：实际会产生大量重复 GL 调用。  
排查：在 `value.js` 的 `set` 里打点，观察重复次数。
3. VAO 绑定状态泄漏：创建/更新 index buffer 时意外修改当前 VAO。  
排查：看 `context.unbindVAO()` 是否在关键路径被调用。

### 回顾卡片（3-5）
- Q: 为什么 `Value#set` 要先比较 `current`？  
  A: 避免重复 GL 调用，降低 CPU/driver 开销。
- Q: `setDirty()` 的作用是什么？  
  A: 强制下次 `set` 重新下发状态，常用于外部状态可能被污染后。
- Q: `setDefault()` 什么时候有价值？  
  A: 渲染收尾和 custom layer 前后，恢复“可预测状态基线”。

---

## 2. Program 与 Shader（compile/link、attribute 绑定、uniform location）

### 本章目标
掌握 program 创建全过程，以及仓库如何把 shader 源、attribute 索引、uniform 位置和动态配置（defines/pragma）串起来。

### 最小模板（可记忆）
```js
function createProgram(gl, vsSource, fsSource, attribNames = []) {
  const vs = gl.createShader(gl.VERTEX_SHADER);
  gl.shaderSource(vs, vsSource);
  gl.compileShader(vs);
  if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(vs));

  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  gl.shaderSource(fs, fsSource);
  gl.compileShader(fs);
  if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(fs));

  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  attribNames.forEach((name, i) => gl.bindAttribLocation(p, i, name));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}
```

### 仓库片段（节选）
```js
// render/program.js
const defines = configuration ? configuration.defines() : [];
const fragmentSource = defines.concat(prelude.fragmentSource, source.fragmentSource).join('\n');
const vertexSource = defines.concat(prelude.vertexSource, source.vertexSource).join('\n');

for (let i = 0; i < this.numAttributes; i++) {
  gl.bindAttribLocation(this.program, i, allAttrInfo[i]);
  this.attributes[allAttrInfo[i]] = i;
}

gl.linkProgram(this.program);
```

```glsl
// shaders/README.md 对应 pragma 语义
#pragma mapbox: define highp vec4 color
#pragma mapbox: initialize highp vec4 color
```

### 源码定位（文件路径）
- `render/program.js`
- `shaders/shaders.js`
- `shaders/README.md`
- `render/program/program_uniforms.js`

### 常见坑与排查
1. attribute location 不稳定：不手动绑定时，不同平台顺序可能不同。  
排查：确保 `bindAttribLocation` 使用固定顺序。
2. shader 编译报错但日志不直观：宏展开后行号变化。  
排查：输出最终拼接后的 `vertexSource`/`fragmentSource`。
3. uniform location 为 `null`：被编译器优化掉了。  
排查：确认 shader 中确实使用该 uniform。

### 回顾卡片（3-5）
- Q: 为什么 program 构造要接 `ProgramConfiguration`？  
  A: 因为数据驱动属性会改变 shader 宏/attribute/uniform 组合。
- Q: `prelude` 有什么作用？  
  A: 全局插入通用 GLSL 辅助函数与常量。
- Q: pragma 本质做了什么？  
  A: 在 uniform/attribute 两种绑定策略间自动展开桥接代码。

---

## 3. Buffer 与 VAO（VBO/IBO、vertexAttribPointer、OES_vertex_array_object）

### 本章目标
搞清顶点/索引缓冲、属性指针、VAO 缓存三者协作关系，并理解仓库为何在动态更新路径频繁处理 VAO 绑定。

### 最小模板（可记忆）
```js
// interleaved: [x,y,r,g,b]
const stride = 5 * 4;
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, stride, 0);
gl.vertexAttribPointer(aColor, 3, gl.FLOAT, false, stride, 2 * 4);

gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
```

### 仓库片段（节选）
```js
// gl/vertex_buffer.js
gl.bufferData(gl.ARRAY_BUFFER, array.arrayBuffer, this.dynamicDraw ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
gl.vertexAttribPointer(attribIndex, member.components, gl[AttributeType[member.type]], false, this.itemSize, member.offset + (this.itemSize * (vertexOffset || 0)));
```

```js
// render/vertex_array_object.js
if (!context.extVertexArrayObject || isFreshBindRequired) {
  this.freshBind(...);
} else {
  context.bindVertexArrayOES.set(this.vao);
}
```

### 源码定位（文件路径）
- `gl/vertex_buffer.js`
- `gl/index_buffer.js`
- `render/vertex_array_object.js`
- `data/segment.js`

### 常见坑与排查
1. stride/offset 以“字节”为单位，不是 float 个数。  
2. `ELEMENT_ARRAY_BUFFER` 绑定属于 VAO 状态，在错误 VAO 下更新会污染缓存。  
3. `UNSIGNED_SHORT` 索引上限导致单段顶点数受限。  
排查：看 `SegmentVector.MAX_VERTEX_ARRAY_LENGTH = 65535`。

### 回顾卡片（3-5）
- Q: 为什么 `IndexBuffer#updateData` 先 `unbindVAO()`？  
  A: 防止把 EBO 更新绑定到错误 VAO 上。
- Q: `segment.vertexOffset` 用在什么地方？  
  A: `vertexAttribPointer` 的 offset 偏移和 `drawElements` 的范围切片。
- Q: VAO 缓存命中依赖哪些条件？  
  A: program、layout/paint buffer、index buffer、vertexOffset、dynamic buffer 等。

---

## 4. Uniform 绑定层（typed uniform wrapper、矩阵/颜色更新策略）

### 本章目标
理解仓库为什么不直接 everywhere 调 `gl.uniform*`，而是通过 typed binding 做“值比较 + 变更下发”。

### 最小模板（可记忆）
```js
class Uniform1f {
  constructor(gl, loc) { this.gl = gl; this.loc = loc; this.current = 0; }
  set(v) {
    if (v !== this.current) {
      this.current = v;
      this.gl.uniform1f(this.loc, v);
    }
  }
}
```

### 仓库片段（节选）
```js
// render/uniform_binding.js
class UniformMatrix4f extends Uniform {
  set(v) {
    if (v[12] !== this.current[12] || v[0] !== this.current[0]) {
      this.current = v;
      this.gl.uniformMatrix4fv(this.location, false, v);
      return;
    }
    for (let i = 1; i < 16; i++) {
      if (v[i] !== this.current[i]) {
        this.current = v;
        this.gl.uniformMatrix4fv(this.location, false, v);
        break;
      }
    }
  }
}
```

### 源码定位（文件路径）
- `render/uniform_binding.js`
- `render/program/program_uniforms.js`
- `render/program/*_program.js`

### 常见坑与排查
1. 频繁 new uniform wrapper：应在 program 创建时一次性建立。  
2. 矩阵每帧不同是正常，但颜色/开关类 uniform 可被缓存。  
3. sampler uniform 忘了与 `activeTexture` 单元对应。  

### 回顾卡片（3-5）
- Q: 为什么 `UniformMatrix4f` 先比较索引 `12` 和 `0`？  
  A: 热路径优化，优先命中最常变化位置，减少遍历成本。
- Q: `programUniforms` 的角色？  
  A: 按 program id 映射到对应 uniform 构造函数集合。
- Q: uniform cache 能替代状态 cache 吗？  
  A: 不能；uniform 是 program 内部状态，和全局 GL 状态层次不同。

---

## 5. Texture 与采样（pixelStore、premultiply、mipmap、NPOT、atlas）

### 本章目标
掌握纹理上传、像素存储参数、过滤与 wrap 策略，理解 atlas 驱动下的采样与性能取舍。

### 最小模板（可记忆）
```js
gl.bindTexture(gl.TEXTURE_2D, tex);
gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
```

### 仓库片段（节选）
```js
// render/texture.js
context.pixelStoreUnpackFlipY.set(false);
context.pixelStoreUnpack.set(1);
context.pixelStoreUnpackPremultiplyAlpha.set(this.format === gl.RGBA && (!options || options.premultiply !== false));

if (this.useMipmap && this.isSizePowerOfTwo()) {
  gl.generateMipmap(gl.TEXTURE_2D);
}
```

### 源码定位（文件路径）
- `render/texture.js`
- `gl/value.js`（PixelStore*）
- `render/image_atlas.js`
- `render/glyph_atlas.js`
- `render/line_atlas.js`

### 常见坑与排查
1. premultiply 与 blend 配置不匹配，出现发黑/发白边。  
2. NPOT 纹理误用 mipmap 过滤。  
3. 更新子区域时使用 `texSubImage2D` 但对齐/格式不一致导致错位。  

### 回顾卡片（3-5）
- Q: 什么时候用 `UNPACK_PREMULTIPLY_ALPHA_WEBGL = true`？  
  A: RGBA 贴图且走预乘 alpha 管线时。
- Q: 为何 `Texture#bind` 里会降级 `LINEAR_MIPMAP_NEAREST`？  
  A: 非 POT 时 mipmap 不可用，自动回退到 `LINEAR`。
- Q: atlas 的核心价值？  
  A: 减少纹理切换，提升批处理效率。

---

## 6. Framebuffer 与离屏渲染（FBO、attachment、offscreen pass）

### 本章目标
理解离屏 pass 在仓库中的使用模式：先写纹理再回读合成（heatmap、hillshade 等）。

### 最小模板（可记忆）
```js
const fbo = gl.createFramebuffer();
gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
  throw new Error("FBO incomplete");
}
// draw offscreen...
gl.bindFramebuffer(gl.FRAMEBUFFER, null); // back to main framebuffer
```

### 仓库片段（节选）
```js
// gl/framebuffer.js
this.colorAttachment = new ColorAttachment(context, fbo);
if (hasDepth) this.depthAttachment = new DepthAttachment(context, fbo);
assert(gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE);
```

```js
// render/draw_heatmap.js
bindFramebuffer(context, painter, layer);
context.clear({color: Color.transparent});
// offscreen kernel pass...
renderTextureToMap(painter, layer);
```

### 源码定位（文件路径）
- `gl/framebuffer.js`
- `gl/value.js`（ColorAttachment / DepthAttachment）
- `render/draw_heatmap.js`
- `render/draw_hillshade.js`

### 常见坑与排查
1. viewport 未切回主屏尺寸，导致主 pass 缩放错乱。  
2. 颜色附件格式与平台扩展能力不匹配。  
3. FBO 生命周期与 tile 生命周期不同步导致泄漏。  

### 回顾卡片（3-5）
- Q: `context.createFramebuffer(width, height, hasDepth)` 做了什么？  
  A: 创建 FBO，并封装 color/depth attachment 的绑定管理。
- Q: 为什么 heatmap 分两步？  
  A: 先离屏累计密度，再主屏应用颜色坡度纹理。
- Q: hillshade prepare pass 输出什么？  
  A: 将坡度信息编码进纹理通道供后续着色。

---

## 7. 深度/模板/混合/剔除（Depth/Stencil/Blend/Cull 组合策略）

### 本章目标
掌握四大状态块如何按图层和 pass 组合，理解 tile clipping、3D extrusion、透明层叠的关键状态策略。

### 最小模板（可记忆）
```js
// Depth
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);
gl.depthMask(true);

// Stencil clip example
gl.enable(gl.STENCIL_TEST);
gl.stencilFunc(gl.EQUAL, ref, 0xFF);
gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);

// Blend
gl.enable(gl.BLEND);
gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alpha

// Cull
gl.enable(gl.CULL_FACE);
gl.cullFace(gl.BACK);
gl.frontFace(gl.CCW);
```

### 仓库片段（节选）
```js
// gl/context.js
setDepthMode(depthMode) { ... }
setStencilMode(stencilMode) { ... }
setColorMode(colorMode) { ... }
setCullFace(cullFaceMode) { ... }
```

```js
// render/painter.js
this.renderPass = 'opaque';
// ...
this.renderPass = 'translucent';
```

### 源码定位（文件路径）
- `gl/depth_mode.js`
- `gl/stencil_mode.js`
- `gl/color_mode.js`
- `gl/cull_face_mode.js`
- `render/painter.js`
- `render/draw_fill_extrusion.js`
- `render/draw_raster.js`

### 常见坑与排查
1. 透明物体错误使用 opaque pass 导致混合异常。  
2. stencil ref 溢出（>255）时未清空模板缓冲。  
3. extrusion 双 pass 时 depth/stencil 组合错误导致闪烁或穿插。  

### 回顾卡片（3-5）
- Q: `ColorMode.unblended` 与 `ColorMode.alphaBlended` 何时切换？  
  A: 通常 opaque pass 用前者，translucent pass 用后者。
- Q: 为什么 raster 会用 `stencilConfigForOverlap`？  
  A: 处理父子瓦片重叠区域，避免重复绘制。
- Q: fill-extrusion 透明时为何两次 draw？  
  A: 先写最近深度，再按深度/模板限制着色，避免透明面错误叠加。

---

## 8. Draw Call 模板（program.draw、segments、drawElements）

### 本章目标
建立统一心智模型：一次 draw 的必要输入是什么，`Program.draw` 如何迭代 segments 触发 `gl.drawElements`。

### 最小模板（可记忆）
```js
function drawBatch({
  context, program, depthMode, stencilMode, colorMode, cullFaceMode,
  uniformValues, layerID, layoutVertexBuffer, indexBuffer, segments
}) {
  context.program.set(program);
  context.setDepthMode(depthMode);
  context.setStencilMode(stencilMode);
  context.setColorMode(colorMode);
  context.setCullFace(cullFaceMode);

  for (const seg of segments) {
    // bind vao/vbo/ibo...
    gl.drawElements(gl.TRIANGLES, seg.count, gl.UNSIGNED_SHORT, seg.offsetBytes);
  }
}
```

### 仓库片段（节选）
```js
// render/program.js
for (const segment of segments.get()) {
  vao.bind(context, this, layoutVertexBuffer, ..., indexBuffer, segment.vertexOffset, ...);
  gl.drawElements(drawMode, segment.primitiveLength * primitiveSize, gl.UNSIGNED_SHORT, segment.primitiveOffset * primitiveSize * 2);
}
```

### 源码定位（文件路径）
- `render/program.js`
- `render/vertex_array_object.js`
- `data/segment.js`

### 常见坑与排查
1. primitive 长度和 drawMode 不匹配（LINES=2, TRIANGLES=3）。  
2. offset 计算漏乘 `2`（`UNSIGNED_SHORT` 字节宽度）。  
3. segment 切分不合理导致 draw call 过多。  

### 回顾卡片（3-5）
- Q: `Program.draw` 为什么接 `layerID`？  
  A: segment 内维护 `vaos[layerID]`，按图层缓存 VAO。
- Q: `primitiveSize` 用于什么？  
  A: 将 segment 的 primitiveLength/offset 映射到索引数量与字节偏移。
- Q: 何时会 forced fresh VAO bind？  
  A: program/buffer/index/offset/dynamic buffer 任一变化时。

---

## 9. 图层级 Recipes（全 draw_* 覆盖）

### 本章目标
按 layer type 快速定位 draw 入口、program 选择、主要状态策略和 shader 落点，实现“改某图层 2 分钟定位”。

### 最小模板（可记忆）
```js
// 图层绘制通用 recipe
if (painter.renderPass !== expectedPass) return;
const program = painter.useProgram(programId, programConfiguration);
const depthMode = painter.depthModeForSublayer(...);
const stencilMode = needsClip ? painter.stencilModeForClipping(coord) : StencilMode.disabled;
const colorMode = painter.colorModeForRenderPass();
program.draw(context, drawMode, depthMode, stencilMode, colorMode, CullFaceMode.disabled,
  uniformValues, layer.id, layoutVB, indexBuffer, segments, layer.paint, painter.transform.zoom, programConfiguration);
```

### 仓库片段（节选）
```js
// render/draw_fill.js
const program = painter.useProgram(programName, programConfiguration);
program.draw(painter.context, drawMode, depthMode,
  painter.stencilModeForClipping(coord), colorMode, CullFaceMode.disabled, uniformValues,
  layer.id, bucket.layoutVertexBuffer, indexBuffer, segments, layer.paint, painter.transform.zoom, programConfiguration);
```

### 源码定位（文件路径）
- draw 入口（全覆盖）
  - `render/draw_background.js`
  - `render/draw_circle.js`
  - `render/draw_collision_debug.js`
  - `render/draw_custom.js`
  - `render/draw_debug.js`
  - `render/draw_fill.js`
  - `render/draw_fill_extrusion.js`
  - `render/draw_heatmap.js`
  - `render/draw_hillshade.js`
  - `render/draw_line.js`
  - `render/draw_raster.js`
  - `render/draw_symbol.js`
- program 入口（全覆盖）
  - `render/program/background_program.js`
  - `render/program/circle_program.js`
  - `render/program/clipping_mask_program.js`
  - `render/program/collision_program.js`
  - `render/program/debug_program.js`
  - `render/program/fill_program.js`
  - `render/program/fill_extrusion_program.js`
  - `render/program/heatmap_program.js`
  - `render/program/hillshade_program.js`
  - `render/program/line_program.js`
  - `render/program/raster_program.js`
  - `render/program/symbol_program.js`

### 常见坑与排查
1. 背景/填充层 pass 判断错误，导致 layer “看似不渲染”。  
2. symbol 关闭 stencil 是故意设计（允许跨 tile），不要误改成 clipping。  
3. heatmap/hillshade 的 offscreen 与 translucent 混淆会导致空白。

### 回顾卡片（3-5）
- Q: `line` 默认在哪个 pass？  
  A: `translucent`。
- Q: `heatmap` 的两个 program 是什么？  
  A: `heatmap`（离屏核累积）+ `heatmapTexture`（回贴主屏）。
- Q: `raster` 为什么要找 parent tile？  
  A: 用于 fade/crossfade，减轻瓦片切换闪烁。

#### 图层到程序与 shader 快速映射表

| Layer/Draw | Program ID | Program 文件 | Shader 文件（主） |
|---|---|---|---|
| background | background / backgroundPattern | `render/program/background_program.js` | `shaders/background.*`, `shaders/background_pattern.*` |
| circle | circle | `render/program/circle_program.js` | `shaders/circle.*` |
| fill | fill / fillPattern / fillOutline / fillOutlinePattern | `render/program/fill_program.js` | `shaders/fill*` |
| line | line / linePattern / lineSDF / lineGradient | `render/program/line_program.js` | `shaders/line*` |
| symbol | symbolIcon / symbolSDF / symbolTextAndIcon | `render/program/symbol_program.js` | `shaders/symbol_*` |
| raster | raster | `render/program/raster_program.js` | `shaders/raster.*` |
| heatmap | heatmap / heatmapTexture | `render/program/heatmap_program.js` | `shaders/heatmap*` |
| hillshade | hillshade / hillshadePrepare | `render/program/hillshade_program.js` | `shaders/hillshade*` |
| fill-extrusion | fillExtrusion / fillExtrusionPattern | `render/program/fill_extrusion_program.js` | `shaders/fill_extrusion*` |
| collision debug | collisionBox / collisionCircle | `render/program/collision_program.js` | `shaders/collision_*` |
| debug | debug / clippingMask | `render/program/debug_program.js`, `render/program/clipping_mask_program.js` | `shaders/debug.*`, `shaders/clipping_mask.*` |
| custom | 由实现方控制 | N/A | N/A |

---

## 10. 数据到 GPU 链路（StructArray、ProgramConfiguration、Bucket、Tile.upload）

### 本章目标
理解从 feature 到 GPU 缓冲的完整变换：`StructArray` 布局 -> `Bucket` 填充 -> 主线程反序列化 -> `upload`。

### 最小模板（可记忆）
```js
// worker side
const layout = new MyStructArray();
layout.emplaceBack(...featureEncodedValues);
postMessage({arrayBuffer: layout.arrayBuffer}, [layout.arrayBuffer]);

// main thread
const vbo = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
gl.bufferData(gl.ARRAY_BUFFER, arrayBuffer, gl.STATIC_DRAW);
```

### 仓库片段（节选）
```js
// data/bucket.js
// worker build -> serialize -> main thread deserialize
this.buckets = deserializeBucket(data.buckets, painter.style);
```

```js
// source/tile.js
for (const id in this.buckets) {
  const bucket = this.buckets[id];
  if (bucket.uploadPending()) {
    bucket.upload(context);
  }
}
```

```js
// data/program_configuration.js
// property expression 决定 uniform / attribute binder
```

### 源码定位（文件路径）
- `util/struct_array.js`
- `data/array_types.js`
- `data/program_configuration.js`
- `data/bucket.js`
- `source/tile.js`

### 常见坑与排查
1. 动态属性更新后未 `updateData`，画面不变。  
2. `arrayBuffer` 被转移后继续访问导致异常。  
3. `ProgramConfiguration` 与 shader pragma 定义不一致导致 attribute 缺失。

### 回顾卡片（3-5）
- Q: `StructArray` 的核心价值？  
  A: 用结构化 typed memory 表达顶点布局，便于 worker transfer 和 GPU 上传。
- Q: `ProgramConfiguration` 解决什么问题？  
  A: 将样式表达式绑定到 uniform/attribute 的具体实现。
- Q: `Tile.upload` 何时触发？  
  A: 进入可渲染流程前由 source cache/painter 准备阶段触发。

---

## 11. Worker 与 transferable 链路（worker parse/build -> main thread deserialize/upload）

### 本章目标
读懂 worker 分工：主线程调度、worker 构建 bucket、transferable 回传、主线程反序列化上传。

### 最小模板（可记忆）
```js
// main thread
worker.postMessage({type: "loadTile", tileID});

// worker
self.onmessage = (e) => {
  if (e.data.type === "loadTile") {
    const built = buildBucket(e.data.tileID);
    self.postMessage({buckets: built, transfer: built.buffers}, built.transferables);
  }
};
```

### 仓库片段（节选）
```js
// source/worker.js
loadTile(mapId, params, callback) {
  this.getWorkerSource(mapId, params.type, params.source).loadTile(params, callback);
}
```

```js
// data/bucket.js 注释：bucket 设计为 worker 构建 + 主线程反序列化消费
```

### 源码定位（文件路径）
- `source/worker.js`
- `source/*_worker_source.js`
- `util/web_worker_transfer.js`
- `data/bucket.js`
- `source/tile.js`

### 常见坑与排查
1. 过度复制 ArrayBuffer，未使用 transferables，导致卡顿。  
2. 回传数据结构与主线程反序列化协议不一致。  
3. worker 缓存状态未清理，导致 reload/remove 后内存泄漏。  

### 回顾卡片（3-5）
- Q: worker 的核心收益是什么？  
  A: 将几何解析和布局计算从主线程移出，降低交互卡顿。
- Q: 为什么 bucket 适合 worker 构建？  
  A: 它本质是 CPU 编码任务，结果可直接转为 typed buffer。
- Q: 主线程拿到 buckets 后第一件事是什么？  
  A: 按 style layer 映射反序列化，再在 `upload` 阶段创建 GPU 资源。

---

## 12. learning 示例映射（00-11 对主仓库）

### 本章目标
把学习目录每个 demo 对应到主仓库同类模块，形成“先 demo 再读生产代码”的稳定路径。

### 最小模板（可记忆）
```js
// 学习套路
// 1) 先跑 learning demo，观察现象
// 2) 对照主仓库同职责文件
// 3) 从 draw_* 追到 program/shader/data
```

### 仓库片段（节选）
```txt
learning/00-11 分别覆盖：
program、buffers、texture、transform、tiles、style、bucket、worker、stencil、symbol、综合功能
```

### 源码定位（文件路径）
- `learning/README.md`
- `learning/00-hello-webgl/`
- `learning/01-program/`
- `learning/02-buffers/`
- `learning/03-texture/`
- `learning/04-transform/`
- `learning/05-tiles-raster/`
- `learning/06-style-min/`
- `learning/07-vector-bucket/`
- `learning/08-worker-transfer/`
- `learning/09-stencil-clip/`
- `learning/10-symbol-collision/`
- `learning/11-new-features/`

### 常见坑与排查
1. 把 learning 写法当成生产写法直接搬运（忽略状态缓存/分段/多 pass）。  
2. demo 能跑但未追到主仓库对应层，知识断层。  
3. 只看 README 不看 main.js，丢失关键参数细节。

### 回顾卡片（3-5）
- Q: `02-buffers` 对主仓库哪块最直接？  
  A: `gl/vertex_buffer.js`、`gl/index_buffer.js`、`render/vertex_array_object.js`。
- Q: `09-stencil-clip` 对应主仓库哪块？  
  A: `render/painter.js` 中 clipping mask + stencil mode 逻辑。
- Q: `10-symbol-collision` 对应主仓库哪块？  
  A: `render/draw_symbol.js` + `symbol/*`。

#### learning -> 主仓库映射表

| learning | 核心概念 | 主仓库首读文件 |
|---|---|---|
| 00-hello-webgl | 最小渲染闭环 | `render/program.js`, `render/painter.js` |
| 01-program | program 封装 | `render/program.js`, `render/program/*_program.js` |
| 02-buffers | VBO/IBO/stride/offset | `gl/vertex_buffer.js`, `gl/index_buffer.js` |
| 03-texture | 上传/过滤/premultiply | `render/texture.js`, `gl/value.js` |
| 04-transform | 坐标与矩阵 | `geo/transform.js`, `render/painter.js` |
| 05-tiles-raster | 瓦片绘制与缓存 | `render/draw_raster.js`, `source/source_cache.js` |
| 06-style-min | style 驱动 draw | `style/style.js`, `render/draw_*` |
| 07-vector-bucket | 几何编码到 bucket | `data/bucket/*`, `data/array_types.js` |
| 08-worker-transfer | worker + transferable | `source/worker.js`, `util/web_worker_transfer.js` |
| 09-stencil-clip | tile clipping | `render/painter.js`, `gl/stencil_mode.js` |
| 10-symbol-collision | 文本/图标碰撞 | `render/draw_symbol.js`, `symbol/*` |
| 11-new-features | 组合能力 | `render/*`, `source/*`, `style/*` |

---

## 13. 常见问题速查（按症状反查）

### 本章目标
按“症状 -> 排查路径 -> 高概率原因 -> 修复方向”快速定位渲染问题。

### 最小模板（可记忆）
```txt
症状出现 ->
1) 看 renderPass 和状态（depth/stencil/blend）
2) 看 program/uniform 是否正确
3) 看 buffer/attribute 指针是否匹配
4) 看 texture/pixelStore/采样参数
5) 看 tile/bucket/worker 数据是否完整
```

### 仓库片段（节选）
```js
// render/painter.js
this.renderPass = 'offscreen' -> 'opaque' -> 'translucent';
this.context.clear(...); this.clearStencil();
```

```js
// gl/context.js
setDepthMode(...); setStencilMode(...); setColorMode(...); setCullFace(...);
```

### 源码定位（文件路径）
- `render/painter.js`
- `gl/context.js`
- `render/program.js`
- `render/texture.js`
- `source/tile.js`
- `data/bucket.js`

### 常见坑与排查
1. 黑屏：program link/compile 失败或 attribute 指针错位。  
2. 错色：premultiply + blend 不匹配；uniform 颜色未更新。  
3. 锯齿/边缘脏：outline pass 与 stencil/depth 配置不当。  
4. 闪烁：tile fade、parent/child overlap、depth range 冲突。  
5. 错位：矩阵或 translate anchor 使用错误。  
6. 性能抖动：重复状态切换、过多 draw calls、纹理频繁重建。

### 回顾卡片（3-5）
- Q: 黑屏优先看哪 3 个点？  
  A: shader 编译日志、attribute pointer、drawElements 参数。
- Q: 透明发灰第一反应检查什么？  
  A: premultiply alpha 与 blendFunc 配置。
- Q: 某 layer 不渲染但无报错先看什么？  
  A: `renderPass` 条件和 `opacity` / `isHidden` 判定。

---

## 14. 回顾卡片总表（每日/每周复习）

### 本章目标
把全手册知识压缩为可重复刷的记忆卡，形成稳定复习节奏。

### 最小模板（可记忆）
```txt
每日 15 分钟：
  - API 卡片 10 张（随机）
  - 图层卡片 5 张（定向）

每周 45 分钟：
  - 调用链复盘 1 次
  - 排障演练 2 题
```

### 仓库片段（节选）
```txt
卡片建议围绕：
Context / Program / VAO / Texture / FBO / Pass / draw_* / bucket / worker
```

### 源码定位（文件路径）
- `gl/context.js`
- `render/program.js`
- `render/vertex_array_object.js`
- `render/painter.js`
- `render/draw_*.js`
- `data/bucket.js`
- `source/worker.js`

### 常见坑与排查
1. 只背 API 不背仓库路径，实战定位慢。  
2. 只背“定义”不做“反查题”，排障能力上不来。  
3. 一次复习太长导致中断，建议切短周期。

### 回顾卡片（3-5）
- Q: 一次 draw 最小闭环 5 要素？  
  A: Program、Buffers、Attrib pointers、Uniforms/Textures、Draw call。
- Q: 为什么需要 `SegmentVector`？  
  A: 受 16-bit 索引限制，需分段并管理 VAO/draw 范围。
- Q: 瓦片裁剪靠什么完成？  
  A: clipping mask + stencil test。
- Q: heatmap 颜色从哪里来？  
  A: 离屏密度纹理 + color ramp 纹理合成。

---

## 15. 附录 A：仓库调用链索引（Map -> Painter -> draw_* -> program -> shaders -> data/source）

### 本章目标
给你一条固定下钻路线，确保阅读时不在模块边界迷路。

### 最小模板（可记忆）
```txt
入口 API
  -> Map / Style / SourceCache
  -> Painter.render()
  -> draw_<layer>.js
  -> painter.useProgram() + Program.draw()
  -> shaders/* + uniforms
  -> bucket/segment/struct_array
  -> worker/source/tile 上传与复用
```

### 仓库片段（节选）
```js
// render/painter.js
this.renderPass = 'offscreen';
... renderLayer(...)
this.renderPass = 'opaque';
... renderLayer(...)
this.renderPass = 'translucent';
... renderLayer(...)
```

```js
// render/painter.js
useProgram(name, programConfiguration) {
  const key = `${name}${...}`;
  if (!this.cache[key]) this.cache[key] = new Program(...);
  return this.cache[key];
}
```

### 源码定位（文件路径）
- 入口与调度
  - `index.js`
  - `ui/map.js`
  - `style/style.js`
  - `source/source_cache.js`
  - `render/painter.js`
- 绘制与 program
  - `render/draw_*.js`
  - `render/program.js`
  - `render/program/*_program.js`
- shader
  - `shaders/shaders.js`
  - `shaders/*.glsl`
- 数据
  - `data/bucket/*`
  - `data/program_configuration.js`
  - `data/segment.js`
  - `util/struct_array.js`
- worker
  - `source/worker.js`
  - `source/*_worker_source.js`
  - `source/tile.js`

### 常见坑与排查
1. 跳过 `Painter` 直接看 `draw_*`，容易丢失 pass/状态上下文。  
2. 只看 JS 不看 GLSL，uniform/attribute 语义理解不完整。  
3. 看 draw 不看 data，容易不知道顶点数据从哪来。

### 回顾卡片（3-5）
- Q: 主渲染顺序为什么是 offscreen -> opaque -> translucent？  
  A: 先准备离屏中间结果，再处理不透明深度，再处理透明混合。
- Q: 程序复用键 `key` 由哪些部分组成？  
  A: program 名称 + programConfiguration.cacheKey + overdraw 标记。
- Q: 从一个图层问题回溯数据源最短路径？  
  A: `draw_*` -> `bucket` -> `source/tile` -> `worker_source`。

---

## 16. 附录 B：术语与文件导航速查

### 本章目标
快速统一术语，减少“概念懂但找不到文件”的切换成本。

### 最小模板（可记忆）
```txt
术语 -> 代码对象 -> 首读文件
VBO -> VertexBuffer -> gl/vertex_buffer.js
IBO -> IndexBuffer -> gl/index_buffer.js
VAO -> VertexArrayObject -> render/vertex_array_object.js
FBO -> Framebuffer -> gl/framebuffer.js
```

### 仓库片段（节选）
```txt
Program.draw(...) -> segment 循环 -> gl.drawElements(...)
```

### 源码定位（文件路径）
- WebGL 状态层：`gl/*`
- 渲染执行层：`render/*`
- Shader 层：`shaders/*`
- 数据编码层：`data/*`
- 数据源与 worker：`source/*`
- 样式层：`style/*`
- 教学样例：`learning/*`

### 常见坑与排查
1. 混淆“状态对象”（DepthMode）和“状态缓存执行器”（Value/Context）。  
2. 混淆“program 描述文件”（`render/program/*_program.js`）与“shader 源文件”（`shaders/*.glsl`）。  
3. 混淆“worker 产物 bucket”与“主线程 GPU buffer”。

### 回顾卡片（3-5）
- Q: `Bucket` 和 `Buffer` 有什么差别？  
  A: Bucket 是渲染数据组织单元；Buffer 是 GPU 资源对象。
- Q: `ProgramConfiguration` 位于哪层？  
  A: data/render 的桥接层，决定属性绑定策略。
- Q: 读 symbol 系统最少要看哪三处？  
  A: `render/draw_symbol.js`、`symbol/placement.js`、`shaders/symbol_*.glsl`。

---

## 最终验收清单（执行版）

- [x] 新文件创建于仓库根目录：`WEBGL_SNIPPETS_ATLAS.md`
- [x] 16 个章节均存在
- [x] 每章包含固定 6 小节：本章目标、最小模板、仓库片段、源码定位、常见坑与排查、回顾卡片
- [x] `render/draw_*.js` 全覆盖
- [x] `render/program/*_program.js` 全覆盖
- [x] 覆盖 `gl/context.js`、`gl/value.js`、`gl/vertex_buffer.js`、`gl/index_buffer.js`、`gl/framebuffer.js`
- [x] 覆盖 `render/painter.js`、`render/program.js`、`render/vertex_array_object.js`、`render/uniform_binding.js`、`render/texture.js`
- [x] 覆盖 `shaders/README.md`、`shaders/shaders.js`
- [x] 覆盖 `data/program_configuration.js`、`data/bucket.js`、`data/segment.js`、`util/struct_array.js`
- [x] 覆盖 `source/tile.js`、`source/worker.js`
- [x] 覆盖 `learning/README.md` 与 00-11 映射

---

## 建议使用方式

1. 每次只选一个 API 章 + 一个图层 recipe 章复习。  
2. 遇到线上问题先看第 13 章症状反查，再回到对应 API 章。  
3. 每周沿第 15 章调用链完整走读一次，避免“只会局部修补”。  


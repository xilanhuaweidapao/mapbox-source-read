# 为完全理解本仓库需要的 WebGL 知识清单

本仓库的渲染链路主要集中在 `gl/`、`render/`、`shaders/`、`data/` 四个模块：  
`data/` 负责把矢量瓦片/要素“编码”为 GPU 友好的顶点与属性数组；`gl/` 封装 WebGL 状态与资源对象；`render/` 负责绘制调度与 program/texture/atlas 管理；`shaders/` 提供 GLSL 实现与 pragma 预处理机制。

为了“完全理解”这套体系，你需要的不仅是 WebGL API 用法，还包括 GPU 管线、渲染状态、纹理/缓冲布局、以及与地图渲染强相关的图形学数学（矩阵、投影、深度/裁剪等）。下面按“你在代码里会遇到的主题”列出学习清单，并附上仓库定位点。

---

## 1) WebGL 运行模型：状态机 + GPU 管线（必会）

你需要理解 WebGL 的核心事实：**WebGL 是一套状态机 API**，一次 draw call 依赖当下绑定的 program、buffer、texture、framebuffer、以及各类状态（depth/stencil/blend/cull/viewport…）。

学习要点：

- WebGL1 的基本对象与生命周期：`WebGLRenderingContext`、Program、Shader、Buffer、Texture、Framebuffer、Renderbuffer。
- GPU 渲染管线：
  - 顶点阶段：attribute → 顶点着色器 → clip space（齐次坐标）。
  - 裁剪与透视除法：clip space → NDC（[-1,1]）→ viewport 映射到屏幕。
  - 片元阶段：插值 varying → fragment shader → 写入颜色/深度（受测试与混合影响）。
- “一次 draw 的最小集合”：`useProgram` + 绑定 VBO/IBO + 设置 attribute 指针 + 绑定纹理/设置 uniform + `drawElements/drawArrays`。

仓库定位：

- `gl/context.js`：集中初始化与缓存 WebGL 状态/扩展。
- `gl/value.js`：把 WebGL 状态封装成可缓存的 Value（避免重复 set）。
- `render/painter.js`：渲染调度中心（组织 render passes、设置状态、触发 draw_*）。

---

## 2) GLSL ES 1.00：着色器编程（必会）

Mapbox GL JS v1 以 WebGL1 为主，使用 **GLSL ES 1.00**（`attribute/uniform/varying` 体系）。

学习要点：

- shader 的编译与链接：`compileShader` / `linkProgram` / `getShaderInfoLog` / `getProgramInfoLog`。
- `attribute` / `uniform` / `varying` 的角色：
  - attribute：每个顶点不同的数据（位置、法线、UV、颜色或“打包属性”）。
  - uniform：一次 draw call 不变的数据（矩阵、纹理单元、时间、缩放参数等）。
  - varying：从顶点到片元的插值数据。
- 纹理采样：`sampler2D`、`texture2D`、多纹理单元、纹理坐标与 mipmap/过滤。
- 精度限定：`lowp/mediump/highp`；移动端精度差异带来的伪影/溢出问题。
- 分支/循环成本，避免在片元 shader 中做过重计算。

仓库定位：

- `shaders/`：所有 shader 源码。
- `shaders/README.md`：本仓库的 `#pragma mapbox:` 机制（非常关键）。
- `render/program/*`：不同图层对应的 program 与 uniform 约定。

---

## 3) 顶点数据组织：VBO/IBO、布局、打包与反序列化（必会）

地图渲染的关键在于：**如何高效地把海量几何/属性编码成 GPU 可读取的顶点格式**。

学习要点：

- `ARRAY_BUFFER` 与 `ELEMENT_ARRAY_BUFFER`：
  - 顶点缓冲（VBO）、索引缓冲（IBO/EBO）。
  - `drawElements` 的索引三角形/线段组织方式。
- 顶点布局（Vertex Layout）：
  - interleaved（交错） vs deinterleaved（分离）；
  - `vertexAttribPointer` 的 `size/type/normalized/stride/offset`；
  - 用整型/归一化格式“打包”属性（节省带宽）。
- 动态更新与使用提示：`STATIC_DRAW`/`DYNAMIC_DRAW` 的意义与局限。
- “worker 生成 → 主线程上传”的两阶段模型：
  - worker 端构建 typed arrays；
  - 主线程反序列化后上传到 GPU buffer。

仓库定位（强相关文件）：

- `data/array_types.js`：大量 StructArray/TypedArray 的顶点与索引结构定义。
- `util/struct_array.js`：结构化数组的底层实现（如何把字段映射到 TypedArray）。
- `gl/vertex_buffer.js`、`gl/index_buffer.js`：Buffer 封装与上传。
- `data/bucket/*_bucket.js`：每种 layer 的“几何 → 顶点/索引/属性”编码逻辑。
- `data/bucket.js`：Bucket 接口与 worker→主线程反序列化。

---

## 4) VAO（OES_vertex_array_object）：减少 attribute 绑定成本（必会）

WebGL1 没有原生 VAO，需要扩展 `OES_vertex_array_object`。VAO 用来缓存“当前 program 对应的 attribute 绑定与指针设置”，显著减少 draw call 前的状态设置开销。

学习要点：

- VAO 的作用域：保存 attribute enable/disable、`vertexAttribPointer`、绑定的 ARRAY_BUFFER（以及 ELEMENT_ARRAY_BUFFER 的绑定在 VAO 内也会被记录）。
- VAO 与 program/attribute location 的关系：切 program 可能需要不同 VAO 或重新绑定。

仓库定位：

- `gl/context.js`：获取 `OES_vertex_array_object` 扩展并封装绑定。
- `render/vertex_array_object.js`：VAO 的管理与缓存策略（若存在不同实现，按实际代码为准）。

---

## 5) 纹理系统：格式、过滤、mipmap、atlas、像素存储（必会）

地图渲染高度依赖纹理：瓦片栅格、sprite 图标、pattern、glyph atlas、DEM 等。

学习要点：

### 5.1 WebGL 纹理基础

- Texture unit：`activeTexture` + `bindTexture` + uniform sampler 绑定。
- 纹理参数：
  - wrap：`CLAMP_TO_EDGE/REPEAT/MIRRORED_REPEAT`
  - filter：`NEAREST/LINEAR` + mipmap（`LINEAR_MIPMAP_LINEAR` 等）
- mipmap 的生成与限制（非 power-of-two 纹理在 WebGL1 的限制很重要）。

### 5.2 像素存储与 alpha

- `UNPACK_FLIP_Y_WEBGL`：上传图片时 Y 轴翻转。
- `UNPACK_PREMULTIPLY_ALPHA_WEBGL`：预乘 alpha 的上传路径。
- 预乘 alpha 与 blendFunc 的配套（否则会出现边缘发黑/发白）。

### 5.3 Atlas（纹理图集）

- 图集打包（减少纹理切换）：glyph atlas / sprite atlas / pattern atlas。
- UV 计算与边缘 padding（防止线性采样“串色”）。

### 5.4 各向异性过滤（EXT_texture_filter_anisotropic）

- 斜视角/倾斜时提升纹理清晰度（代价是更高采样成本）。

仓库定位：

- `render/texture.js`：纹理对象封装与参数设置。
- `render/image_manager.js`、`render/image_atlas.js`：sprite/pattern 图集构建与更新（含 padding 逻辑）。
- `render/glyph_manager.js`、`render/glyph_atlas.js`：glyph 拉取/缓存/图集。
- `gl/context.js`：`pixelStore*` 的封装、anisotropic 扩展获取与最大值读取。

---

## 6) Framebuffer / Renderbuffer：离屏渲染与多 pass（必会）

地图渲染往往需要离屏 pass（例如某些效果需要先渲染到纹理，再采样合成）。

学习要点：

- FBO 的组成：color attachment（texture 或 renderbuffer）+ depth/stencil attachment（常用 renderbuffer）。
- Framebuffer 完整性检查与常见坑（尺寸不一致、格式不支持）。
- 离屏渲染到纹理，再在主 pass 采样（典型后处理模型）。

仓库定位：

- `gl/framebuffer.js`：FBO/RBO 的封装。
- `gl/context.js`：`createFramebuffer/createRenderbuffer` 与扩展能力探测。
- `render/painter.js`：`RenderPass = offscreen/opaque/translucent` 的组织方式。

---

## 7) 深度测试与深度精度：3D、遮挡与绘制顺序（必会）

fill-extrusion、hillshade、以及 pitch/rotate 下的层叠遮挡，都离不开正确的 depth 配置。

学习要点：

- depth buffer 的意义：同一像素的片元“谁更近谁赢”。
- 常用状态：
  - `depthTest`（开关）
  - `depthFunc`（LESS/LEQUAL/ALWAYS…）
  - `depthMask`（是否写深度）
  - `depthRange`（映射范围）
- 深度精度问题：z-fighting、近平面/远平面选择、clip space 深度分布。

仓库定位：

- `gl/depth_mode.js`：深度模式对象。
- `gl/value.js`：`DepthTest/DepthFunc/DepthMask/DepthRange` 的缓存设置。
- `render/painter.js`：不同 pass/图层类型如何设置 depth（按绘制策略选择）。

---

## 8) Stencil：裁剪（tile clipping）、遮罩与特殊绘制（必会）

Mapbox GL 的一个典型模式是用 stencil 做 tile 裁剪/掩膜，以保证瓦片边界/裁剪区域正确。

学习要点：

- stencil buffer 的基本思想：每个像素一个 8bit（常见）“模板值”，片元通过测试才能写入颜色/深度。
- 关键状态：
  - `stencilFunc(func, ref, mask)`
  - `stencilOp(fail, zfail, zpass)`
  - `stencilMask(writeMask)`
- 常见用法：先写 stencil 再根据 stencil 绘制；或用递增/递减做层级嵌套。

仓库定位：

- `gl/stencil_mode.js`、`gl/value.js`：stencil 状态封装。
- `render/painter.js`、`shaders/clipping_mask.*`：裁剪相关绘制与 shader。

---

## 9) Blending：透明、抗锯齿与图层叠加（必会）

地图图层大量依赖透明混合：图标、文字、pattern、抗锯齿边缘等。

学习要点：

- alpha blending 的公式与常见配置：
  - 非预乘：`src = SRC_ALPHA`，`dst = ONE_MINUS_SRC_ALPHA`
  - 预乘：`src = ONE`，`dst = ONE_MINUS_SRC_ALPHA`
- `blendEquation` 与 `blendFunc` 的差异与组合。
- draw order 与 blending 的关系：透明物体通常需要从后往前绘制（或至少分 pass）。

仓库定位：

- `gl/color_mode.js`、`gl/value.js`：blend、blendFunc、blendEquation、colorMask 等封装。
- `render/painter.js`：opaque/translucent 分离的策略与状态切换。

---

## 10) Cull Face：3D 面剔除与正反面约定（建议掌握）

对 3D（如 fill-extrusion）或某些特殊几何，理解正反面与剔除能帮助你定位“为什么看不见/翻面”的问题。

学习要点：

- `frontFace(CW/CCW)`：顶点绕序决定正面。
- `cullFace(BACK/FRONT)`：剔除哪一面。
- 3D 挤出几何的三角形组织与剔除策略。

仓库定位：

- `gl/cull_face_mode.js`、`gl/value.js`：cull 状态封装。
- `render/draw_fill_extrusion.js`、`shaders/fill_extrusion.*`：挤出绘制与 shader。

---

## 11) WebGL 扩展：本仓库实际用到的（建议掌握）

从 `gl/context.js` 可以看到明确使用的扩展（理解这些扩展会让你读渲染代码更顺畅）：

- `OES_vertex_array_object`：VAO（见第 4 节）。
- `EXT_texture_filter_anisotropic`：各向异性纹理过滤（见第 5 节）。
- `OES_texture_half_float` + `OES_texture_half_float_linear`：半浮点纹理及线性过滤能力（常用于某些中间结果或效果纹理）。
- `EXT_color_buffer_half_float`：允许把 half-float 纹理作为 framebuffer color attachment（render-to-texture）。
- `EXT_disjoint_timer_query`：GPU 计时（性能分析时判断瓶颈在 CPU 还是 GPU）。

仓库定位：

- `gl/context.js`：扩展获取与能力标记。
- `util/performance.js`、`index.js` 的 Debug 扩展：与性能指标收集相关。

---

## 12) 性能与架构：为什么要这样封装（建议掌握）

完全理解仓库不仅是会用 API，而是要理解“为什么这么设计”：

- 状态缓存：避免重复调用 WebGL set*（`gl/value.js` 的 Value 模式）。
- batch/减少 draw calls：通过 bucket、atlas、VAO、program 缓存降低 per-frame 开销。
- 多 pass 绘制：把不透明与透明分开（减少 overdraw、简化 blending），必要时离屏再合成。
- CPU vs GPU 的边界：几何处理、符号布局在 worker；GPU 只做批量栅格化与简单计算。

仓库定位：

- `data/`（bucket/array_types/program_configuration）+ `render/painter.js`：主链路性能关键点。
- `util/dispatcher.js`、`source/worker.js`：worker 分担 CPU 重活的架构。

---

## 13) 配套图形学数学（严格说不属于 WebGL API，但“读懂渲染代码”必备）

如果目标是“完全理解渲染”，下面这些数学知识基本躲不开：

- 线性代数：
  - 向量/矩阵、齐次坐标、矩阵乘法顺序（列主序/行主序概念）。
  - `mat4` 常见构成：model/view/projection、缩放/旋转/平移。
- 坐标系与投影：
  - 经纬度 → Web Mercator → 世界坐标/瓦片坐标 → clip space。
  - tile units、extent、像素到瓦片单位的换算。
- 深度与裁剪：
  - clip space 的 w 分量、透视除法、深度范围与精度分布。

仓库定位：

- `geo/transform.js`：视口与投影的核心。
- `geo/mercator_coordinate.js`、`source/pixels_to_tile_units.js`：常见换算。
- `render/painter.js` / `symbol/projection.js`：矩阵如何落到 shader uniforms。

---

## 14) 建议学习顺序（以“能读懂本仓库”为目标）

1. WebGL1 渲染最小闭环（画一个彩色三角形）
2. VBO/IBO + `drawElements`（画一个带索引的矩形）
3. 纹理采样（画一个贴图矩形 + 理解 texture unit）
4. blending（实现透明 PNG 的正确叠加，分别体验预乘与非预乘）
5. depth test（做两个有深度的三角形，理解遮挡与 depthMask）
6. stencil（做一个简单遮罩裁剪，再对照本仓库的 clipping 逻辑）
7. FBO（渲染到纹理再采样，理解 offscreen pass）
8. VAO 扩展（对比有/无 VAO 的绑定成本）
9. 阅读仓库：从 `render/painter.js` → `render/draw_*.js` → `render/program/*` → `shaders/*` → `data/*` 逐层下钻

---

## 15) 术语速查（读代码时最常见）

- VBO：顶点缓冲（WebGL Buffer + `ARRAY_BUFFER`）
- IBO/EBO：索引缓冲（WebGL Buffer + `ELEMENT_ARRAY_BUFFER`）
- VAO：顶点数组对象（记录 attribute 绑定/指针状态；WebGL1 需扩展）
- FBO：帧缓冲对象（离屏渲染目标）
- RBO：渲染缓冲（常用作 depth/stencil attachment）
- NDC：标准化设备坐标（裁剪后 [-1,1]）
- Pass：一次渲染阶段（opaque/translucent/offscreen 等）
- Atlas：纹理图集（glyph/sprite/pattern）


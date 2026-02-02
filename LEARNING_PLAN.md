# 由浅入深的“最小实现”学习方案（面向理解 new-mapbox-gl-v1 原理）

目标：用一系列 **可运行、可验证、代码量受控** 的最小示例（mini-implementations）逐步复刻本仓库的关键链路：  
**Map（交互/相机）→ Style（图层/样式）→ Source/Tile（数据/瓦片）→ Bucket（顶点/属性编码）→ Painter（多 pass 渲染）→ WebGL 状态/着色器**，并在过程中实现几个“新功能”来巩固理解。

这份方案的特点：

- **每一步都能独立跑起来**（浏览器打开即可验证），不会一上来陷入“工程太大跑不起来”的困境。
- **每一步都有“仓库对照阅读点”**：你写完 mini 版本后，再去读仓库实现，会非常快。
- 强制“最小化”：每个里程碑都建议控制在 **1–3 个文件 / 100–300 行量级**（高级步骤可放宽）。

> 注：本仓库根目录缺少完整的构建工程（没有顶层 `package.json`），因此这份方案默认你在仓库内新建一个独立的学习区（例如 `learning/`）放置最小示例；示例不依赖现有构建链，也不要求能直接打包运行仓库源码。

---

## 0. 学习区与约束（先做一次）

### 0.1 建议的学习目录结构

建议新建：

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

每个目录只放一个最小 demo：`index.html` + `main.js`（必要时再拆 1–2 个模块）。

### 0.2 运行方式（任选其一）

- 方式 A（最简单）：用任意静态服务器（例如 IDE 自带、或 `python -m http.server`）打开 `learning/**/index.html`
- 方式 B（更顺滑）：用 Vite/webpack 做热更新（可选，不是必须）

### 0.3 每一步的“完成定义”（强制）

每个步骤都要求写下并达成：

- **可视化结果**（画出来了 / 能交互 / 能切换样式）
- **一个可观察指标**（帧率、draw call 数、tile 数、buffer 大小、shader 编译日志等）
- **一个对照阅读点**（本仓库对应实现在哪里、你能解释它为什么这么写）

---

## 1. 最小 WebGL 闭环：画出来（理解渲染状态机）

### 目标

用 WebGL1 画一个三角形，理解“状态机 + program + attribute/uniform + draw”闭环。

### 最小示例要求

- 1 个 `index.html` + 1 个 `main.js`
- 输出：彩色三角形 + 控制台打印 shader 编译/链接日志

### 你必须掌握的点

- `createShader/compileShader/linkProgram/useProgram`
- `createBuffer/bufferData/vertexAttribPointer/enableVertexAttribArray`
- `drawArrays`

### 仓库对照阅读

- `gl/context.js`（状态封装的“最终形态”）
- `gl/value.js`（为什么要缓存状态，避免重复 set）

---

## 2. Program 封装：把“重复代码”抽象掉（对应 render/program）

### 目标

写一个 `Program` 类：负责编译 shader、缓存 attribute/uniform location，并提供简单的 `setUniform*` 方法。

### 最小示例要求

- 你写的 `Program` 至少包含：
  - `getAttribLocation(name)`、`getUniformLocation(name)` 的缓存
  - `use()`、`dispose()`
- 验证：切换两套 program（例如纯色 vs 渐变），确保 attribute/uniform 正常工作

### 关键点（与仓库对应）

- location 查找是昂贵的；缓存能显著减少每帧开销
- program 变化会影响 attribute 绑定（后面 VAO/VertexArrayObject 会处理）

### 仓库对照阅读

- `render/program.js`
- `render/program/*_program.js`

---

## 3. VertexBuffer/IndexBuffer：理解数据布局与 drawElements（对应 gl/*_buffer）

### 目标

实现 `VertexBuffer` 与 `IndexBuffer` 两个小类，支持：

- VBO 上传顶点
- IBO 上传索引
- `drawElements` 画一个矩形（两个三角形）

### 最小示例要求

- 使用 `drawElements`（不是 `drawArrays`）
- 能在控制台打印：
  - 顶点数量、索引数量
  - stride/offset（解释你的 layout）

### 你必须掌握的点

- `ARRAY_BUFFER` vs `ELEMENT_ARRAY_BUFFER`
- `vertexAttribPointer(size, type, normalized, stride, offset)`
- 索引顺序如何决定三角形

### 仓库对照阅读

- `gl/vertex_buffer.js`（attribute 类型映射、stride/offset）
- `gl/index_buffer.js`
- `render/vertex_array_object.js`（attribute enable/disable 与 VAO）

---

## 4. Texture：图片上传、采样、alpha 与过滤（对应 render/texture + pixelStore）

### 目标

渲染一个贴图矩形，理解纹理单元、过滤方式与 alpha（预乘/非预乘）的差别。

### 最小示例要求

- 载入一张 PNG（本地文件即可）
- 演示至少两种过滤：
  - `NEAREST`
  - `LINEAR`
- 演示 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 开/关对边缘的影响（用带透明边缘的图片）

### 仓库对照阅读

- `gl/context.js`（`pixelStoreUnpack*` 的封装与默认值）
- `render/texture.js`
- `render/image_manager.js`（sprite/pattern 图像管理的“上层形态”）

---

## 5. 2D 相机与矩阵：从“屏幕”到“世界”（对应 geo/transform）

### 目标

实现一个最小 `Transform`：

- 状态：`center(lng,lat)`、`zoom`、`bearing`、`pitch`（pitch 可先不做或固定 0）
- 输出：一个 `matrix`（mat4）给 shader，把世界坐标点映射到 clip space

### 最小示例要求

- 支持鼠标拖拽平移（改变 center）
- 支持滚轮缩放（改变 zoom）
- 屏幕上画一个“世界坐标系网格”或几个固定世界点，确认变换正确

### 你必须掌握的点

- Web Mercator 的基本概念（lng/lat 到平面坐标）
- 齐次坐标与矩阵乘法顺序
- clip space / NDC / viewport 映射

### 仓库对照阅读

- `geo/transform.js`
- `geo/mercator_coordinate.js`

---

## 6. 瓦片系统最小实现：TileID + 可视瓦片集合（对应 source/tile_id + source_cache）

### 目标

实现：

- `TileID(z, x, y)`（先不管 overscaled/canonical 的全部细节）
- 在给定 `Transform`（center/zoom/viewport）下计算可视瓦片集合（covering tiles）

### 最小示例要求

- 在画布上画出当前可视瓦片边界（矩形线框即可）
- 控制台打印可视瓦片数量，并随缩放变化

### 仓库对照阅读

- `source/tile_id.js`
- `source/source_cache.js`（如何决定加载/卸载 tiles）
- `source/tile_bounds.js`

---

## 7. RasterTile 渲染：把“瓦片图片”贴到正确的位置（对应 raster_tile_source + draw_raster）

### 目标

实现一个最小 RasterSource：

- 输入：tile URL 模板（或本地 tiles 目录）
- 输出：可视瓦片贴图正确拼接成底图

### 最小示例要求

- tile 请求要有并发上限（例如 8 或 16）
- tile 有缓存（Map 移动后不要重复下载）
- tile 贴图对齐正确（无缝/不抖动）

### 仓库对照阅读

- `source/raster_tile_source.js`
- `render/draw_raster.js`
- `util/tile_request_cache.js`
- `index.js`（`maxParallelImageRequests`/`clearStorage` 暴露的意义）

---

## 8. 最小 Style 系统：用 JSON 驱动渲染（对应 style/style + style_layer）

### 目标

实现一个非常小的 style JSON（只支持 2–3 种 layer）：

- `background`（纯色清屏）
- `raster`（第 7 步的底图）
- （可选）`line` 或 `circle`（画点/线以验证叠加）

### 最小示例要求

- 结构类似：
  - `sources: { ... }`
  - `layers: [ ... ]`
- 能通过切换 style JSON 触发重绘
- 能支持至少一个 paint 属性（例如 `raster-opacity`）

### 仓库对照阅读

- `style/style.js`（Style 如何串 sources/layers、触发更新）
- `style/create_style_layer.js` + `style/style_layer/*`
- `style/properties.js`（属性系统的最终形态）
- `style/validate_style.js`（风格：校验与错误上报）

---

## 9. Vector “Bucket” 最小实现：把要素编码为顶点/属性（对应 data/bucket + draw_line/draw_fill）

### 目标

实现一个简化的 vector pipeline（不要求上来就读 MVT）：

- 输入：GeoJSON（点/线/面，先选一种就行）
- 处理：生成一个“bucket”：`positions + indices + 1~2 个属性`
- 输出：用 WebGL 画出来（line 或 fill）

### 最小示例要求

- bucket 是一个纯数据对象（可以被序列化/传输）
- 绘制与 bucket 解耦：`buildBucket(data)` 与 `drawBucket(bucket)` 分离

### 建议最小路线

- 先做 `line`（用简单 polyline 或“屏幕空间线段”）
- 再做 `fill`（需要简单三角剖分：可先用极简 earcut，或只支持凸多边形）

### 仓库对照阅读

- `data/bucket.js`（Bucket 抽象与反序列化）
- `data/bucket/line_bucket.js`、`data/bucket/fill_bucket.js`
- `data/array_types.js`（真实系统如何组织 attribute）
- `render/draw_line.js`、`render/draw_fill.js`

---

## 10. Worker 化：把“重活”挪到 Worker，并 transfer buffers（对应 util/dispatcher + source/worker）

### 目标

把第 9 步的 `buildBucket` 挪到 worker：

- 主线程：负责视口、渲染、资源上传
- worker：负责解析数据、生成 bucket（TypedArray）
- 使用 Transferable 把 `ArrayBuffer` 零拷贝传回主线程

### 最小示例要求

- 你能在控制台看到：
  - worker 生成 bucket 的耗时
  - 主线程收到数据后的上传耗时
- 你能解释为什么要用 transfer（而不是结构化拷贝）

### 仓库对照阅读

- `util/dispatcher.js`
- `util/actor.js`
- `util/web_worker_transfer.js`
- `source/worker.js`

---

## 11. 多 Pass 与 Stencil：做一个“tile clipping”最小版（对应 clipping_mask）

### 目标

实现一个最小 stencil clipping：

- pass 1：写入 stencil（瓦片边界 mask）
- pass 2：只有 stencil 通过的像素才绘制瓦片内容

### 最小示例要求

- 视觉验证：瓦片内容不会画到 tile 边界外
- 你能在代码里指出 `stencilFunc/stencilOp/stencilMask` 的作用

### 仓库对照阅读

- `gl/stencil_mode.js`
- `gl/value.js`（stencil 状态封装）
- `render/program/clipping_mask_program.js`
- `shaders/clipping_mask.*`

---

## 12. Symbol（文字/图标）最小实现：碰撞、淡入淡出（对应 symbol/*）

> 这是最难的一步，建议在前面链路熟练后再做。

### 目标

实现一个“点标注”最小系统：

- 输入：若干点（世界坐标）+ 文本字符串
- 输出：把文字画出来（可以用 Canvas2D 先画到纹理，再贴到 WebGL）
- 做一个最小碰撞检测（网格/栅格占位），避免重叠
- 做一个最小淡入淡出（opacity 随时间插值）

### 最小示例要求

- 你能观察到：缩放/移动时 label 的出现/消失是稳定的（不要疯狂闪烁）

### 仓库对照阅读

- `symbol/collision_index.js`、`symbol/grid_index.js`
- `symbol/placement.js`（淡入淡出与 placement 状态）
- `symbol/shaping.js`（更完整的文本 shaping，了解边界即可）

---

## 13. 从“理解”到“扩展”：做 3 个新功能（建议按难度选）

下面给出 6 个新功能候选，你至少做其中 3 个。它们都能在你的 mini 实现里完成，同时能映射回仓库的真实实现思路。

### 新功能 A（简单）：显示 tile 边界与 tile ID

- 做法：在每个 tile quad 上叠加线框 + 文本（或只线框）
- 你需要的知识：基础 drawLine / 单独 debug pass
- 对照阅读：`render/draw_debug.js`、`render/draw_collision_debug.js`

### 新功能 B（简单）：导出截图（readPixels）

- 做法：`gl.readPixels` 读回 framebuffer，转成 PNG（或放到 `<canvas>`）
- 你需要的知识：像素格式、flipY、性能注意事项
- 对照阅读：`gl/framebuffer.js`（离屏渲染）+ 你自己的 FBO/主屏策略

### 新功能 C（中等）：feature picking（点选高亮）

- 方案 1（简单）：CPU 命中测试（用你的几何数据做点/线/面相交）
- 方案 2（更像真实引擎）：离屏颜色编码 picking（每个 feature 一个颜色 id）
- 对照阅读：`source/query_features.js`、`data/feature_index.js`

### 新功能 D（中等）：实现一个 “CustomLayer” 回调接口

- 做法：给用户一个 hook：每帧拿到 `gl` 与 `matrix`，可自绘内容
- 对照阅读：`style/style_layer/custom_style_layer.js`

### 新功能 E（中等）：smart setStyle（样式差量更新）

- 做法：对比新旧 style JSON，只更新变更的 layer/source（最小只做 paint 属性更新）
- 对照阅读：`style/style.js` + `style-spec/diff.js`

### 新功能 F（偏难）：GPU 计时与性能面板

- 做法：用 `EXT_disjoint_timer_query` 测 GPU draw 时间
- 对照阅读：`gl/context.js`（timer query 扩展获取）+ `util/performance.js`

---

## 14. 学习节奏建议（可按周/按里程碑）

如果你每天 1–2 小时，推荐节奏：

- 第 1 周：步骤 1–4（WebGL 基础闭环 + buffer/texture）
- 第 2 周：步骤 5–7（Transform + tile + raster）
- 第 3 周：步骤 8–10（style 最小系统 + vector bucket + worker）
- 第 4 周：步骤 11–13（stencil、多 pass、symbol 入门、做 3 个新功能）

如果你只想快速理解仓库而不做 symbol：可以先跳过步骤 12，先做新功能 A/C/D/E（对理解整体架构更直接）。

---

## 15. 你完成后应能回答的“自测问题”（强烈建议写在笔记里）

1. 为什么本仓库要用 `gl/value.js` 这种“状态缓存对象”？如果不缓存会怎样？
2. `VertexArrayObject` 在有/无 `OES_vertex_array_object` 扩展时分别怎么工作？（对照 `render/vertex_array_object.js`）
3. bucket 为什么要在 worker 生成，再 transfer 回主线程？哪些数据适合 transfer，哪些不适合？
4. 为什么渲染要分 `opaque/translucent/offscreen` 这类 pass？混合与绘制顺序的关系是什么？
5. tile clipping 为什么用 stencil 而不是在 shader 里 if 判断？
6. 纹理 atlas 的 padding 为何存在？不 padding 会出现什么采样问题？

---

## 16. 建议的“仓库阅读顺序”（与本方案对齐）

按你完成的步骤回读仓库，效率最高：

1. `render/painter.js`（先看渲染调度与 pass）
2. `gl/context.js` + `gl/value.js`（再看状态与扩展）
3. `render/vertex_array_object.js` + `gl/vertex_buffer.js`（再看 attribute/VAO）
4. `source/source_cache.js` + `source/tile.js`（再看瓦片生命周期）
5. `style/style.js` + `style/style_layer/*`（再看 style 系统如何驱动）
6. `source/worker.js` + `util/dispatcher.js`（再看 worker 通信）
7. `symbol/*`（最后看 label 系统）


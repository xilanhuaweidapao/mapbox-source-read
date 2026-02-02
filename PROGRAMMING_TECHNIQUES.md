# 仓库里值得学习的编程技巧（含原因与定位点）

本仓库属于“高性能、强交互、强兼容性”的前端工程类型（地图 + WebGL + Worker + 网络加载）。因此很多技巧不是“语法层面”，而是围绕 **性能、并发、资源生命周期、可维护性与可扩展性** 的工程化方法。

下面按主题列出值得学习的技巧，并给出“为什么值得学”与“代码定位点”。

---

## 1) 性能与资源管理类技巧

### 1.1 WebGL 状态缓存（避免重复 set*）

- **技巧**：把 WebGL 的状态（blend/depth/stencil/cull/viewport/bindTexture/bindBuffer…）封装成“带缓存/dirty 标记”的对象，只有变化才真正调用 WebGL API。
- **原因**：地图渲染 draw call 多、状态切换频繁；重复 set 状态会显著增加 CPU 开销与主线程卡顿概率。
- **定位点**：`gl/value.js`、`gl/context.js`

### 1.2 VAO 抽象 + 无扩展时降级（兼容性与性能兼得）

- **技巧**：封装 `VertexArrayObject`，优先用 `OES_vertex_array_object` 缓存 attribute 绑定；不支持时执行“手动 enable/vertexAttribPointer”的降级路径。
- **原因**：在支持扩展的设备上大幅减少 attribute 绑定成本；在不支持设备上仍可运行，且逻辑集中在一个模块内。
- **定位点**：`render/vertex_array_object.js`、`gl/context.js`

### 1.3 TypedArray/StructArray 驱动的数据管线（减少 GC + 支持 Transfer）

- **技巧**：用 StructArray/TypedArray 组织顶点、索引、碰撞等数据；worker 侧生成、主线程反序列化后上传到 GPU buffer。
- **原因**：比普通 JS 对象/数组更省内存、更快、更可预测；还能把 `ArrayBuffer` 当作 Transferable 零拷贝传回主线程。
- **定位点**：`util/struct_array.js`、`data/array_types.js`、`data/bucket.js`、`gl/vertex_buffer.js`、`gl/index_buffer.js`

### 1.4 “规范/模板驱动”的代码生成（减少重复与人为错误）

- **技巧**：用模板（EJS）生成重复性强的代码：StructArray 类、布局类、style layer 的 properties/type 定义等。
- **原因**：数据结构与样式规范复杂且变化频繁；手写易出错、维护成本高。生成可以保证一致性与可更新性。
- **定位点**：`util/struct_array.js.ejs`、`util/struct_array_layout.js.ejs`、`style/style_layer/layer_properties.js.ejs`

### 1.5 “重活放 Worker”的流水线设计（主线程更流畅）

- **技巧**：把瓦片解析、bucket 构建、部分布局计算迁到 worker；主线程聚焦交互与渲染。
- **原因**：地图在平移/缩放时最怕主线程被 CPU 任务堵住；worker 化是前端性能的关键手段之一。
- **定位点**：`util/dispatcher.js`、`util/actor.js`、`source/worker.js`、`source/*_worker_source.js`

### 1.6 可 Transfer 的序列化注册表（高性能 worker 通信）

- **技巧**：通过 `register()` 给类打上 `_classRegistryKey`，在 `serialize/deserialize` 中统一处理对象图，并把 ArrayBuffer/TypedArray 放入 transferables。
- **原因**：结构化拷贝（structured clone）对复杂对象图很慢；统一的注册表能保证类型可控、传输可控、性能可控。
- **定位点**：`util/web_worker_transfer.js`（以及 `source/tile_id.js` 等文件中的 `register()` 用法）

### 1.7 计算结果缓存与失效策略（矩阵/派生量）

- **技巧**：对高频、可复用的计算结果做缓存（例如按 tile key 缓存 `posMatrix`），并在相机/尺寸变化时集中清空缓存。
- **原因**：矩阵计算与几何换算在地图中非常高频；缓存能减少每帧重复计算、降低 CPU。
- **定位点**：`geo/transform.js`（`calculatePosMatrix` 与 `_posMatrixCache`）

### 1.8 Atlas（图集）管理减少纹理绑定（高吞吐渲染）

- **技巧**：把 glyph、sprite/pattern 等小图合并到 atlas 纹理，减少 texture bind 次数；同时用 padding 避免线性过滤串色。
- **原因**：纹理切换昂贵；atlas 是渲染引擎的经典优化手段，尤其适合 symbol/icon/pattern。
- **定位点**：`render/image_manager.js`、`render/image_atlas.js`、`render/glyph_manager.js`、`render/glyph_atlas.js`

---

## 2) 可靠性、可维护性与兼容性类技巧

### 2.1 Cancelable 请求（AbortController）+ XHR 兜底（适配面更广）

- **技巧**：统一封装请求层，提供 `Cancelable` 接口；优先用 `fetch + AbortController`，必要时回退到 `XMLHttpRequest`。
- **原因**：地图交互会频繁触发请求；取消无用请求能减少带宽与 CPU；同时要兼顾旧浏览器与特殊环境。
- **定位点**：`util/ajax.js`、`types/cancelable.js`

### 2.2 能力探测（capability detection）而非 UA 猜测

- **技巧**：用真实能力测试判断 WebP/OffscreenCanvas/扩展支持，而不是依赖浏览器 UA；并做结果缓存避免重复检测。
- **原因**：设备差异大且 UA 不可靠；真实探测更稳健。
- **定位点**：`util/webp_supported.js`、`util/offscreen_canvas_supported.js`、`gl/context.js`

### 2.3 事件系统带“冒泡”和“once”（解耦组件、减少胶水代码）

- **技巧**：Evented 支持 `on/off/once`，并支持把子模块事件冒泡到父模块，同时避免“监听器在回调中增删导致遍历异常”（用 `.slice()` 复制数组）。
- **原因**：地图引擎组件多、事件多；统一事件模型让 UI/Style/Source/Render 的协作更可控。
- **定位点**：`util/evented.js`

### 2.4 “断言 + 明确错误类型”提升可诊断性（fail fast）

- **技巧**：大量使用 `assert` 守住关键不变量；网络层用 `AJAXError` 携带 status/url，并给出更具体的错误提示。
- **原因**：引擎内部状态复杂，早失败比“带病运行”更省排查成本；可诊断错误能缩短定位时间。
- **定位点**：`util/ajax.js`（`AJAXError`）、`source/source.js`（id 校验）、`render/vertex_array_object.js`（attribute 0 坑位保护）等

### 2.5 `warnOnce` 防日志刷屏（性能与体验）

- **技巧**：同一警告只打印一次；worker 环境下注意 `console` 可能不存在。
- **原因**：地图在缺图/缺资源时可能触发大量重复警告；刷屏既影响性能也影响开发体验。
- **定位点**：`util/util.js`（`warnOnce`）、`render/image_manager.js`（missing image 提示）

### 2.6 环境抽象（window/browser shim）提升可移植性与可测试性

- **技巧**：不要到处直接引用全局 `window/self/document`，而是集中从 `util/window.js`/`util/browser/window.js` 获取；在 Node 环境可用 JSDOM/headless-gl 模拟。
- **原因**：让代码能在不同环境（浏览器/worker/Node 测试）下运行，减少条件分支散落在业务逻辑中。
- **定位点**：`util/window.js`、`util/browser/window.js`

---

## 3) 可扩展、可测试与可调试类技巧

### 3.1 通过“注册/注入点”实现插件化扩展（Source、WorkerSource、RTL）

- **技巧**：提供明确的注册入口：worker 侧可 `registerWorkerSource`，主线程暴露 `setRTLTextPlugin` 等能力。
- **原因**：地图引擎需要允许业务或第三方接入新数据源/特殊文字处理；插件化能隔离核心与扩展。
- **定位点**：`source/worker.js`（`self.registerWorkerSource`）、`source/rtl_text_plugin.js`、`index.js`

### 3.2 “可替换静态成员”便于单元测试 stubbing（轻量 DI）

- **技巧**：把关键依赖挂在类的 static 属性上（例如 `Dispatcher.Actor`、`GlyphManager.loadGlyphRange`/`TinySDF`），测试时可替换。
- **原因**：不引入复杂依赖注入框架，也能做到单元测试可控与可模拟。
- **定位点**：`util/dispatcher.js`、`render/glyph_manager.js`

### 3.3 Debug 命名空间可被构建剥离（开发态强、生产态轻）

- **技巧**：把调试辅助代码集中在 `util/debug.js`，并在入口（如 `index.js`）用 Debug.extend 注入调试能力；生产构建时可整体剥离。
- **原因**：调试/诊断能力很重要，但不应给生产包体积与性能带来长期负担。
- **定位点**：`util/debug.js`、`index.js`

### 3.4 通过 `ResourceType` + `transformRequest` 实现“网络层可定制”

- **技巧**：为不同资源（Style/Source/Tile/Glyphs/Sprite/Image…）打上类型，并在 request manager 中提供统一的 URL/headers/credentials 修改入口。
- **原因**：真实项目中常需要鉴权、签名、代理、统计、灰度；把定制点集中在请求层可避免侵入渲染/数据逻辑。
- **定位点**：`util/ajax.js`（`ResourceType`, `RequestParameters`）、`util/mapbox.js`（RequestManager）

---

## 4) 小结：这些技巧为什么“值得学”

- 它们解决的是大规模前端系统的共性难题：**性能（CPU/GPU/内存/网络）**、**并发与生命周期**、**跨环境兼容**、**可扩展与可测试**。
- 这些技巧往往可以迁移到任何“高吞吐渲染/实时交互/大数据可视化”项目：不仅限于地图。


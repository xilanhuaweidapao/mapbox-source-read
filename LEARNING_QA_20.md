# 用 20 个问题快速学习本仓库（含回答）

本文按“从入口 → 数据流 → 渲染 → 交互/查询 → 性能/扩展”的学习路径，给出 20 个高价值问题，并给出简明回答与代码定位点（文件路径）。

---

## 1) 这个仓库的对外入口是什么？我应该从哪里开始读？

**答：**对外 API 聚合在 `index.js`，这里导出 `Map`、控件、`Marker/Popup`、地理对象（`LngLat`/`LngLatBounds`/`MercatorCoordinate`）以及 worker 预热/缓存清理等工具方法。核心主入口类是 `ui/map.js`（`Map`）。  
推荐阅读顺序：`index.js` → `ui/map.js` → `style/style.js` → `source/source_cache.js`/`source/tile.js` → `render/painter.js` → `symbol/*`。

---

## 2) 创建一个 `Map` 时内部都初始化了哪些关键对象？

**答：**`ui/map.js` 会把 UI 容器、WebGL 上下文、相机/投影、样式系统、渲染器、交互系统串起来。典型关键对象包括：

- `geo/transform.js`：相机/投影与矩阵（center/zoom/bearing/pitch、covering tiles 等）
- `style/style.js`：Style 管理（sources/layers、sprite/glyph、diff 更新）
- `render/painter.js`：渲染调度中心（render passes、draw_* 调用、program/texture 协作）
- `ui/handler_manager.js` + `ui/handler/*`：交互手势（拖拽、滚轮、触摸等）

---

## 3) Style JSON 是怎么被加载、校验，并变成可渲染的 layers/sources 的？

**答：**`style/style.js` 负责加载 style JSON（sources、layers、glyphs、sprite…），并调用校验逻辑（`style/validate_style.js` + `style-spec/validate/*`）。  
StyleLayer 对象由 `style/create_style_layer.js` 创建，并落在 `style/style_layer/*`（按 layer 类型分文件）。  
Style-spec（v8）与表达式/过滤器/validate/diff 等能力在 `style-spec/`。

---

## 4) 这个仓库支持哪些 Source 类型？新增自定义 Source 的“正确入口”在哪里？

**答：**内置 Source 类型通过 `source/source.js` 的 `sourceTypes` 工厂创建（vector/raster/raster-dem/geojson/video/image/canvas）。  
新增自定义 Source 的主线程入口通常是：

- 在 `source/source.js` 注册或通过 `Style#addSourceType`（在 `style/style.js` 中可搜索相关能力）扩展 source type；
- 如果需要 worker 侧解析（几乎总是需要），还要配套 worker 侧注册 `WorkerSource`（见 `source/worker.js` 与 `self.registerWorkerSource`）。

---

## 5) `SourceCache` 是什么？它解决了什么问题？

**答：**`source/source_cache.js` 是每个 source 对应的“瓦片与生命周期管理器”，负责：

- 创建 source 实例、转发 source 事件
- 根据当前视口（`geo/transform.js`）计算需要哪些 tile
- 加载/卸载 tile，并维护 tile cache（避免反复请求）
- 管理 feature-state（`source/source_state.js`）

它把“数据源语义”与“瓦片生命周期/缓存/视口驱动”统一起来，是 tile-driven 引擎的核心枢纽。

---

## 6) `Tile` 对象里保存了什么？它在主线程扮演什么角色？

**答：**`source/tile.js` 表示一个具体瓦片的主线程状态机，典型包含：

- 加载状态（loading/loaded/reloading/unloaded/errored/expired）
- worker 回传的 buckets（通过 `data/bucket.js#deserialize` 反序列化）
- 查询索引相关引用（feature index）
- 渲染资源引用（纹理、glyph/image atlas、DEM、FBO 等）

它连接了“worker 计算结果”与“GPU 上传/绘制”。

---

## 7) Worker 系统是如何组织的？消息是怎么派发的？

**答：**

- 主线程通过 `util/dispatcher.js`（Dispatcher）管理 worker 池（`util/worker_pool.js`）并通过 Actor（`util/actor.js`）发送消息。
- worker 入口是 `source/worker.js`，负责响应 `loadTile/reloadTile/abortTile/removeTile` 等请求，并分发到 `source/*_worker_source.js`。
- 传输通常以 typed arrays/ArrayBuffer 为主，借助 `util/web_worker_transfer.js` 做可 transfer 的序列化/反序列化。

---

## 8) 什么是 Bucket？为什么要有 Bucket 这一层抽象？

**答：**Bucket 是“把 tile 中的要素（feature）转换为 GPU 可绘制数据”的抽象接口，定义在 `data/bucket.js`。  
它的核心价值是：将不同 layer 类型（line/fill/symbol/…）的几何与样式属性编码成统一的“顶点/索引/属性数组”，便于 worker 构建、主线程上传、Painter 统一绘制。

不同类型 Bucket 的具体实现位于 `data/bucket/*_bucket.js`（例如 `line_bucket.js`、`fill_bucket.js`、`symbol_bucket.js`）。

---

## 9) 顶点属性（attributes）是怎么组织/打包的？为什么不直接用普通 JS 数组？

**答：**为了性能与可 transfer，仓库大量使用 TypedArray/StructArray：

- `data/array_types.js`：定义各类顶点/索引/碰撞等结构化数组类型
- `util/struct_array.js`：StructArray 底层，实现“字段 → typed array 布局”的映射
- `gl/vertex_buffer.js`/`gl/index_buffer.js`：把 StructArray 上传为 WebGL Buffer

这样做能显著减少内存占用与 GC，并让 worker→主线程的数据传输更高效（transfer ArrayBuffer）。

---

## 10) WebGL 状态为什么要封装成 `gl/value.js` 这种模式？好处是什么？

**答：**WebGL 是状态机，重复调用 set* 会造成大量 CPU 开销。`gl/value.js` 把常见状态（blend/depth/stencil/cull/viewport/bindTexture…）封装为可缓存对象，只有“状态变化”才真正调用 WebGL API。  
这类封装常带来高收益的 CPU 降耗，尤其在 draw call 多、状态切换频繁的地图场景。

相关入口：`gl/context.js`（创建各种 Value 实例并集中管理）。

---

## 11) VAO 在本仓库里是怎么工作的？没有扩展时如何降级？

**答：**`render/vertex_array_object.js` 统一管理 attribute 的启用与指针设置：

- 若支持 `OES_vertex_array_object`（在 `gl/context.js` 获取扩展），就用 VAO 缓存 attribute/buffer 绑定，减少每帧开销；
- 若不支持 VAO，就在每次 freshBind 时按 program 的 `numAttributes` 做 enable/disable 与 `vertexAttribPointer` 设置（并注意 attribute 0 禁用会导致 WebGL 崩溃的坑）。

---

## 12) Shader 在哪里？`#pragma mapbox:` 是什么？我想加一个新效果从哪入手？

**答：**

- GLSL 源码在 `shaders/`，说明见 `shaders/README.md`。
- `#pragma mapbox:` 是 shader 预处理约定：用统一语法声明/初始化变量，然后由编译器在不同上下文生成 uniform/attribute/插值代码，解决“数据驱动样式 + zoom 插值”的爆炸组合。

新增渲染效果通常要同时改三块：

1) `render/draw_*.js`：绘制逻辑（pass、状态、uniform/texture 绑定）  
2) `render/program/*`：program 与 uniforms 定义/绑定  
3) `shaders/*`：GLSL 实现与 pragma 变量  

---

## 13) `Painter` 的职责是什么？`draw_*` 为什么要分文件？

**答：**`render/painter.js` 是渲染调度中心：管理 render passes（opaque/translucent/offscreen 等）、切换 GL 状态、选择合适的 program、并把不同 layer 类型委托给 `render/draw_*.js`。  
`draw_*` 分文件的好处是把“按 layer 类型的特殊绘制逻辑”隔离开：例如 line 的 join/cap/antialias、symbol 的 glyph/icon、hillshade 的 DEM 处理等。

---

## 14) Sprite/Icon/Pattern 是怎么管理的？如果图片缺失会发生什么？

**答：**

- `style/load_sprite.js` 负责加载与解析 sprite。
- `render/image_manager.js` 负责图像注册、pattern atlas 构建、以及“图片缺失”的通知：如果请求的 image id 不存在，会触发 `styleimagemissing` 事件并 `warnOnce` 提示用户可通过 `map.addImage()` 或 style sprite 提供缺失图片。

---

## 15) Glyph/字体是怎么加载与缓存的？为什么有 TinySDF？

**答：**`render/glyph_manager.js` 负责 glyph 的请求、缓存与回调合并：

- 通过 `style/load_glyph_range.js` 拉取 glyph range（按 256 分段）
- 对部分表意文字支持本地字体生成（TinySDF），减少网络依赖并提升渲染一致性

这套机制服务于 symbol 文本绘制与性能（减少重复请求、合并同 range 并发）。

---

## 16) Symbol（文字/图标）为什么是最复杂的模块？核心对象有哪些？

**答：**Symbol 涉及：文本排版（shaping）、沿线布局、碰撞检测、跨瓦片稳定、淡入淡出、pitch/rotate 下的投影变化等。

核心文件：

- `symbol/placement.js`：放置决策 + opacity 状态机（避免闪烁）
- `symbol/collision_index.js`/`symbol/grid_index.js`：碰撞数据结构与快速查询
- `symbol/cross_tile_symbol_index.js`：跨瓦片稳定（减少 tile 切换抖动）
- `symbol/shaping.js`：文本 shaping/writing-mode 等

---

## 17) `queryRenderedFeatures` / `querySourceFeatures` / `queryRenderedSymbols` 的差异是什么？

**答：**入口在 `source/query_features.js`：

- `queryRenderedFeatures`：基于当前渲染结果与可视 tiles，按 query geometry 做命中查询，并按 layer 组织返回（会合并 feature-state）。
- `querySourceFeatures`：基于 source 数据（当前可渲染 tiles 的原始数据层面）做查询；不一定反映最终渲染过滤/绘制顺序。
- `queryRenderedSymbols`：专门针对符号（文字/图标），通过 `collisionIndex.queryRenderedSymbols` 与 retainedQueryData 反查 features，并按“视觉自上而下”顺序排序。

---

## 18) 什么是 feature-state？它怎么影响渲染与查询？

**答：**feature-state 是给单个要素附加“交互态”的机制（hover/selected 等），存储在 `source/source_state.js`，并在查询结果里合并到 feature（见 `source/query_features.js` 的 state merge 逻辑）。  
样式表达式可以读取 state，从而实现“不改数据、只改状态”的交互高亮。

---

## 19) 缓存与资源生命周期有哪些关键点？如何主动清理？

**答：**典型缓存/资源包括：

- tile cache：`source/tile_cache.js` + `source/source_cache.js`
- 请求/存储缓存：`util/tile_request_cache.js`（在 `index.js` 暴露 `clearStorage()`）
- worker 预热与共享：`util/global_worker_pool.js`（在 `index.js` 暴露 `prewarm()`/`clearPrewarmedResources()`）

主动清理的 API 入口主要在 `index.js`（clearStorage / clearPrewarmedResources 等）。

---

## 20) 如果我要做一个小改动/新功能，最推荐的“练手切入点”有哪些？

**答：**选你最关心的一条链路做“可视化可验证”的小改动，推荐 4 个练手点：

1) **调试绘制（tile 边界/碰撞盒）**：从 `render/draw_debug.js`、`render/draw_collision_debug.js` 入手  
2) **自定义图层（CustomLayerInterface）**：从 `style/style_layer/custom_style_layer.js` 入手  
3) **请求与缓存策略**：从 `util/ajax.js`、`util/tile_request_cache.js`、`source/source_cache.js` 入手  
4) **要素查询与拾取**：从 `source/query_features.js`、`data/feature_index.js` 入手  

练手建议：每次只改一个点，并加入一个可观察的开关或日志，让你能确认“改动确实生效且没有副作用”。


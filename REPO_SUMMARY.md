# new-mapbox-gl-v1 仓库梳理（按功能模块）

面向“快速理解代码结构 / 二次开发定位入口”的总结文档。

本目录的代码组织与 **Mapbox GL JS（v1 时代）** 的核心模块高度一致：以 `ui/Map` 为主入口，`style/Style` 管理样式与图层，`source/` 负责数据源与瓦片生命周期，`render/`+`gl/`+`shaders/` 负责 WebGL 渲染，`symbol/` 负责文字/图标排版与碰撞检测，并通过 `util/dispatcher`+`source/worker` 将瓦片解析与布局计算下放到 WebWorker。

---

## 1. 代码入口与对外 API

### 1.1 主入口

- `index.js`：对外导出集合（类似 `mapboxgl.*`）。
  - 导出 `Map`、常用控件（`NavigationControl`/`GeolocateControl`/`ScaleControl`/`FullscreenControl`/`AttributionControl`）、`Marker`/`Popup`。
  - 导出地理对象：`LngLat`、`LngLatBounds`、`MercatorCoordinate`、`Point`。
  - 导出基础事件能力：`Evented`。
  - 导出全局配置：`config`（如 `accessToken/baseApiUrl/maxParallelImageRequests/workerCount` 等在这里透出或间接透出）。
  - 导出 Worker 预热/清理与缓存清理：`prewarm()`、`clearPrewarmedResources()`、`clearStorage()`。

### 1.2 典型调用链（从 setStyle 到一帧渲染）

> 下面的“链路图”用于帮助你把目录与职责对上号。

1. `ui/map.js`（`Map`）创建 WebGL 上下文（`gl/context.js`）与渲染器（`render/painter.js`），并持有 `geo/transform.js`（相机/投影状态）。
2. `style/style.js`（`Style`）加载/解析 style JSON，创建 `source/source_cache.js`（每个 source 一个）与 `style/style_layer/*`（每个 layer 一个）。
3. `source/source_cache.js` 根据当前视口（`geo/transform.js`）决定需要哪些瓦片（`source/tile_id.js`/`source/tile.js`），发起加载/卸载。
4. `util/dispatcher.js` 将瓦片解析任务派发到 worker：`source/worker.js`。
5. Worker 内部通过 `source/*_worker_source.js` 解析瓦片/GeoJSON、构建 `data/bucket/*`（WebGL buffer 所需数据），并回传主线程。
6. 主线程 `source/tile.js` 反序列化 buckets（`data/bucket.js#deserialize`），并交给 `render/painter.js` 在合适的 render pass 中绘制：
   - `render/draw_*.js`：按 layer 类型具体绘制（fill/line/symbol/raster/hillshade/…）。
   - `render/program/*` + `shaders/*`：shader 与 program 组装/编译。
   - `symbol/*`：符号（文字/图标）布局、碰撞与淡入淡出。

---

## 2. 顶层目录一览（按功能模块）

| 模块 | 目录/文件 | 主要职责 |
|---|---|---|
| 对外 API 聚合 | `index.js` | 导出 Map、控件、地理对象、全局配置与 worker/caches 工具方法 |
| UI & 交互 | `ui/` | `Map`、相机控制、事件系统、交互手势、控件、Marker/Popup |
| 坐标与投影 | `geo/` | 经纬度/边界/墨卡托坐标、视口变换（Transform） |
| 样式系统 | `style/` | style JSON 加载/校验/diff、图层对象、属性系统、light、placement 调度 |
| 数据源与瓦片 | `source/` | 各类 Source（vector/raster/geojson/...）、瓦片缓存与生命周期、worker 协议、要素查询 |
| 瓦片数据结构 | `data/` | Buckets（按 layer 类型）、WebGL buffers/attributes、feature index、DEM 数据等 |
| 文字/图标排版 | `symbol/` | shaping、锚点计算、碰撞检测、跨瓦片符号一致性、淡入淡出与放置策略 |
| 渲染器 | `render/` | Painter、draw_*、program 管理、纹理/atlas、glyph/image 管理 |
| WebGL 状态抽象 | `gl/` | Context、depth/stencil/color/cull 状态对象、buffer 封装 |
| GLSL 着色器 | `shaders/` | 各图层类型 shader、pragmas、shader 预处理与导出 |
| 通用工具 | `util/` | ajax/请求、事件、worker 通信、缓存、性能、DOM/window 适配、杂项算法 |
| 样式规范工具包 | `style-spec/` | style-spec v8 reference、表达式/过滤器、diff/migrate/validate、CLI 工具 |
| CSS 资源 | `css/` | `mapbox-gl.css` 与相关 SVG 资源 |
| Flow 类型定义 | `types/` | 常用类型：`callback/cancelable/tilejson/transferable/window` 等 |

---

## 3. 模块详解

### 3.1 `ui/`：Map API、交互与控件

核心文件：

- `ui/map.js`：整个运行时的“粘合层”
  - 管理画布容器、WebGL 上下文、渲染循环。
  - 管理 `Style` 生命周期（加载、切换、事件派发）。
  - 管理交互：`ui/handler_manager.js` 组合各类 handler。
  - 对外暴露常见 API（如 setStyle、addLayer、queryRenderedFeatures、fitBounds 等，具体以源码为准）。
- `ui/camera.js`：相机动画/视角控制（center/zoom/bearing/pitch 等）。
- `ui/events.js`：Map 事件类型与派发逻辑（鼠标/触摸/数据事件等）。
- `ui/hash.js`：URL hash 同步（视角状态 ↔ URL）。
- `ui/marker.js` / `ui/popup.js`：DOM overlay（Marker/Popup）的实现。

控件与手势：

- `ui/control/*.js`：导航、定位、比例尺、全屏、归因、logo。
- `ui/handler/*.js`：滚轮缩放、拖拽平移、旋转、双击缩放、框选缩放、触摸缩放/旋转等。
  - `ui/handler/shim/*`：为不同环境/输入模型提供 shim 的 handler 实现（便于兼容）。

你改 UI/交互通常从这里入手：`ui/map.js`（API）、`ui/handler_manager.js`（交互组合）、`ui/control/*`（控件）。

---

### 3.2 `geo/`：坐标、边界与视口变换

- `geo/lng_lat.js`：经纬度对象与相关运算。
- `geo/lng_lat_bounds.js`：经纬度边界（Bounds）与包含/扩展等。
- `geo/mercator_coordinate.js`：墨卡托坐标（常用于自定义图层或地理到世界坐标变换）。
- `geo/transform.js`：视口/相机的核心状态与变换
  - “屏幕像素 ↔ 世界坐标/瓦片坐标 ↔ 经纬度”的换算中心。
  - 影响瓦片选择（source_cache）与绘制矩阵（painter）。
- `geo/edge_insets.js`：fitBounds 等功能用到的边距/内边距表示。

---

### 3.3 `style/`：样式系统（Style/Layers/Properties）

核心：

- `style/style.js`：Style 管理器
  - 加载 style JSON（包含 sources/layers/sprite/glyphs 等配置）。
  - 校验与错误上报：`style/validate_style.js` + `style-spec/validate`。
  - 与 `source/source_cache.js` 协作管理瓦片更新与渲染所需资源（glyphs/images）。
  - 支持“智能 setStyle”：通过 `style-spec/diff.js` 生成差量操作，避免全量重建。
  - 管理符号放置：`style/pauseable_placement.js`、`symbol/cross_tile_symbol_index.js`。
- `style/style_layer.js`：StyleLayer 基类与公共逻辑。
- `style/style_layer/`：按 layer 类型的实现
  - 如 `fill_style_layer.js`、`line_style_layer.js`、`symbol_style_layer.js` 等。
  - `custom_style_layer.js`：自定义图层（CustomLayerInterface）入口（通常也是二次开发常用点）。
- `style/properties.js`：属性系统（layout/paint、transition、数据驱动表达式的承载）。
- `style/light.js`：3D 与阴影相关的 light 定义（配合 fill-extrusion / hillshade 等）。
- `style/query_utils.js`：与要素查询相关的工具。

资源加载：

- `style/load_sprite.js`：sprite 加载与解析。
- `style/load_glyph_range.js`：glyphs 加载（配合 `render/glyph_manager.js`）。
- `style/parse_glyph_pbf.js`：解析 glyph pbf 数据。

---

### 3.4 `source/`：数据源、瓦片与 Worker

Source 类型（主线程）：

- `source/source.js`：Source 接口定义 + 工厂方法（根据 `specification.type` 创建对应 source 实例）。
- `source/vector_tile_source.js`：矢量瓦片 source。
- `source/raster_tile_source.js`：栅格瓦片 source。
- `source/raster_dem_tile_source.js`：DEM（地形）瓦片 source。
- `source/geojson_source.js`：GeoJSON source（worker 中切片/索引）。
- `source/image_source.js` / `source/video_source.js` / `source/canvas_source.js`：image/video/canvas 类型 source。

瓦片管理与缓存：

- `source/source_cache.js`：每个 source 一个 cache，负责：
  - 创建 source 实例、转发 source 事件；
  - 根据视口选择需要加载的瓦片；
  - 维护 tile cache，卸载不可见瓦片；
  - 管理 feature-state（`source/source_state.js`）。
- `source/tile.js`：Tile 对象（加载状态机、过期刷新、bucket 反序列化、纹理/atlas 引用等）。
- `source/tile_cache.js`：瓦片缓存策略（LRU/过期/保留等，具体逻辑见实现）。
- `source/tile_id.js`：瓦片 ID（overscaled/canonical）与相关运算。
- `source/tile_bounds.js`：瓦片边界工具。

Worker 协议与实现：

- `source/worker.js`：worker 侧入口，注册 worker source，处理 `loadTile/reloadTile/abortTile/removeTile` 等消息。
- `source/worker_source.js`：worker source 接口与协议类型定义。
- `source/vector_tile_worker_source.js` / `source/geojson_worker_source.js` / `source/raster_dem_tile_worker_source.js`：
  - 在 worker 中解析瓦片数据、生成 buckets、准备符号布局等。
- `source/worker_tile.js`：worker 侧 Tile 数据结构/解析结果封装（与主线程 Tile 协作）。

要素查询：

- `source/query_features.js`：`queryRenderedFeatures` / `querySourceFeatures` 等逻辑核心。

RTL（从右到左）文字插件：

- `source/rtl_text_plugin.js`：RTL 插件加载、状态管理与 worker 注册。

---

### 3.5 `data/`：Buckets、Attributes、FeatureIndex（“从瓦片到 WebGL buffer”）

这里是“把 vector tile feature 变成 GPU 可画的数据结构”的核心模块。

- `data/bucket.js`：Bucket 接口定义 + 反序列化逻辑（worker → 主线程）。
- `data/bucket/*_bucket.js`：按图层类型实现 bucket
  - `fill_bucket.js`、`line_bucket.js`、`circle_bucket.js`、`symbol_bucket.js`、`fill_extrusion_bucket.js` 等。
- `data/array_types.js`：所有 struct array/typed array 的定义（顶点、索引、碰撞盒等）。
- `data/program_configuration.js`：与数据驱动样式相关的 attribute 组织/更新（配合 shader pragmas）。
- `data/feature_index.js`：用于要素查询（屏幕点选/框选）的索引结构。
- `data/dem_data.js`：DEM 高程数据结构（hillshade/terrain 相关）。
- `data/segment.js`：分段（segment）管理，控制单个 draw call 的 buffer 范围等。

如果你想改“某类 layer 的几何如何被 GPU 绘制”，通常落点是：对应的 `*_bucket.js` + 相关 attributes + shader。

---

### 3.6 `symbol/`：符号（文字/图标）布局、碰撞与跨瓦片一致性

符号系统往往是 GL 地图里最复杂的一块：需要兼顾样式表达式、投影变形、避让、淡入淡出、跨瓦片稳定性等。

主要文件：

- `symbol/symbol_layout.js`：符号布局（anchor、offset、writing-mode 等与样式相关的布局计算）。
- `symbol/shaping.js`：文本 shaping（断行、字形组合、对齐、writing-mode 等）。
- `symbol/get_anchors.js` / `symbol/clip_line.js` / `symbol/mergelines.js`：沿线标注、锚点提取与几何处理。
- `symbol/collision_index.js` / `symbol/collision_feature.js` / `symbol/grid_index.js`：
  - 碰撞检测的数据结构与加速网格。
- `symbol/placement.js`：一次 placement（放置）过程的核心
  - 计算 text/icon 是否可放置、决定淡入淡出；
  - 维护上一帧状态实现平滑过渡。
- `symbol/cross_tile_symbol_index.js`：跨瓦片符号索引（保证符号在瓦片切换时稳定）。
- `symbol/projection.js`：符号投影与矩阵计算（随 pitch/rotate 变化）。

改 label 避让/淡入淡出/稳定性通常从 `symbol/placement.js` 与 `symbol/collision_index.js` 入手。

---

### 3.7 `render/`：Painter、draw_*、program/atlas/texture

渲染模块将“已准备好的 buckets + 样式参数”转成 WebGL draw calls。

核心：

- `render/painter.js`：渲染调度中心
  - 管理 render passes（如 opaque/translucent/offscreen）。
  - 负责状态切换（depth/stencil/color/cull）、program 选择与 uniform/attribute 绑定。
  - 调用 `render/draw_*.js` 完成各 layer 类型绘制。
- `render/draw_*.js`：按 layer 类型绘制逻辑
  - `draw_fill.js`、`draw_line.js`、`draw_symbol.js`、`draw_raster.js`、`draw_hillshade.js`、`draw_fill_extrusion.js` 等。
- `render/program.js` + `render/program/*_program.js`：
  - program 的编译/缓存/切换；
  - 不同图层类型对应不同 program 与 uniforms。
- `render/texture.js` / `render/vertex_array_object.js` / `render/uniform_binding.js`：
  - 纹理封装、VAO 管理、uniform 绑定抽象。

资源与 atlas：

- `render/image_manager.js`：sprite/icon/pattern 图像管理与 pattern atlas 构建。
- `render/glyph_manager.js`：glyph 获取、缓存（含本地 ideograph TinySDF 生成）与回传。
- `render/image_atlas.js` / `render/glyph_atlas.js` / `render/line_atlas.js`：各类 atlas 的构建与维护。

调试绘制：

- `render/draw_debug.js`、`render/draw_collision_debug.js`：tile 边界、碰撞盒等调试图层。

---

### 3.8 `gl/`：WebGL 上下文与状态对象

为了减少“直接操作 WebGL API 的状态爆炸”，这里做了抽象封装：

- `gl/context.js`：WebGLContext 包装，集中管理 state/cache，提供统一的创建/绑定接口。
- `gl/depth_mode.js` / `gl/stencil_mode.js` / `gl/color_mode.js` / `gl/cull_face_mode.js`：各类渲染状态对象。
- `gl/vertex_buffer.js` / `gl/index_buffer.js` / `gl/framebuffer.js`：buffer 与 framebuffer 封装。
- `gl/value.js` / `gl/types.js`：WebGL 类型与 uniform 值绑定相关的工具。

---

### 3.9 `shaders/`：GLSL 与 pragma 机制

- `shaders/*.glsl`：各图层类型的 vertex/fragment shader。
- `shaders/README.md`：shader pragma 约定（`#pragma mapbox: define|initialize ...`），用于在编译阶段根据“uniform/attribute/zoom 插值”等场景自动生成代码。
- `shaders/index.js` / `shaders/shaders.js`：对 shader 的组织与导出（供 `render/painter.js`/`render/program` 使用）。

当你改某种绘制效果（如 line gradient、fill pattern）通常需要同时改：

1) 对应 `render/draw_*.js` 的绘制逻辑  
2) `render/program/*` 的 program 绑定与 uniform/attribute  
3) `shaders/*` 的 GLSL 实现  

---

### 3.10 `util/`：通用工具（请求、事件、worker、缓存、性能）

常见子类目：

- 事件/基础设施：`util/evented.js`、`util/task_queue.js`、`util/throttle.js`、`util/throttled_invoker.js`
- 请求/网络：`util/ajax.js`、`util/mapbox.js`（Mapbox URL 规范化、token、SKU 等）、`util/resolve_tokens.js`
- Worker 通信：`util/dispatcher.js`、`util/actor.js`、`util/web_worker.js`、`util/web_worker_transfer.js`、`util/worker_pool.js`、`util/global_worker_pool.js`
- 缓存：`util/tile_request_cache.js`（含 `clearTileCache`）、以及若干资源缓存策略
- 性能：`util/performance.js`（performance markers/metrics）
- 环境/DOM 适配：`util/window.js`、`util/browser.js`、`util/dom.js`、`util/offscreen_canvas_supported.js`
- 几何/算法杂项：`util/classify_rings.js`、`util/find_pole_of_inaccessibility.js`、`util/intersection_tests.js` 等

---

### 3.11 `style-spec/`：样式规范（v8）与工具集（独立 npm 包）

这是一个“可独立发布”的 style-spec 工具包，既被运行时引用（用于校验/解析/表达式），也提供 CLI：

- 参考规范：`style-spec/reference/v8.json`、`style-spec/reference/latest.js`
- 校验：`style-spec/validate/*`、`style-spec/validate_style.js`
- diff/迁移/格式化：`style-spec/diff.js`、`style-spec/migrate/*`、`style-spec/format.js`
- 表达式与过滤器：`style-spec/expression/*`、`style-spec/feature_filter/*`
- CLI：`style-spec/bin/*`（例如 `gl-style-validate` / `gl-style-migrate` / `gl-style-format` / `gl-style-composite`）

如果你关注“样式 JSON 的合法性、表达式语义、版本迁移”，从 `style-spec/README.md` 与 `style-spec/types.js` 开始会更快。

---

### 3.12 `css/`：默认样式与 SVG

- `css/mapbox-gl.css`：默认控件、popup、marker 等 DOM 元素样式。
- `css/svg/`：控件图标等资源。

---

### 3.13 `types/`：Flow 类型定义

用于在源码层面约束 callback/cancelable/transferable/window 等通用类型，辅助静态检查与跨文件约定。

---

## 4. 二次开发常用切入点（按需求）

- 需要新增/改交互：
  - 入口：`ui/handler_manager.js`、`ui/handler/*`
- 需要新增控件或改 UI：
  - 入口：`ui/control/*`、`css/mapbox-gl.css`
- 需要新增自定义渲染层（WebGL 自绘）：
  - 入口：`style/style_layer/custom_style_layer.js`（CustomLayerInterface）
- 需要新增自定义数据源（非内置 source）：
  - 入口：`source/source.js`（Source 接口与注册）、以及 worker 侧 `source/worker.js` 注册 `WorkerSource`
- 需要改瓦片加载/缓存策略：
  - 入口：`source/source_cache.js`、`source/tile_cache.js`、`util/tile_request_cache.js`
- 需要改文字/图标避让或排版：
  - 入口：`symbol/placement.js`、`symbol/collision_index.js`、`symbol/shaping.js`
- 需要改渲染效果或新增 shader 特性：
  - 入口：`render/draw_*.js` + `render/program/*` + `shaders/*`

---

## 5. 推荐的阅读顺序（最快建立全局心智模型）

1. `index.js`：看对外导出有哪些能力
2. `ui/map.js`：Map 如何串起 Style、SourceCache、Painter
3. `style/style.js`：style JSON 如何变成 layers/sources + 更新机制（diff）
4. `source/source_cache.js` + `source/tile.js`：瓦片生命周期与 worker 交互
5. `source/worker.js` + `source/*_worker_source.js`：worker 端如何解析并产出 buckets
6. `render/painter.js` + `render/draw_*.js`：一帧是怎么画出来的
7. `symbol/*`：再深入 label 系统（如果你的业务关心标注）


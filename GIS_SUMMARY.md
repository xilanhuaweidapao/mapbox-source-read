# 本仓库蕴含的 GIS 知识、设计局限与可优化方向

面向目标：读懂并改造 `new-mapbox-gl-v1`（Mapbox GL JS v1 时代的架构风格）时，从 GIS/制图/空间计算的角度梳理“它懂什么”和“它不擅长什么”，并给出可落地的优化切入点与涉及模块。

---

## 1) 仓库包含/体现了哪些 GIS 知识？

这类引擎的“GIS 知识”主要不是传统 GIS 软件那种完整空间分析，而是 **Web 地图渲染** 所必须的：坐标系统、投影、瓦片金字塔、空间索引、符号与标注、以及数据格式与规范。

### 1.1 空间参考与坐标体系（SRS/CRS）

- **地理坐标（经纬度）**
  - `geo/lng_lat.js`：WGS84（EPSG:4326）语义、经纬度范围校验、wrap、距离（Haversine）、按半径扩展 bounds。
- **Web Mercator 投影（EPSG:3857）**
  - `geo/mercator_coordinate.js`：经纬度 ↔ Web Mercator（归一化到 [0,1] 的世界坐标）转换、Mercator scale、将海拔（meters）映射到 mercator z。
  - `geo/transform.js`：把投影坐标进一步映射到屏幕/GL 坐标（矩阵、worldSize、pitch/bearing/fov）。
- **有效纬度范围（Mercator 的极区不可达）**
  - `geo/transform.js`：`maxValidLatitude = 85.051129`（典型 Web Mercator 上限），并在设置中心/边界时 clamp。

你需要理解的 GIS 点：

- EPSG:4326（地理坐标） vs EPSG:3857（投影坐标）的差异与取舍。
- “wrap 世界复制（世界多份渲染）”的经度语义：跨越 ±180° 的处理在 Web 地图里非常常见。

---

### 1.2 瓦片金字塔与切片方案（Tiling / LOD）

仓库完整实现了 Web 地图的 tile pyramid 思想：**按 zoom 层级切片**，按视口加载可视范围内的瓦片，并做 overzoom/underzoom。

- **TileID 体系（canonical / wrapped / overscaled）**
  - `source/tile_id.js`：
    - `CanonicalTileID(z,x,y)`：标准 XYZ 瓦片坐标。
    - `wrap`：世界复制（跨经线）支持。
    - `OverscaledTileID`：支持 overzoom（`overscaledZ >= z`）。
    - URL 模板能力：`{z}/{x}/{y}`、`{quadkey}`、`{bbox-epsg-3857}`、`{prefix}`，并支持 `scheme: tms`。
- **视口覆盖瓦片计算（covering tiles）**
  - `geo/transform.js`：包含基于视锥（Frustum/AABB）的 tile 覆盖选择与 LOD 控制。
- **瓦片生命周期与缓存**
  - `source/source_cache.js`：决定加载/卸载哪些 tiles，维护 tile cache，处理 source 事件与 reload。
  - `source/tile.js`、`source/tile_cache.js`：tile 状态机、过期刷新、bucket 反序列化与 GPU 资源引用。
  - `util/tile_request_cache.js`：请求/缓存相关（并在 `index.js` 暴露 `clearStorage()` 等 API）。

你需要理解的 GIS 点：

- 瓦片体系是“空间索引 + 多尺度表达”的核心：它决定了数据分片、缓存粒度、LOD 策略、以及多数性能行为。
- overzoom/underzoom 的地理含义：数据分辨率与渲染分辨率不一致时，如何“复用”瓦片而不重新请求。

---

### 1.3 数据格式与行业规范（GeoJSON / TileJSON / Vector Tile / Style Spec）

该仓库在“GIS 数据标准”层面覆盖了 Web 地图最关键的几项：

- **GeoJSON（用户态数据输入）**
  - `source/geojson_source.js` + `source/geojson_worker_source.js`：GeoJSON 数据源（worker 侧切片/索引）。
  - `util/vectortile_to_geojson.js`：把 MVT feature 转为 GeoJSON feature 的适配（用于查询/导出等）。
- **TileJSON（瓦片源描述）**
  - `types/tilejson.js`、`source/load_tilejson.js`：tiles/minzoom/maxzoom/bounds/scheme/tileSize/encoding/vector_layers 等字段处理。
- **Vector Tile（MVT）概念与 tile extent**
  - `geo/mercator_coordinate.js` 文档中显式提到 vector tiles。
  - `data/extent.js` + 各类 bucket：以 tile extent（典型 4096/8192）为“几何计算单位”。
- **Mapbox GL Style Spec（v8）**
  - `style-spec/reference/v8.json`、`style-spec/types.js`：style JSON 的结构、各 layer/source 的字段与类型。
  - `style-spec/expression/*`：表达式系统（数据驱动/函数式样式）。
  - `style-spec/validate/*` + `style/validate_style.js`：样式校验与错误模型。
  - `style-spec/diff.js`：style 差量更新（smart setStyle 的基础）。

你需要理解的 GIS 点：

- “数据规范”决定了 GIS 引擎能接什么、怎么解释、如何与生态工具兼容（Studio、Tilesets、Style 编辑器等）。

---

### 1.4 空间几何算法与空间判断（空间计算能力）

虽然不是完整 GIS 分析库，但引擎为了渲染与交互实现了不少空间算法：

- **距离与包络**
  - `geo/lng_lat.js`：Haversine distance、bounds 扩展（按米）。
  - `geo/lng_lat_bounds.js`：bounds 包含/扩展/交并等（用于 fitBounds、视口约束等）。
- **多边形 ring 分类（外环/洞）**
  - `util/classify_rings.js`：根据 signed area 区分外环与 holes，并限制 maxRings（为三角剖分性能服务）。
- **点线面相交/包含测试（用于查询、碰撞等）**
  - `util/intersection_tests.js`：point-in-polygon、线段相交、polygon/box 相交、buffered line 等。
- **“不可达极点”（polylabel）用于面标注定位**
  - `util/find_pole_of_inaccessibility.js`：Pole of Inaccessibility 近似求解（面内最“居中”的标签点）。
- **符号沿线/裁剪/锚点提取**
  - `symbol/clip_line.js`、`symbol/get_anchors.js`、`symbol/mergelines.js`：为沿线标注与符号布局服务的几何处理。

你需要理解的 GIS 点：

- 这里的算法通常是在“tile 坐标系/屏幕坐标系”里做的：更偏渲染工程，不等同于严格的大地测量/球面几何。

---

### 1.5 制图表达：图层模型、样式表达式、过渡（Cartography）

仓库实现了较完整的“Web 制图语义”：

- **Layer 类型与绘制语义**
  - `style/style_layer/*`：background、fill、line、circle、symbol、raster、hillshade、fill-extrusion、custom 等。
- **表达式/过滤器（数据驱动样式）**
  - `style-spec/expression/*`：表达式求值、类型系统、image/resolved_image 等。
  - `style-spec/feature_filter/*`：feature filter 解析与执行。
  - `data/program_configuration.js`：把表达式/函数结果编码为 attribute，供 shader 使用（避免每帧逐 feature 求值）。
- **样式过渡**
  - `style/properties.js`、`style/evaluation_parameters.js`：transition、zoom 相关评估参数。
- **差量更新**
  - `style/style.js` + `style-spec/diff.js`：smart setStyle（避免全量销毁重建）。

你需要理解的 GIS 点：

- “制图表达”是 GIS 的一个子领域：同一份空间数据，如何映射到视觉变量（颜色、宽度、透明度、符号、标签规则）。

---

### 1.6 标注系统：文字/图标、碰撞检测与跨瓦片一致性（Labeling）

标注是 Web 地图引擎最复杂的 GIS/制图模块之一，仓库提供了较完整链路：

- **文本 shaping / writing mode**
  - `symbol/shaping.js`、`symbol/transform_text.js`：文本排版、换行、对齐、writing mode。
- **碰撞检测**
  - `symbol/collision_index.js`、`symbol/collision_feature.js`、`symbol/grid_index.js`：空间占位与快速查询结构。
- **placement 与淡入淡出**
  - `symbol/placement.js`：放置决策、opacity 状态机、稳定性处理。
- **跨瓦片稳定**
  - `symbol/cross_tile_symbol_index.js`：跨瓦片索引，减少 tile 切换导致的 label 抖动。
- **RTL（从右到左）文字插件**
  - `source/rtl_text_plugin.js`：RTL 插件的加载与 worker 注册。

你需要理解的 GIS 点：

- 标注规则与避让属于“地图制图学”核心难点：不仅要对，还要稳定、平滑、性能可控。

---

### 1.7 栅格/地形相关能力（Raster/DEM/Hillshade）

仓库支持基础栅格与 DEM：

- **Raster tiles**
  - `source/raster_tile_source.js` + `render/draw_raster.js` + `shaders/raster*`
- **DEM tiles + hillshade**
  - `source/raster_dem_tile_source.js`、`source/raster_dem_tile_worker_source.js`
  - `data/dem_data.js`
  - `render/draw_hillshade.js`、`shaders/hillshade*`

你需要理解的 GIS 点：

- DEM/Hillshade 是典型 GIS 栅格派生渲染：从高程栅格计算坡度/阴影，再以视觉方式表达地形。

---

### 1.8 交互与空间查询（Query & Feature State）

- **查询渲染要素**
  - `source/query_features.js`：`queryRenderedFeatures/querySourceFeatures/queryRenderedSymbols` 的主逻辑。
  - `data/feature_index.js`：为查询建立的索引（屏幕点选/框选等）。
- **Feature state（交互态）**
  - `source/source_state.js`：feature-state 的存储与合并（用于 hover/selected 等交互样式）。

你需要理解的 GIS 点：

- 交互查询本质是“空间索引 + 坐标系转换 + 语义过滤（layer/filter）”。

---

## 2) 设计上的局限性（GIS 视角 + 工程视角）

下面的“局限性”既包含 GIS 语义层面的，也包含渲染/架构层面的。很多限制并不是缺陷，而是 Web 地图引擎在性能与通用性之间的必然取舍。

### 2.1 投影/地理语义局限

- **固定 Web Mercator（EPSG:3857）**
  - 表现：中心纬度会被 clamp 到 ±85.051129（见 `geo/transform.js`），极区无法表现；高纬度严重形变。
  - 影响：无法支持等面积、等距离、极区投影、国家测绘坐标系等；对“严肃测量/分析”不友好。
- **几何通常在投影平面/瓦片坐标中处理**
  - 表现：线段、缓冲、相交等多在 tile/screen 空间完成（如 `util/intersection_tests.js`）。
  - 影响：长距离/跨洲线的“真实大圆”与面积/距离计算不精确；更像“制图渲染引擎”，不是测量 GIS。
- **跨反经线/多世界复制是一种渲染策略**
  - 表现：`renderWorldCopies`（`geo/transform.js`, `ui/map.js`）会在经度方向复制世界。
  - 影响：对某些跨界 feature 的语义（例如跨世界 copy 的查询/编辑）容易产生“同一要素多份”的概念复杂度。

### 2.2 数据与规模局限（tile 化带来的约束）

- **高度依赖 tile pyramid**
  - 优点：极强的可扩展性与网络/缓存友好。
  - 局限：对“超大单体几何”“非切片数据”“强实时更新的大量要素”不天然友好，需要额外分片/增量策略。
- **overzoom/underzoom 的质量取决于上游数据**
  - 如果上游矢量瓦片没有为不同 zoom 做适当综合（generalization），overzoom 会放大几何锯齿与噪声。
- **查询/编辑等 GIS 操作往往只能在当前加载数据上进行**
  - 表现：`querySourceFeatures` 只遍历可渲染 tiles（`source/query_features.js`）。
  - 影响：无法像传统 GIS 一样对“全量数据集”做全局查询，除非引入后端/离线索引。

### 2.3 渲染与平台局限（WebGL1/浏览器约束）

- **WebGL1 约束**
  - 表现：依赖扩展（`OES_vertex_array_object`、half-float、timer query 等，见 `gl/context.js`）。
  - 影响：在不支持扩展/性能弱的设备上要做大量降级；也限制了更现代的渲染技巧（MRT、UBO、实例化等）。
- **精度与抖动问题（高 zoom + pitch 更明显）**
  - 根因：shader 里主要是 float32；世界坐标尺度巨大时精度不足（虽有 tile-local 的缓解，但并非所有路径都完美）。
- **CPU 侧重（尤其是 symbol）**
  - 表现：worker 做了大量工作，但 label/collision 仍是高 CPU 组件（`symbol/*`）。
  - 影响：数据密集时易出现帧率下降、布局延迟、GC 压力。

### 2.4 生态与耦合局限

- **Mapbox API 访问与 token/URL 规范化耦合**
  - `util/mapbox.js` 包含明确的 Mapbox API 使用约束与 SKU/token 逻辑。
  - 影响：如果目标是完全脱离 Mapbox 生态或做“多供应商后端”，需要清晰梳理 URL 规范化与鉴权逻辑的替代方案。

---

## 3) 可以从哪些方面优化？（按优先级与投入成本）

下面给出一组“优化方向库”。你可以根据目标（性能/可维护性/功能扩展/GIS 语义增强）选取落地。

> 建议先做“度量体系”：在你关心的设备与数据上建立基准（FPS、CPU time、GPU time、tile 数、内存、网络），再动刀。

### 3.1 低风险/高收益（优先做）

1) **请求调度与缓存策略优化（网络/IO）**

- 目标：减少无效请求、减少抖动加载、提升弱网体验。
- 可做：
  - 更激进的取消过期 tile 请求（快速移动/缩放时）。
  - 依据视口/优先级（中心优先、低 zoom 先）做队列调度。
  - 针对 raster 与 vector 分别设置并发与重试策略。
- 相关模块：`util/ajax.js`、`util/tile_request_cache.js`、`source/source_cache.js`、`source/tile.js`。

2) **减少 GPU 状态切换与 program/texture 绑定次数（渲染性能）**

- 目标：降低 draw call 开销、减少 state churn。
- 可做：
  - 对 draw 顺序做更明确的分组（同 program/同 atlas/同 blend 状态）。
  - 避免频繁触发 atlas 重建与整图上传。
- 相关模块：`render/painter.js`、`render/program/*`、`render/image_manager.js`、`gl/value.js`。

3) **降低 GC 压力：对象池/复用 typed arrays（CPU/内存）**

- 目标：减少每帧临时对象/数组创建，避免卡顿。
- 可做：
  - bucket/feature/query 过程中的临时数组复用（尤其 symbol 与 query）。
  - 降低 JSON/对象拷贝，尽量传 typed arrays + 结构化元数据。
- 相关模块：`data/*`、`symbol/*`、`source/query_features.js`、`util/*`。

4) **Worker 任务边界再切分（让主线程更轻）**

- 目标：主线程更专注于渲染与交互响应。
- 可做：
  - 将更多“与渲染无关但重”的计算移动到 worker（例如部分查询索引构建、表达式预计算）。
  - 合并/批量化 worker 往返消息，降低 postMessage 开销。
- 相关模块：`util/dispatcher.js`、`util/actor.js`、`source/worker.js`、`source/*_worker_source.js`、`util/web_worker_transfer.js`。

### 3.2 中投入（结构性优化）

1) **更强的“增量更新”能力（减少全量重算）**

- 目标：style 改动/数据局部更新时，不要触发全量重建 buckets 与 placement。
- 可做：
  - 更细粒度识别“哪些 paint/layout 变化会影响几何/bucket/placement”。
  - GeoJSONSource 的局部更新（diff/patch）而不是 setData 全量替换（需要上层 API 配合）。
- 相关模块：`style/style.js`、`style-spec/diff.js`、`source/geojson_source.js`、`symbol/placement.js`。

2) **更完善的纹理资源体系（atlas/分层/压缩）**

- 目标：降低纹理上传成本与显存占用，提升倾斜视角的清晰度。
- 可做：
  - 多 atlas 分层（按用途/大小分组，减少重排与整图更新）。
  - 更智能的 eviction（LRU）与图集碎片整理策略。
  - 引入压缩纹理（受 WebGL1 支持限制，需要根据设备做多套资源）。
- 相关模块：`render/image_manager.js`、`render/image_atlas.js`、`render/texture.js`、`gl/context.js`。

3) **Symbol 性能优化（最“吃 CPU”的地方）**

- 目标：大幅提升点密集/文本密集场景的帧率与稳定性。
- 可做：
  - 碰撞网格（grid）参数与更新策略优化（减少无效检测）。
  - placement 增量化与节流（分帧 placement、暂停/恢复机制更细粒度）。
  - 预过滤：在进入 shaping/placement 前先用粗略规则淘汰不可见或极小概率显示的候选。
- 相关模块：`symbol/placement.js`、`symbol/collision_index.js`、`symbol/grid_index.js`、`style/pauseable_placement.js`。

### 3.3 高投入（会改变架构/兼容性）

1) **升级到 WebGL2（或提供 WebGL2 路径）**

- 收益：原生 VAO、更好的纹理格式/采样能力、更多扩展更稳定；为实例化、UBO 等现代优化打开空间。
- 风险：兼容性、shader 版本差异、渲染路径需要双维护或迁移成本高。
- 相关模块：`gl/*`、`render/*`、`shaders/*`（需要系统性改造）。

2) **OffscreenCanvas + Worker 渲染（主线程极致减负）**

- 收益：主线程更流畅，交互更稳定；CPU 密集型布局与渲染可集中在 worker。
- 风险：浏览器支持差异、调试复杂度上升；需要重构渲染上下文生命周期与资源管理。

3) **投影插件化/多投影支持（GIS 能力增强）**

- 收益：支持非 Mercator 投影、极区/本地坐标系，GIS 语义更强。
- 风险：几乎牵动所有“坐标→瓦片→矩阵→shader”的链路；现有 tile pyramid 与数据源也往往默认 Mercator。
- 涉及模块：`geo/*`、`source/tile_id.js`、`source/source_cache.js`、`render/painter.js`、`symbol/projection.js`、`style-spec`（部分语义可能也受影响）。

4) **WASM/ SIMD 加速热点（解析/三角剖分/碰撞）**

- 收益：CPU 热点显著降低，尤其是 vector tile decode、几何处理、symbol 碰撞。
- 风险：工程复杂度提升、调试链路更长、跨平台构建与发布成本上升。

---

## 4) 一份可执行的“优化选型”表（建议先从这里挑）

| 优化目标 | 推荐切入点 | 预期收益 | 风险/成本 | 相关模块 |
|---|---|---:|---:|---|
| 缩放/移动时加载更稳 | 请求取消 + 优先级队列 | 高 | 中 | `source/source_cache.js`, `util/ajax.js` |
| 降低 draw call 开销 | program/texture 分组 | 中-高 | 中 | `render/painter.js`, `render/program/*` |
| 减少卡顿（GC） | 对象池 + typed array 复用 | 中 | 中 | `symbol/*`, `data/*`, `source/query_features.js` |
| label 更快更稳 | placement 增量化/节流 | 高 | 高 | `symbol/placement.js`, `style/pauseable_placement.js` |
| 减少纹理抖动/更新成本 | atlas 分层 + texSubImage 策略 | 中 | 中-高 | `render/image_manager.js`, `render/texture.js` |
| 更现代 GPU 能力 | WebGL2 路径 | 中-高 | 很高 | `gl/*`, `render/*`, `shaders/*` |
| 支持非 Mercator | 投影插件化 | 业务驱动 | 很高 | `geo/*`, `source/*`, `symbol/*` |

---

## 5) 结论（如何用 GIS 视角读这个仓库）

- 把它视为“**制图渲染引擎 + 空间数据流系统**”：它实现了 Web 地图最核心的一组 GIS 能力（坐标/投影/瓦片/标注/查询/样式规范）。
- 它的主要局限来自三点：**固定 Mercator**、**WebGL1 能力上限**、**tile 化架构的取舍**。
- 优化应从“度量→瓶颈定位→最小可验证改动”入手：
  1) 请求与缓存  
  2) 渲染状态与纹理  
  3) worker 化与增量化  
  4) 最后才是 WebGL2/多投影/WASM 这类大手术


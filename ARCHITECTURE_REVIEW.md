# 仓库架构设计优缺点总结（new-mapbox-gl-v1）

> 视角：工程架构与渲染引擎设计（Mapbox GL JS v1 风格）。  
> 目标：帮助你快速判断“哪些设计值得沿用/扩展、哪些地方会成为维护与演进的阻力”。

---

## 1) 架构概览（一句话）

这是一个典型的 **tile-driven WebGL 地图渲染引擎**：主线程负责交互/渲染调度，worker 负责瓦片解析与 bucket 构建；`Style` 用样式规范驱动 `SourceCache` 产出可渲染 tiles，`Painter` 将 buckets 按 pass 组织成高效 draw calls。

主要模块边界（按目录）：

- `ui/`：Map API、交互、控件、Marker/Popup
- `geo/`：坐标与投影、Transform（相机/矩阵）
- `style/`：Style 管理、Layer 类型、属性与过渡、placement 调度
- `source/`：Source 类型、tile 生命周期与缓存、worker 协议、查询
- `data/`：bucket/attribute/typed arrays（几何与样式属性编码）
- `render/`：Painter、draw_*、program/atlas/texture 管理
- `gl/`：WebGL 状态/Buffer/Framebuffer 抽象与缓存
- `symbol/`：文字/图标排版、碰撞、跨瓦片稳定
- `style-spec/`：style spec（v8）与 validate/diff/migrate 工具（可独立包）

---

## 2) 设计优点（为什么这套架构“能打”）

### 2.1 模块拆分贴合问题域，边界总体清晰

- UI（`ui/`）/样式（`style/`）/数据源（`source/`）/渲染（`render/`+`gl/`）/符号（`symbol/`）各自成体系，基本符合地图引擎的天然分层。
- `style-spec/` 独立为工具包，形成“运行时依赖 + CLI 工具”双用途，方便复用与测试。

### 2.2 主线程/Worker 分工合理：把 CPU 重活挪走

- `util/dispatcher.js` + `source/worker.js` 的消息体系把瓦片解析、bucket 构建等重计算迁到 worker，减轻主线程卡顿风险。
- transfer/序列化体系（`util/web_worker_transfer.js`）围绕“typed array 结果”传输，适配高吞吐数据流。

### 2.3 Tile-driven 数据流：天然可扩展、缓存友好

- `source/source_cache.js` + `source/tile.js` + `source/tile_cache.js` 围绕 tile 生命周期组织数据与缓存，契合地图渲染“视口驱动加载”的本质。
- overzoom/underzoom、wrap/world copies 等机制使地图浏览体验更平滑（`geo/transform.js`, `source/tile_id.js`）。

### 2.4 渲染管线工程化：状态缓存、pass 划分、program 管理

- `gl/value.js` 把 WebGL 状态变更缓存起来，减少重复 set（典型高收益优化点）。
- `render/painter.js` 作为“渲染调度中心”，将不同 layer 类型绘制拆到 `render/draw_*.js`，降低单文件复杂度。
- VAO 支持与降级（`render/vertex_array_object.js` + `gl/context.js`）提高 draw call 密度与兼容性。

### 2.5 数据驱动样式与 shader pragma：把复杂度搬到编译期/构建期

- `style-spec/expression/*` + `data/program_configuration.js` 将数据驱动样式变成 GPU 可消费的 attributes/uniforms，避免每帧逐 feature 计算。
- `shaders/README.md` 定义 pragma 机制，统一管理“uniform vs attribute vs zoom 插值”等变体，降低 shader 分叉的维护成本。

### 2.6 可扩展点明确，支持二次开发

- 自定义图层：`style/style_layer/custom_style_layer.js`（CustomLayerInterface）
- 自定义 source/worker source：`source/source.js` + `source/worker.js` 的注册/扩展思路
- RTL 插件：`source/rtl_text_plugin.js` 的插件化加载与 worker 注册

---

## 3) 设计缺点/代价（长期维护与演进的阻力）

### 3.1 WebGL1 时代包袱：能力上限与“扩展碎片化”

- 依赖 `OES_vertex_array_object`、half-float、timer query、anisotropic 等扩展（`gl/context.js`），不同设备/浏览器支持不一致，导致路径分叉与测试成本上升。
- 很多现代 GPU 优化点（WebGL2：UBO、实例化、更多纹理格式/MRT 等）无法直接利用，想升级通常是“牵一发动全身”。

### 3.2 模块间存在“强耦合链路”，理解成本高

- `Style`、`SourceCache`、`Tile`、`Painter`、`Symbol placement` 之间通过事件与共享对象交织，虽然分模块，但跨模块联动很密集（读代码需要建立完整心智模型）。
- 某些类承担多重职责（例如 `render/image_manager.js` 文件内就写明“职责混杂，未来应拆”），使得局部改动可能触发连锁反应。

### 3.3 全局状态与隐式约束较多，易出现“改一处崩一片”

- 全局 worker 池、缓存、config 等（`util/global_worker_pool.js`, `util/tile_request_cache.js`, `util/config.js`）让资源生命周期更难被业务方精确控制。
- 部分关键常量/假设较强（例如 `geo/transform.js` 的 `tileSize = 512`、固定 Web Mercator），对非典型需求扩展不友好。

### 3.4 标注系统复杂且 CPU 重，性能与稳定性优化难

- `symbol/*` 的碰撞、排版、跨瓦片稳定与淡入淡出本身就是高复杂度问题；在数据密集场景下常成为瓶颈，需要大量工程手段（增量化、分帧、裁剪、预过滤）才能稳住。

### 3.5 Mapbox 生态耦合：供应商中立性不足（视目标而定）

- `util/mapbox.js` 负责 Mapbox URL 规范化、token/SKU 等逻辑；如果目标是纯自建栅格/矢量服务或多供应商后端，会引入替换/隔离成本。

### 3.6 技术栈时代性：Flow/旧式组织方式的团队成本

- Flow 类型体系对熟悉 TS 的团队有学习与迁移成本；IDE/生态工具链也更偏向 TS。
- `util/` 的“工具大杂烩”模式容易变成长期债务：发现能力困难、边界不清晰、复用/测试困难。

---

## 4) 适用场景与不适用场景（架构取舍的结果）

适用：

- 典型 Web 地图：瓦片底图 + 矢量样式渲染 + 标注 + 交互查询
- 强性能诉求：需要高并发渲染、平滑缩放/旋转/pitch、弱网可用
- 需要 custom layer/source 扩展能力的地图产品

不适用/成本高：

- 需要多投影/本地坐标系/严肃测量 GIS 的场景（投影与地理语义限制）
- 需要完整“全量数据集”空间分析/编辑（引擎偏渲染与视口范围数据）
- 强依赖 WebGL2/现代渲染特性或希望快速用到最新 GPU 能力的场景


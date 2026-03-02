# 40 段“最难读”的核心代码导读（new-mapbox-gl-v1）

> 目的：把仓库里最关键、最容易卡住的 40 段源码（前 20 + 追加 20；以“函数/类/核心逻辑块”为粒度）抽出来，说明它在解决什么问题、为什么难、阅读时要抓住哪些变量/边界条件，并给出对照的最小化学习示例入口（`learning/`）。

---

## 通用读法（强烈建议先看）

1. **先统一坐标/空间术语**（否则会越读越乱）  
   - **Tile 空间**：单瓦片内部的局部坐标（常见范围 `0..EXTENT`）。  
   - **Mercator 归一化空间**：`x/y` 在 `0..1`（跨世界复制则可能出现 `x<0` 或 `x>1`）。  
   - **worldSize 像素空间**：`mercator * worldSize`（`worldSize = tileSize * 2^zoom`）。  
   - **屏幕像素**：DOM/canvas 的像素坐标。  
   - **NDC/裁剪空间**：`[-1..1]`，投影矩阵输出所在空间。  
2. **先找输入/输出，再看中间过程**：参数、返回值、读写的字段缓存（`*_cache`、`dirty`、`fadeEndTime` 等）。  
3. **用调用链约束理解范围**：`ui/map -> style/style -> source/source_cache -> render/painter -> draw_* -> gl/*`。  
4. **看到“workaround/兼容性”注释先尊重它**：很多代码看似“多余”，其实是在绕 WebGL/浏览器的历史坑。  
5. **Worker 边界是关键设计点**：跨线程传输必须可序列化；尽量 transfer `ArrayBuffer`，避免深拷贝。

---

## 01 `geo/transform.js` · `coveringTiles()`

- **解决的问题**：根据当前相机（投影矩阵/视锥体/地图中心/倾斜）决定“需要哪些瓦片”以及“每块瓦片用哪个 LOD（zoom）”。  
- **为什么难**：同时揉在一起了**视锥裁剪**、**四叉树遍历**、**LOD 经验阈值**、**世界复制（wrap）**、以及“倾斜/边距”对 LOD 的特殊规则。  
- **核心流程（读代码时按这个顺序对齐变量）**：  
  1) 通过 `coveringZoomLevel()` 得到目标 `z`（可能再被 `minzoom/maxzoom` clamp）。  
  2) 用 `invProjMatrix` 构造 `Frustum`，并在 `z` 下把中心点换算到“tile 单位空间”。  
  3) DFS 遍历四叉树：节点是一个 tile AABB（平面 `z=0`），对每个节点做 `aabb.intersects(frustum)`。  
  4) 用“距离启发式”决定是否继续细分（`distToSplit`/`radiusOfMaxLvlLodInTiles`），近处强制细分到 `maxZoom`，远处允许停在更粗层级。  
  5) 结果按 `distanceSq` 排序，优先加载离中心更近的 tile。  
- **关键变量/坑点**：  
  - `minZoom` 在 `pitch<=60` 且 `edgeInsets.top≈0` 时会被提升到 `z`：避免低倾斜时混入低 LOD。  
  - `overscaledZ` 受 `reparseOverscaled` 影响：决定“渲染/解析用的 overscaledZ”与“几何 LOD”的分离。  
  - `this._renderWorldCopies` 时会把根节点扩展到左右多份 wrap（这里硬编码了 3 份）。  
- **对照示例**：`learning/04-transform`、`learning/05-tiles-raster`。

## 02 `geo/transform.js` · `calculatePosMatrix()`

- **解决的问题**：为一个 tile 计算 `posMatrix`：把 tile 内局部坐标（`0..EXTENT`）映射到当前相机下的裁剪空间，供所有绘制路径复用。  
- **为什么难**：矩阵里混合了 `worldSize/zoomScale`、wrap 平移、`EXTENT` 归一化，以及“aligned”投影（用于像素对齐/抗抖动）。  
- **核心流程**：  
  - 以 `unwrappedTileID.key` 做缓存（区分 `aligned` 与非 `aligned` 两套 cache）。  
  - 计算 `scale = worldSize / 2^canonical.z`，并把 `wrap` 折算到 `unwrappedX = x + 2^z * wrap`。  
  - `translate(unwrappedX*scale, y*scale)` 后再 `scale(scale/EXTENT)`，最后乘上 `projMatrix`/`alignedProjMatrix`。  
  - 用 `Float64Array` 做中间矩阵，再转成 `Float32Array` 输出（精度 vs. GPU 输入的折中）。  
- **常见坑**：wrap/overscaled/canonical 三种 zoom 的含义不要混；`key` 缓存是性能关键。  
- **对照示例**：`learning/04-transform`、`learning/09-stencil-clip`（后者会用到 `posMatrix` 做裁剪遮罩）。

## 03 `geo/transform.js` · `pointCoordinate()`

- **解决的问题**：把屏幕像素点反投影到地图平面（`z=0`）得到 `MercatorCoordinate`，用于 hit-test、框选查询等。  
- **为什么难**：反投影不是“直接求逆”就结束：屏幕点对应的是一条 3D 射线，需要与 `z=0` 平面求交。  
- **核心流程**：  
  - 构造两个同屏幕点但不同深度的齐次坐标：`[x,y,0,1]` 和 `[x,y,1,1]`。  
  - 用 `pixelMatrixInverse` 变换到世界空间，做齐次除法得到两点 `(x0,y0,z0)`、`(x1,y1,z1)`。  
  - 线性插值求 `z=0` 处的 `t`，再插值得到交点 `(x,y)`，最后除以 `worldSize` 回到 `0..1` 的 mercator。  
- **常见坑**：`z0===z1` 时 t 处理；倾斜很大时射线与平面相交的数值稳定性。  
- **对照示例**：`learning/04-transform`。

## 04 `source/source_cache.js` · `update(transform)`

- **解决的问题**：瓦片生命周期总控：决定“该加载哪些 tile、保留哪些、卸载哪些”，并处理 raster 的交叉淡入淡出与父子替代。  
- **为什么难**：它把**可视集合计算**、**tile pyramid 退化策略**、**raster fade**、**symbol fade hold**、**wrap jump**等都耦合在一次更新里。  
- **核心流程**：  
  1) 计算 `idealTileIDs`：来自 `transform.coveringTiles()`，或 source 自带 `tileID` 的特殊路径。  
  2) 计算 overzoom/underzoom 范围（`maxOverzooming/maxUnderzooming`），并调用 `_updateRetainedTiles()` 得到 `retain` 集合。  
  3) raster 类型：为仍在 fade 的 tile 找到 loaded parent/children 做 cross-fade，并把“只用于 fading 的 parent”标记为 `_coveredTiles`。  
  4) 对不再需要的 tile：  
     - 有 symbol buckets 且未 hold 的：`setHoldDuration(fadeDuration)`（让符号慢慢淡出）。  
     - 否则直接 `_removeTile()`。  
  5) 更新 `_loadedParentTiles` 缓存（加速后续 parent 查找）。  
- **关键变量/坑点**：  
  - `tile.fadeEndTime`、`tile.holdingForFade()`、`tile.symbolFadeFinished()` 共同决定“能不能删”。  
  - `retain` 里既包含 ideal tiles，也可能包含 parent/child（用于遮盖或 fading）。  
- **对照示例**：`learning/05-tiles-raster`、`learning/06-style-min`。

## 05 `source/source_cache.js` · `tilesIn()`

- **解决的问题**：为 `queryRenderedFeatures`/点选/框选找到“哪些 tile 覆盖了查询几何”，并把查询几何变换到 tile 空间。  
- **为什么难**：要同时处理**相机倾斜（3D layer）导致的查询几何变化**、tile 的 overscale、以及每个 tile 的 `queryPadding`。  
- **核心流程**：  
  - 先决定使用 `pointQueryGeometry` 还是 `getCameraQueryGeometry()`（有 3D layer 时）。  
  - 用 `transform.pointCoordinate()` 把屏幕点转成 mercator，得到 `queryGeometry` 与 `cameraQueryGeometry`。  
  - 取 `cameraQueryGeometry` 的 min/max 形成 mercator AABB，用于快速粗筛 tile。  
  - 对每个 tile：  
    - 跳过 `holdingForFade()` 的 tile（被更理想 tile 覆盖）。  
    - 计算 `scale = 2^(transform.zoom - tile.overscaledZ)`，把 `tile.queryPadding` 折算到 tile 空间。  
    - 用 `tileID.getTilePoint()` 把 mercator AABB 转成 tile 空间 bounds，判断是否与 `[0..EXTENT]` 相交。  
    - 把完整的多边形点集也转成 tile 空间后返回。  
- **对照示例**：`learning/04-transform`、`learning/05-tiles-raster`。

## 06 `render/painter.js` · `render()`（offscreen / opaque / translucent 三个 pass）

- **解决的问题**：确定全局渲染顺序，并在不同 pass 中用不同的深度/混合策略绘制各层。  
- **为什么难**：这里混合了**FBO 离屏渲染**、**不透明/半透明排序**、**3D layer 的深度缓冲占用**、以及**symbol 跨 tile 淡入淡出要额外渲染 tile**。  
- **核心流程**：  
  - 预先为每个 source 生成三套坐标序列：`coordsAscending/coordsDescending/coordsDescendingSymbol`。  
  - `opaquePassCutoff`：找到第一个 `layer.is3D()`，其上的 layer 不能走 opaque pass（避免与 3D 深度冲突）。  
  - **offscreen pass**：先画 `layer.hasOffscreenPass()` 的层，避免来回 restore framebuffer。  
  - 回到主 framebuffer：`clear(color/depth)` + `clearStencil()`。  
  - **opaque pass**：自顶向下画（layer index 递减），利于深度测试/减少 overdraw。  
  - **translucent pass**：自底向上画（layer index 递增），满足 painter’s algorithm；symbol 用 `coordsDescendingSymbol` 扩大 tile 集合做淡入淡出。  
- **对照示例**：`learning/09-stencil-clip`、`learning/06-style-min`。

## 07 `render/painter.js` · `_renderTileClippingMasks()`

- **解决的问题**：为需要 tile 裁剪的 source（例如矢量瓦片边界裁剪）写入 stencil mask，后续绘制只在对应 tile 区域内生效。  
- **为什么难**：stencil 是全局共享资源：要分配 ID、处理溢出（最多 256 个值）、并保证多 source 的切换正确。  
- **核心流程**：  
  - 如果 `currentStencilSource` 已是该 layer.source 或 layer 不需要裁剪，则直接 return（避免重复写 stencil）。  
  - 若 `nextStencilID + tileCount > 256`：调用 `clearStencil()` 重置并从 1 开始重新分配。  
  - 对每个 tile：用 `clippingMask` program 绘制 tile extent 的两个三角形，StencilMode 用 `ALWAYS + REPLACE` 写入唯一 ID。  
  - 记录 `_tileClippingMaskIDs[tileID.key] = id`，供 `stencilModeForClipping()` 使用。  
- **常见坑**：256 上限不是随便写的：stencil 常见是 8bit；溢出不处理就会出现“随机裁剪错误”。  
- **对照示例**：`learning/09-stencil-clip`。

## 08 `render/painter.js` · `stencilConfigForOverlap()`

- **解决的问题**：专门给 `raster/raster-dem` 做“子瓦片覆盖父瓦片区域”的遮罩：让更高 zoom 的瓦片遮住低 zoom 的同区域，避免双绘闪烁。  
- **为什么难**：它把“tile 的 overscaledZ 排序”映射成“stencil 值的单调关系”，并且要与 07 的 tile 裁剪 stencil ID 共存。  
- **核心流程**：  
  - `coords` 按 `overscaledZ` 从大到小排序；取 `minTileZ`。  
  - 需要多少种 stencil 值：`stencilValues = maxZ - minTileZ + 1`。  
  - 若 `stencilValues>1`：为每个 `z` 分配一个 `StencilMode(func=GEQUAL, ref=nextStencilID+i)`；ref 随 z 单调变化。  
  - 返回 `[zToStencilMode, coords]`；若只有一个 z，直接 `StencilMode.disabled`。  
- **对照示例**：`learning/09-stencil-clip`（理解 stencil 多策略共用很有帮助）。

## 09 `util/actor.js` · `Actor.send()/receive()/processTask()`（Worker 消息模型 + cancel 抢占）

- **解决的问题**：统一主线程与 worker 间的 RPC：发送任务、回传结果、支持取消、并尽量避免长任务阻塞导致 cancel 失效。  
- **为什么难**：并发与时序问题：任务可能来自多个 actor；取消消息必须能“插队”生效；Safari 对 transferables 还有特殊限制。  
- **核心流程**：  
  - `send()`：随机生成 `id`（避免不同上下文的递增 ID 冲突），把 `serialize(data, buffers)` 发过去；返回 `Cancelable`。  
  - `receive()`：  
    - `<cancel>`：从队列里删任务，并调用 worker 侧返回的 `cancel()`（如果存在）。  
    - 其他任务：在 worker（或 `mustQueue`）时入队，用 `ThrottledInvoker` 分片处理，让 `<cancel>` 有机会先被处理。  
  - `processTask()`：  
    - `<response>`：`deserialize()` 后回调。  
    - 真实任务：调用 `parent[task.type]` 或 `getWorkerSource(...)[method]`，并把 `done()` 回传；若返回值带 `cancel`，则保存以响应 `<cancel>`。  
- **对照示例**：`learning/08-worker-transfer`。

## 10 `util/tile_request_cache.js` · Cache API 的“伪 LRU”与 Safari 兼容

- **解决的问题**：用浏览器 Cache Storage 缓存瓦片响应，减少网络开销；同时控制缓存上限，避免无限增长。  
- **为什么难**：Cache API 没有直接的 LRU；Safari 有 `cache.keys()` 内存泄漏；不同浏览器对 `Response(body)` 支持不一致。  
- **关键设计点**：  
  - **共享 Cache 实例**：避免 Safari 因频繁 `keys()` 触发泄漏（文件内有明确注释链接）。  
  - **LRU 近似**：`cacheGet()` 中 `match -> delete -> put(response.clone())`，利用 keys 顺序模拟“最近访问放到末尾”。  
  - **不缓存短寿命**：根据 `Cache-Control/Expires`，`timeUntilExpiry < 7min` 直接跳过。  
  - **把 size check 放 worker**：`enforceCacheSizeLimit()` 在 worker 上跑，降低主线程抖动风险。  
- **对照示例**：`learning/05-tiles-raster`（理解“请求/缓存/重用”的位置）。

## 11 `util/web_worker_transfer.js` · 注册表式序列化（`register/serialize/deserialize`）

- **解决的问题**：把复杂对象（表达式、颜色、Grid、StructArray 等）在主线程与 worker 间安全/高效地传输。  
- **为什么难**：  
  - JS 对象跨线程只能结构化克隆；要想复原原型链/类型，需要额外元信息。  
  - 既要递归序列化，又要尽量 transfer `ArrayBuffer`；还要允许某些字段跳过/浅拷贝。  
- **核心机制**：  
  - `register(name, klass, {omit, shallow})`：给类挂 `_classRegistryKey`，并登记 omit/shallow 策略。  
  - `serialize()`：  
    - 原始类型/`ArrayBuffer`/TypedArray/ImageData 直接返回（并把 buffer 推进 `transferables`）。  
    - 对象：把属性递归序列化，附加 `$name` 指向注册 key；`$name` 保留字禁止用户对象占用。  
    - 允许类自定义 static `serialize/deserialize`（用于绕开某些动态 StructArray 的限制）。  
  - `deserialize()`：读 `$name` 找回 `klass`，`Object.create(klass.prototype)` 还原原型，再递归填充字段。  
- **对照示例**：`learning/08-worker-transfer`。

## 12 `data/program_configuration.js` · ProgramConfiguration（uniform/attribute 绑定器体系）

- **解决的问题**：把 style paint 属性（常量/数据驱动/分段插值/跨渐变）映射到 shader 的 uniforms 和 vertex attributes，实现统一的 GLSL 访问方式。  
- **为什么难**：它同时要满足：  
  - **同一套 shader 语法**同时支持 uniform 与 attribute（靠 `#pragma` 替换）。  
  - **表达式分类**：`constant/source/composite`，以及 `cross-faded`（pattern）特殊路径。  
  - **运行时更新**：stateDependent 表达式、crossfade 缓冲切换、buffer 上传生命周期。  
- **读代码抓手**：  
  - 构造函数遍历 `layer.paint._values`：按 `expression.kind` 选择不同 binder，并把关键信息编码进 `cacheKey`。  
  - `getBinderAttributes()/getBinderUniforms()`：决定 program 需要哪些 attribute/uniform。  
  - `upload()/updatePaintBuffers()`：决定哪些 `VertexBuffer` 要参与绘制（尤其是 pattern 的 zoomIn/zoomOut 双 buffer）。  
- **对照示例**：`learning/07-vector-bucket`。

## 13 `util/struct_array.js` · StructArray + `createLayout()`（对齐/布局/transfer）

- **解决的问题**：用 `ArrayBuffer + TypedArray view` 实现“结构体数组”，既能高效上传 GPU，又能在 worker 间 transfer。  
- **为什么难**：  
  - JS 里没有原生 struct 布局；要自己处理**字节对齐**、offset、components、以及扩容拷贝。  
  - 既要提供“像对象一样访问”的便利，又要避免频繁序列化/反序列化。  
- **关键点**：  
  - `createLayout()`：按成员类型大小与 alignment 计算每个字段 offset，最终 `size` 也要对齐到最大字段/对齐要求。  
  - `serialize()`：调用 `_trim()` 收缩容量，再把 `arrayBuffer` 放进 `transferables`（并标记 `isTransferred` 防止误用）。  
  - `reserve()/resize()`：扩容时新建更大 buffer，再用 `uint8.set(oldUint8Array)` 拷贝旧数据。  
- **对照示例**：`learning/07-vector-bucket`、`learning/02-buffers`。

## 14 `symbol/placement.js` · `Placement.getBucketParts()`（符号摆放的“参数拼装器”）

- **解决的问题**：把一个 tile 的 `SymbolBucket` 变成“可参与一次 placement 的 bucketPart”，并计算该 bucket 在本次 view 下需要的矩阵/比例/查询数据引用。  
- **为什么难**：符号系统是仓库里最复杂的子系统之一，这个函数把很多空间/状态在这里“汇总对齐”。  
- **核心流程**：  
  - 取出 `symbolBucket`、`latestFeatureIndex`、`collisionBoxArray` 等与 query/碰撞相关的结构。  
  - 计算 `scale`、`textPixelRatio`、`posMatrix = transform.calculatePosMatrix(tileID.toUnwrapped())`。  
  - 通过 `projection.getLabelPlaneMatrix()/getGlCoordMatrix()` 构造 `textLabelPlaneMatrix` 和（可选）`labelToScreenMatrix`。  
  - 把 `RetainedQueryData` 挂到 `retainedQueryData[bucketInstanceId]`：保证该 placement 生命周期内 queryRenderedFeatures 能正确映射回要素。  
  - 根据 `sortAcrossTiles` 决定输出一段或多段 `BucketPart`（利用 `sortKeyRanges`）。  
- **对照示例**：`learning/10-symbol-collision`。

## 15 `symbol/collision_index.js` · `placeCollisionBox()/placeCollisionCircles()`（投影 + 栅格碰撞）

- **解决的问题**：在屏幕空间做符号碰撞检测，尽量避免文字/图标互相遮挡，同时保持“平移时稳定”。  
- **为什么难**：  
  - 倾斜/透视下，tile 空间到屏幕空间的比例随深度变化（`perspectiveRatio`）。  
  - 线型标注要沿路径放一串“碰撞圆”（circle），还要裁剪到带 padding 的可见区域，避免大范围抖动。  
- **关键机制**：  
  - `viewportPadding=100`：让多数碰撞变化发生在屏幕外，提高稳定性（代价是更贵）。  
  - `placeCollisionBox()`：投影锚点 -> 算 tileToViewport -> 得到屏幕 AABB；用 `grid.hitTest()` 做快速碰撞。  
  - `placeCollisionCircles()`：把路径（必要时）投影到屏幕，clip 到 padded viewport，然后用 `PathInterpolator` 在路径上等距插值放圆并逐个 hitTest。  
  - “两步插入”设计：先 place 检测，再 insert 写入（方便图标/文字配对一起决策）。  
- **对照示例**：`learning/10-symbol-collision`。

## 16 `render/vertex_array_object.js` · `VertexArrayObject.bind()/freshBind()`（VAO / 非 VAO 双路径）

- **解决的问题**：把 program + 多个 vertex buffer + index buffer 的 attribute 绑定过程缓存起来，减少每帧重复 `vertexAttribPointer` 的开销。  
- **为什么难**：需要同时兼容：  
  - 支持 `OES_vertex_array_object` 的浏览器（真正 VAO）。  
  - 不支持 VAO 的浏览器（手工 enable/disable attributes）。  
  - attribute index 是全局的，不是 program 私有的；还要躲开“WebGL 禁用 attribute 0 会崩”的历史坑。  
- **读代码抓手**：  
  - `isFreshBindRequired`：任何一个绑定要素变化（program/layout/paint buffers/index/offset/dynamic buffers）都必须重新 freshBind。  
  - 非 VAO 分支里会把上一个 program 多出来的 attributes 逐个 `disableVertexAttribArray`（跳过 0）。  
  - dynamic buffer 即使 VAO 复用，也可能数据更新，需要重新 `bind()` 触发上传。  
- **对照示例**：`learning/02-buffers`、`learning/01-program`。

## 17 `gl/context.js` · `Context.setDefault()/setDirty()/set*Mode()`（WebGL 状态缓存层）

- **解决的问题**：把零散的 WebGL 状态操作（blend/depth/stencil/cull/绑定点等）封装成可缓存、可批量恢复默认值的“状态机”。  
- **为什么难**：  
  - WebGL 状态调用很贵；需要“值对象（`gl/value.js`）+ dirty 标记”来避免重复设置。  
  - 渲染器之外还可能有 custom layers 或外部代码改 GL 状态，必须提供 `setDefault()/setDirty()` 兜底。  
  - 一些平台有诡异 bug（例如 `clearDepth` 需要先 reset `depthRange`）。  
- **读代码抓手**：  
  - constructor 里集中做 extension 探测（VAO、各向异性、half-float、timer query）。  
  - `setDepthMode/setStencilMode/setColorMode`：把高层 Mode 翻译成多条底层 state 的组合设置。  
  - `unbindVAO()`：避免 VAO 绑定导致“后续创建 buffer/custom layer 不小心改到旧 VAO”。  
- **对照示例**：`learning/09-stencil-clip`（理解 stencil/depth/blend 组合），`learning/00-hello-webgl`。

## 18 `render/image_manager.js` · `getImages()/getPattern()/_updatePatternAtlas()`（sprite 请求 + pattern atlas）

- **解决的问题**：  
  1) worker 请求图标时，主线程聚合/延迟/回调响应；  
  2) 为 `*-pattern` 构建纹理图集（atlas），并处理采样 padding；  
  3) 对可渲染图片（runtime image）每帧最多 rerender 一次。  
- **为什么难**：这是一个“多职责类”，同时涉及事件系统（`styleimagemissing`）、图集打包、纹理更新与帧内去重。  
- **关键机制**：  
  - `getImages()`：sprite 未 loaded 且依赖不全时把 requestor 暂存，等 loaded 后统一 `_notify()`。  
  - `_notify()`：缺图会触发 `styleimagemissing` 事件；返回给 worker 的图片会 clone，避免 transfer 掉主线程的 buffer。  
  - `getPattern()`：按 image `version` 判断是否需要重建；`potpack` 重新 pack bins；拷贝图像并在四边加“wrapped padding”解决 `GL_LINEAR` 采样缝隙。  
  - `dispatchRenderCallbacks()`：一帧内对同一 id 只 dispatch 一次 render。  
- **对照示例**：`learning/06-style-min`（sprite/图片概念入口）、`learning/03-texture`。

## 19 `render/glyph_manager.js` · `getGlyphs()`（range 去重 + TinySDF 本地字形）

- **解决的问题**：按字体栈批量请求 glyph，并做缓存/去重；对 CJK 等字形可选用本地字体生成 SDF（减少网络依赖）。  
- **为什么难**：  
  - glyph 请求按 `range = floor(id/256)` 分组，必须对同 range 的并发请求做去重合并。  
  - 同时混入“网络 glyph”与“本地 TinySDF glyph”，并需要避免重复覆盖。  
- **核心流程**：  
  - 先查 `entry.glyphs[id]`；再尝试 `_tinySDF()`（仅 ideograph 且配置了本地字体时）。  
  - 若需要网络请求：对同一个 `range`，只发一次 `loadGlyphRange`，把 callbacks 都挂到 `entry.requests[range]`。  
  - 返回结果前 clone `bitmap`，避免把主线程持有的 buffer transfer 掉。  
  - `id>65535` 直接报错（range 体系的边界条件）。  
- **对照示例**：`learning/06-style-min`（glyph/symbol 概念入口）。

## 20 `source/tile_id.js` · `OverscaledTileID` / `calculateKey()`（wrap + overscale + key 编码）

- **解决的问题**：用一套 ID 体系表达“同一个瓦片在不同 wrap（世界复制）与不同 overscaledZ（过缩放）下的身份”，并提供高效 key 用于 hash/caches。  
- **为什么难**：tile 的“坐标”不是一个维度：  
  - `canonical(z,x,y)`：瓦片金字塔上的真正层级与索引。  
  - `wrap`：第几个世界拷贝（`renderWorldCopies`）。  
  - `overscaledZ`：请求/渲染时的放大层级（可能大于 canonical.z）。  
- **读代码抓手**：  
  - `scaledTo()/children()/isChildOf()`：在 canonical.z 与 overscaledZ 混合的前提下做 parent/child 判定与生成。  
  - `calculateScaledKey(targetZ, withWrap)`：避免频繁创建新对象，是性能优化点。  
  - `calculateKey()`：把 wrap 的符号编码进整数，再拼上 `z/overscaledZ`，最后转 base36；这是大量缓存（tile 缓存、posMatrix cache、stencil id map）的基础。  
- **对照示例**：`learning/05-tiles-raster`、`learning/04-transform`。

---

## 21 `style/style.js` · `setState()`（smart setStyle：diff 应用器）

- **解决的问题**：把一份新的 style JSON “以最小修改量”应用到当前 Style 上，而不是粗暴地全量重建（减少闪烁/重载/状态丢失）。
- **为什么难**：它要把 style-spec 的 diff 结果翻译成一串“可执行的 Style API 调用”，并且要处理“不支持/需要忽略的 diff 操作”、`ref layer` 解引用、以及一些历史兼容逻辑（例如 canvas source 的校验绕过）。
- **核心流程（按代码顺序对齐）**：
  1) `_checkLoaded()` + `validateStyle(nextState)`：确保 style 已 loaded 且新 style 合法。
  2) `nextState = clone(nextState)` + `nextState.layers = deref(nextState.layers)`：把 `ref` layer 展开成可直接应用的 layer 列表。
  3) `diffStyles(this.serialize(), nextState)`：生成操作列表，再过滤掉 `ignoredDiffOperations`（`setCenter/setZoom/...`）。
  4) 检查是否有 `supportedDiffOperations` 之外的 op：有就直接抛 `Unimplemented: ...`。
  5) 逐条执行 op：`(this: any)[op.command].apply(this, op.args)`；但 `setTransition` 特判跳过（transition 最终直接从 `this.stylesheet` 读取）。
  6) 最后 `this.stylesheet = nextState`，返回是否有变更。
- **读代码抓手**：
  - `supportedDiffOperations/ignoredDiffOperations` 决定“smart setStyle 的边界”。
  - 注意这里的“执行 diff op”只是把变更排队（`_updatedLayers/_updatedSources/...`），真正 batch 应用发生在后续 `style.update(parameters)`。
- **对照示例**：`learning/06-style-min`。

## 22 `style-spec/diff.js` · `diffStyles()/diffLayers()`（样式 diff 生成器：重排 + 最小变更）

- **解决的问题**：把 `beforeStyle -> afterStyle` 转成一串“接近 mapbox-gl API”的操作（add/remove layer、setPaintProperty、add/remove source...），用于 `Style#setState` 做最小化更新。
- **为什么难**：
  - layer 的 **重排** 无法只靠 set property：必须拆成 remove + add（并且 add 需要 `beforeLayerId`）。
  - **源依赖**：remove source 之前必须 remove 所有依赖它的 layers。
  - **GeoJSON 特判**：只有 `data` 变更时优先用 `setGeoJSONSourceData`，否则 remove+add。
  - 任一 diff 过程出错要回退到 `setStyle`（全量替换）。
- **核心流程**：
  - `diffStyles`：先 diff 顶层字段（center/zoom/bearing/pitch/sprite/glyphs/transition/light）。
  - `diffSources`：收集 add/remove/update source；记录 `sourcesRemoved`。
  - 移除依赖被删 source 的 layer（先 push removeLayer），再把剩余 layer 交给 `diffLayers`。
  - `diffLayers`：
    - 构建 `beforeOrder/afterOrder`、`beforeIndex/afterIndex`、`tracker`（模拟“就地变更后”的顺序）。
    - 先 remove 缺失 layer；再倒序遍历 afterOrder 做“插入到正确位置”的 addLayer（必要时先 remove 旧位置）。
    - 对未标记 `clean` 的 layer 做属性 diff：layout/paint/filter/minzoom/maxzoom + 其它 props（含 `paint.*` klass）。
- **常见坑**：diff 生成了 `setSprite/setGlyphs`，但 `Style#setState` 可能选择不支持（见 21）。
- **对照示例**：`learning/06-style-min`。

## 23 `style-spec/expression/index.js` · `createPropertyExpression()`（表达式解析：constant/source/camera/composite 分流）

- **解决的问题**：把样式中的 expression JSON 编译成“可高频 evaluate”的对象，并在编译期决定它属于哪一类：
  - `constant`：与 zoom/feature 无关；
  - `source`：依赖 feature（或 feature-state），但不依赖 zoom；
  - `camera`：只依赖 zoom；
  - `composite`：既依赖 zoom 又依赖 feature（或 feature-state）。
- **为什么难**：它同时承担**解析 + 类型检查 + 约束校验 + 运行时容错**：例如某些 property 不支持 data expression、不支持 zoom expression、不支持 interpolate。
- **核心流程**：
  1) `createExpression(expression, propertySpec)`：解析 AST，生成 `StyleExpression`（带默认值与 warn-once 的 try/catch）。
  2) `isConstant.*`：判断是否 feature 常量、zoom 常量、state 常量。
  3) `supportsPropertyExpression/supportsZoomExpression/supportsInterpolation`：按 property spec 做能力裁剪。
  4) `findZoomCurve(parsed)`：只允许 zoom 出现在顶层 `step/interpolate` 的 input；否则直接报 ParsingError。
  5) 根据“是否有 zoomCurve + 是否 feature 常量”返回 `ZoomConstantExpression` 或 `ZoomDependentExpression`（并记录 `zoomStops`/`interpolationType`）。
- **读代码抓手**：
  - `StyleExpression.evaluate(...)`：遇到 `null/undefined/NaN` 或 RuntimeError 会回退到默认值，并按 message 去重 warn。
  - `isStateDependent`：很多“看似纯 source”的表达式因为 `feature-state` 会变成“需要 per-frame 更新”。
- **对照示例**：`learning/06-style-min`。

## 24 `style/pauseable_placement.js` · `PauseablePlacement.continuePlacement()`（2ms 时间片的增量符号摆放）

- **解决的问题**：把符号摆放（placement）拆成多个小片段跨帧执行，避免一次摆放把主线程卡到掉帧（默认每帧最多用 ~2ms）。
- **为什么难**：placement 是一个“状态机”：必须能在任意位置暂停/恢复，同时保持摆放结果的确定性，并处理“跨 tile 排序”的特殊路径。
- **核心流程**：
  - `PauseablePlacement` 持有一个 `Placement`，并记录 `_currentPlacementIndex`（从 render order 的末尾开始向前处理）。
  - `continuePlacement`：
    - 通过 `browser.now()` 做时间片控制；`_forceFullPlacement` 时不暂停。
    - 逐层处理 symbol layer：懒创建 `_inProgressLayer = new LayerPlacement(symbolLayer)`。
    - `LayerPlacement.continuePlacement` 先遍历 tiles 收集 `bucketParts`（`placement.getBucketParts(...)`），必要时暂停。
    - 若需要跨 tile 排序（`symbol-z-order !== viewport-y` 且有 `symbol-sort-key`），就对 `bucketParts` 按 `sortKey` 排序后再逐个 `placeLayerBucketPart`。
    - 任意阶段暂停都会保留 `_currentTileIndex/_currentPartIndex/_seenCrossTileIDs`，下帧从断点继续。
  - 全部 layer 完成后 `_done=true`；`commit(now)` 才真正把结果提交给 placement（用于淡入淡出/状态更新）。
- **对照示例**：`learning/10-symbol-collision`。

## 25 `symbol/cross_tile_symbol_index.js` · `addBucket()/handleWrapJump()`（跨 tile 稳定 ID：去闪烁 + 去重）

- **解决的问题**：为每个 symbol instance 分配稳定的 `crossTileID`，让同一个“概念上的标签”在：
  - tile 重载、zoom 切换（父子瓦片）、以及世界复制（wrap）时不会反复“消失再出现”。
- **为什么难**：它做的是“近似匹配”：同 key（文本/图标）+ anchor 坐标足够接近就算同一标签；还要避免同 zoom 下多个标签重复匹配到同一个 parent（issue #5993）。
- **核心流程**：
  - `TileLayerIndex`：按 `symbolInstance.key` 分桶，记录每个 instance 的 `crossTileID` 和“缩放到同一 z 的 world 坐标”。
  - `getScaledCoordinates`：把 `(canonical.x*EXTENT + anchorX, canonical.y*EXTENT + anchorY)` 变为 world 坐标，再按 `roundingFactor / 2^zDifference` 降采样（约 4px 网格）。
  - `addBucket(tileID, bucket, crossTileIDs)`：
    - 先把 bucket 内所有 `crossTileID` 清 0。
    - 遍历已有 `indexes`：
      - 更高 zoom：对属于该 tile 的 childIndex 做 `findMatches`；
      - 更低/同 zoom：找 `parentCoord = tileID.scaledTo(zoom)` 的 parentIndex 做 `findMatches`。
    - 未匹配到的 instance 用 `crossTileIDs.generate()` 分配新 ID，并在 `usedCrossTileIDs[zoom]` 里标记占用。
    - 把该 tile 生成新的 `TileLayerIndex` 存入 `indexes[overscaledZ][tileID.key]`。
  - `handleWrapJump(lng)`：`wrapDelta = round((lng-this.lng)/360)`，把所有 index 的 `tileID` 做 `unwrapTo(wrap+wrapDelta)`，避免跨反子午线时整套 key 失效。
- **对照示例**：`learning/10-symbol-collision`。

## 26 `symbol/get_anchors.js` · `getAnchors()/resample()`（沿线标注的锚点采样 + max-angle 检查）

- **解决的问题**：对 line feature 生成一组“可放置标签的 anchor 点”，满足：
  - 间距（`symbol-spacing`）约束；
  - 标签长度能放得下（不越过线段起止）；
  - 曲率不过大（`text-max-angle`）。
- **为什么难**：要同时兼顾“短线/overscaled tile 的对齐一致性”“线是否从 tile 外延续进来”“标签太长导致 spacing 需要自适应”等边界条件。
- **核心流程**：
  - `labelLength = max(textLength, iconLength) * boxScale`；`angleWindowSize` 随 glyphSize/boxScale 估算。
  - 若 `spacing - labelLength < spacing/4`：强制把 spacing 提高到 `labelLength + spacing/4`（避免标签边缘挤在一起）。
  - 计算 `offset`：
    - 非 continued line：`((labelLength/2 + fixedExtraOffset) * boxScale * overscaling) % spacing`（额外偏移避开 T 形交叉口的撞车）。
    - continued line：`(spacing/2 * overscaling) % spacing`（让父子瓦片对齐）。
  - `resample` 沿折线按 `offset + k*spacing` 取点，点必须在 tile 边界内且 `markedDistance ± halfLabelLength` 不越界；每个候选点通过 `checkMaxAngle` 才保留。
  - 若未找到 anchor 且不是 continued：退化为“只在中点尝试一次”的 second pass。
- **对照示例**：`learning/10-symbol-collision`。

## 27 `symbol/shaping.js` · `shapeText()`（Formatted 文本 → 带图/RTL/竖排的 glyph 布局）

- **解决的问题**：把 `Formatted`（多段字体/缩放/内联图片）转换成可渲染的 `Shaping`：每行的 `positionedGlyphs` + 文本包围盒 + writingMode 元数据。
- **为什么难**：这是“文本渲染前端”的大熔炉：
  - 行折（maxWidth）、字距（spacing）、对齐（anchor/justify）。
  - RTL/Bidi：依赖可选的 `mapbox-gl-rtl-text` 插件，并且要维护 sectionIndex 与文本同步。
  - 竖排：需要 `verticalizePunctuation` + 垂直/水平混排规则。
  - 内联图片：用 Private Use Area 字符把 image 当“伪 glyph”处理。
- **核心流程**：
  1) `TaggedString.fromFeature(text)`：把 sections flatten 成 `text + sectionIndex[] + sections[]`（每个 char 指向自己的字体/scale 或 imageName）。
  2) 竖排时先 `logicalInput.verticalizePunctuation()`。
  3) `determineLineBreaks(...)` 计算断行点；若 rtl 插件存在：
     - 单 section 用 `processBidirectionalText`；多 section 用 `processStyledBidirectionalText`（保留 sectionIndex）。
     - 否则走 `breakLines` 的纯逻辑断行。
  4) 初始化 shaping bounds（以 `translate` 为起点），`shapeLines(...)` 填充每行 glyph 的位置并更新 `top/bottom/left/right`。
  5) 若 `positionedLines` 为空返回 false（后续会跳过该 label）。
- **对照示例**：`learning/10-symbol-collision`。

## 28 `symbol/quads.js` · `getIconQuads()/getGlyphQuads()`（九宫格 text-fit + glyph quad 生成）

- **解决的问题**：把 shaping/icon 信息变成一组 `SymbolQuad`：每个 quad 给出四个角的偏移（相对 anchor）、纹理坐标 rect、以及一些渲染元数据（SDF、sectionIndex、pixelOffset 等）。
- **为什么难**：同一套 quad 体系里混着三种尺度：
  - 文本 glyph 以 `ONE_EM` 为单位；
  - 内联图片/普通 icon 以像素+pixelRatio 计；
  - text-fit icon 还要做“可拉伸区（stretchX/Y）+ 内容区（content）”的九宫格拆分。
- **核心流程**：
  - `getIconQuads`：
    - 计算 `fixedWidth/fixedHeight` 与 `stretchWidth/stretchHeight`，必要时根据 `image.content` 把内容区映射到 stretch/fixed 空间。
    - `stretchZonesToCuts` 把 stretch 区间转换成 cuts，遍历 cuts 的网格生成多个子 quad（九宫格/多宫格）。
    - `makeBox` 同时计算 em 偏移与像素偏移，并把 padding/border 反映到 `tex` rect。
  - `getGlyphQuads`：
    - 遍历 `shaping.positionedLines`，对每个 glyph 生成 quad；内联 image 用 `IMAGE_PADDING/pixelRatio` 作为 buffer，并从 `imageMap` 取 `sdf/pixelRatio`。
    - `alongLine/allowVerticalPlacement` 影响 glyph 是否旋转；`text-rotate` 参与最终角度。
- **对照示例**：`learning/10-symbol-collision`、`learning/03-texture`。

## 29 `render/draw_symbol.js` · `updateVariableAnchorsForBucket()`（variable-anchor 动态顶点：透视缩放 + pitch/rotate 对齐）

- **解决的问题**：当启用 `text-variable-anchor` 时，渲染前需要把“最终选中的 anchor”反映到 GPU 顶点数据里：对每个 placed symbol 计算偏移并写入 dynamic layout vertex buffer。
- **为什么难**：偏移的计算要根据对齐模式走两套空间：
  - `rotateWithMap`（rotation-alignment）决定 shift 是否要按地图旋转反向补偿；
  - `pitchWithMap`（pitch-alignment）决定 shift 在投影前（tile 单位）还是投影后（屏幕像素）应用；
  - 还要乘上 `perspectiveRatio` + zoom 相关的文本尺寸（`symbolSize.evaluateSizeForFeature`）。
- **核心流程**：
  - 对每个 `placedSymbol`：用 `crossTileID` 查 `variableOffsets`；缺失或 hidden 就 `symbolProjection.hideGlyphs(...)`。
  - 计算 `projectedAnchor` 与 `perspectiveRatio`，得到 `renderTextSize`（pitchWithMap 时还要做像素→tile 单位换算）。
  - `calculateVariableRenderShift(...)` 把 anchor 对齐（left/right/top/bottom）+ `text-offset` 合并成一个 shift。
  - 根据 `pitchWithMap/rotateWithMap` 把 shift 应用到 `projectedAnchor` 或 tileAnchor，再写入每个 glyph 的 dynamic attributes。
  - 若 `icon-text-fit` 且 icon 与 text 关联：用 `placedTextShifts` 同步更新 icon 的 dynamic buffer。
- **对照示例**：`learning/10-symbol-collision`、`learning/04-transform`。

## 30 `render/line_atlas.js` · `addDash()`（虚线 SDF 图集：round cap + seamless repeat）

- **解决的问题**：把任意 `line-dasharray` 预渲染成 1D 的 SDF（Signed Distance Field）条带，塞进一张 atlas 纹理里；line shader 只需要按 UV 采样即可画出虚线。
- **为什么难**：虚线有很多边界条件：odd-length dasharray 需要首尾无缝拼接；round cap 需要二维距离场；0-length 段要折叠；结果要支持 `TEXTURE_WRAP=REPEAT` 的无缝重复。
- **核心流程**：
  - `getDash`：用 `dasharray.join()+round` 做 key 缓存；缺失则 `addDash`。
  - `addDash`：
    - 计算总长度 `length`，`stretch = width/length`；`getDashRanges` 生成 `{left,right,isDash,zeroLength}`。
    - `round` 分支：`addRoundDash` 写多行（高度 `2n+1`），把“到 dash 边缘的距离 + 圆帽距离”合成 signed distance。
    - 非 round：`addRegularDash` 折叠 0-length、合并相邻同类段，并把首尾同类段拼成一个可 repeat 的范围。
    - 把 signed distance 映射到 `[0..255]`（`+128` bias），标记 `dirty`。
  - `bind`：首次创建 alpha texture；dirty 时 `texSubImage2D` 局部更新。
- **对照示例**：`learning/03-texture`、`learning/01-program`。

## 31 `render/image_atlas.js` · `ImageAtlas`（worker 端 icon/pattern 打包 + wrapped padding + 局部更新）

- **解决的问题**：在 worker 里把 icon + pattern 打包到同一张 RGBA atlas 里（`potpack`），并提供每张图片的 `ImagePosition`（UV/尺寸/stretch/content/version）。同时支持 runtime image 的版本更新（无需重排 atlas）。
- **为什么难**：pattern 必须加“wrapped padding”避免采样缝；runtime image 需要一帧内去重 rerender；版本同步不对就会出现“贴图更新了但 atlas 没更新”的幽灵 bug。
- **核心流程**：
  - `addImages`：对每张图片加 `IMAGE_PADDING`，生成 bin，记录 `ImagePosition`；收集 `haveRenderCallbacks`。
  - `potpack(bins)` 得到 atlas 尺寸，创建 `RGBAImage`，把 icons/patterns copy 进 atlas。
  - pattern 额外 copy 四条边（T/B/L/R）做 wrapped padding（防 `GL_LINEAR` 采样越界取到透明）。
  - `patchUpdatedImages(imageManager, texture)`：
    - `dispatchRenderCallbacks(haveRenderCallbacks)` 触发 rerender；
    - 遍历 `imageManager.updatedImages`，对 iconPositions/patternPositions 都尝试 patch：若 `version` 变了就 `texture.update(image.data, ..., {x,y})`。
- **对照示例**：`learning/03-texture`、`learning/06-style-min`。

## 32 `source/vector_tile_worker_source.js` · `loadTile()/reloadTile()`（worker tile 生命周期：loading/loaded + reparse 竞态）

- **解决的问题**：在 worker 端把“拉取 PBF -> 解析 VectorTile -> WorkerTile.parse -> 回传 buckets”串起来，并正确处理 abort/reload、缓存、以及 rawTileData 的保留与 transfer。
- **为什么难**：同一个 tile 可能在 parsing 时被 `reloadTile` 触发；abort 需要能取消网络请求；rawTileData 既要回传主线程又要在 worker 留一份（用于 query/重解析）。
- **核心流程**：
  - `loading[uid]` 存正在加载/解析的 WorkerTile；`loaded[uid]` 存已完成的 WorkerTile。
  - `loadTile`：
    - 若开启资源计时：`RequestPerformance` 在 worker 侧 finish 并 `JSON.parse(JSON.stringify(...))` 固化（避免 main thread “illegal invocation”）。
    - `workerTile.abort = loadVectorData(params, cb)`；成功后保存 `rawTileData/cacheControl/expires`，再 `workerTile.parse(...)`。
    - 回调时 `rawTileData.slice(0)`：transfer 一份拷贝（worker 保留原 buffer）。
  - `reloadTile`：
    - 若 tile 还在 `parsing`：暂存 `reloadCallback`，等 parse 完再重跑一次 parse。
    - 若已 `done` 且有 `vectorTile`：直接 parse。
  - `abortTile/removeTile`：取消并清理对应 uid。
- **对照示例**：`learning/08-worker-transfer`、`learning/07-vector-bucket`。

## 33 `source/geojson_worker_source.js` · `loadData()/_loadData()/coalesce()`（GeoJSON 索引的“合并更新”状态机）

- **解决的问题**：GeoJSONSource 的 worker 端数据入口：把 GeoJSON（可能频繁 setData）转成可切瓦片的索引（`geojson-vt` 或 `supercluster`），并用 `coalesce` 把高频更新合并成“只处理最后一次”。
- **为什么难**：这是一个三态状态机（Idle/Coalescing/NeedsLoadData），同时掺杂了表达式 filter 的编译执行、ring winding 的 rewind、以及大对象索引构建的异常处理。
- **核心流程**：
  - `loadData(params, cb)`：
    - 若已有 `_pendingCallback`：先回 `{abandoned:true}`（告诉前台那次更新作废）。
    - 保存本次 params/callback；若当前不 Idle：置为 `NeedsLoadData`；否则进入 `Coalescing` 并 `_loadData()`。
  - `_loadData()`：
    - `loadGeoJSON(params, ...)` 取数据；`rewind(data, true)` 规范 ring 方向。
    - 若 `params.filter`：`createExpression(..., {type:'boolean', ...})` 编译后对 features 逐个 evaluate（zoom=0）。
    - `this._geoJSONIndex = params.cluster ? supercluster.load(...) : geojsonvt(...)`。
    - 清空 `loaded` tile 缓存；回传资源计时信息。
  - `coalesce()`：
    - `Coalescing -> Idle`（表示“处理完这一轮”）；`NeedsLoadData -> Coalescing + _loadData()`（立刻跑下一轮，用最新 params）。
- **对照示例**：`learning/08-worker-transfer`、`learning/06-style-min`。

## 34 `source/worker_tile.js` · `WorkerTile.parse()`（VectorTile → buckets：依赖拉取 + symbol layout 汇合点）

- **解决的问题**：worker 里最核心的“瓦片解析器”：把 VectorTile 按 layer family 生成 buckets（Fill/Line/Symbol...），并把 glyph/icon/pattern 依赖补齐后做 symbol layout，最终产出可直接渲染的数据结构。
- **为什么难**：一次 parse 同时横跨：style layer family 分组、zoom 相关的 recalculate、FeatureIndex/CollisionBoxArray 构建、以及三路异步依赖（glyphs/icons/patterns）汇合。
- **核心流程**：
  1) 初始化：`CollisionBoxArray`、`DictionaryCoder(sourceLayerIds)`、`FeatureIndex(tileID,promoteId)`、`buckets`、`options(dependencies...)`。
  2) 遍历 `layerIndex.familiesBySource[source]`：
     - 取 `VectorTileLayer`，构建 `features[]`（含 `id/index/sourceLayerIndex`）。
     - 对每个 family：zoom/visibility 过滤，`recalculateLayers(family, zoom, images)`，`layer.createBucket(...)`，`bucket.populate(...)`。
  3) 依赖请求：`actor.send('getGlyphs')` + `actor.send('getImages', type='icons'/'patterns')`。
  4) `maybePrepare()`：三者就绪后创建 `GlyphAtlas`/`ImageAtlas`，再对 bucket 做二次处理：
     - `SymbolBucket`：`performSymbolLayout(...)`；
     - 需要 pattern 的 bucket：`bucket.addFeatures(..., imageAtlas.patternPositions)`。
  5) 回传：过滤空 bucket，并附带 glyphAtlasImage/imageAtlas/featureIndex/collisionBoxArray。
- **对照示例**：`learning/07-vector-bucket`、`learning/08-worker-transfer`、`learning/10-symbol-collision`。

## 35 `source/query_features.js` · `queryRenderedFeatures()/queryRenderedSymbols()`（点选/框选：tile 合并 + 渲染顺序还原）

- **解决的问题**：实现 `map.queryRenderedFeatures` 的核心：在正确的 tile 集合上做查询、合并结果、去掉 wrap duplication，并尽量按“屏幕上看到的绘制顺序”返回结果；symbol 还要走 CollisionIndex 全局查询。
- **为什么难**：
  - 是否存在 3D layer 会改变查询几何（cameraQueryGeometry）。
  - world copies（wrap）会导致同一个 data tile 在多个 wrappedTileID 下重复出现，必须去重。
  - symbol 的“渲染顺序”依赖 bucket 内的 sortFeatures/featureSortOrder。
  - 结果还要注入 `feature-state`。
- **核心流程**：
  - `tilesIn = sourceCache.tilesIn(queryGeometry, maxPitchScaleFactor, has3DLayer)`，并按 `overscaledZ/y/wrap/x` 排序。
  - 对每个 tile：构造 `pixelPosMatrix = viewportTransform * transform.calculatePosMatrix(tileID.toUnwrapped())`，调用 `tile.queryRenderedFeatures(...)`。
  - `mergeRenderedFeatureLayers`：以 `wrappedTileID` 为 key，按 `featureIndex` 去重合并。
  - 统一注入 state：`sourceCache.getFeatureState(source-layer, id)`。
  - `queryRenderedSymbols`：`collisionIndex.queryRenderedSymbols` 得到 symbolFeatureIndexes；用 `retainedQueryData` 找到对应 FeatureIndex，再 `lookupSymbolFeatures`，并按 `featureSortOrder` 做 top-to-bottom 排序。
- **对照示例**：`learning/05-tiles-raster`、`learning/10-symbol-collision`。

## 36 `data/feature_index.js` · `FeatureIndex.query()/loadMatchingFeature()`（空间索引 + 过滤 + feature-state 注入）

- **解决的问题**：瓦片内的查询引擎：用空间索引快速筛选候选要素，再做 style filter + 几何相交测试，返回带 layer 信息与 intersectionZ 的 GeoJSONFeature 列表。
- **为什么难**：它把三个系统粘在一起：
  - 原始 VectorTile 数据（`vt.VectorTile + Protobuf`）的 lazy 解码；
  - `grid-index` 的 bbox 索引（还分了 2D/3D 两套 grid）；
  - style-spec filter 与 paint/layout 的表达式求值（还要支持 `feature-state` 和 `availableImages`）。
- **核心流程**：
  - `insert`：把 feature 的 ring bbox 插入 `grid` 或 `grid3D`；同时在 `featureIndexArray` 里记录 `{featureIndex, sourceLayerIndex, bucketIndex}`。
  - `query`：
    - `pixelsToTileUnits = EXTENT / tileSize / scale`；`filter = featureFilter(params.filter)`。
    - `grid.query(bounds ± queryPadding)` 得到候选；3D 用 `grid3D.query(..., predicate=polygonIntersectsBox(cameraQueryGeometry,...))` 做更严格筛选。
    - 遍历候选索引，调用 `loadMatchingFeature`：
      - 根据 `bucketLayerIDs[bucketIndex]` 与 `params.layers` 做 layer 粗筛。
      - 从 `vtLayers[sourceLayerName].feature(featureIndex)` 取出真实 feature；用 `EvaluationParameters(overscaledZ)` 跑 filter。
      - 求 id + 读 `SourceFeatureState`，evaluate paint/layout（为了 query 结果要与渲染语义一致）。
      - 调 `styleLayer.queryIntersectsFeature(...)` 做几何相交与（可选）Z 求交。
- **对照示例**：`learning/07-vector-bucket`。

## 37 `source/tile.js` · `setExpiryData()/getExpiryTimeout()`（瓦片过期：clock skew 修正 + 指数退避）

- **解决的问题**：基于 HTTP 缓存头（`Cache-Control/Expires`）判断 tile 是否过期，并为过期 tile 计算下一次重试的 timeout，避免对服务器/主线程产生抖动。
- **为什么难**：必须处理各种“脏”现实：服务器时间回拨、反复返回同一个已过期资源、以及 `setTimeout` 32-bit 上限。
- **核心流程**：
  - `setExpiryData(data)`：
    - 解析 `max-age` 或 `expires` 设置 `expirationTime`。
    - 若发现 `expirationTime` 走回头路或 delta 为 0：标记 `isExpired=true`，并用 `expiredRequestCount++` 进入指数退避。
    - 否则认为可能是 clock skew：把 `expirationTime` 插值到 `now + max(delta, CLOCK_SKEW_RETRY_TIMEOUT)`。
    - 过期时把 tile `state='expired'`。
  - `getExpiryTimeout()`：
    - 若 `expiredRequestCount>0`：`1000 * (1 << min(count-1, 31))`。
    - 否则 `min(expirationTime-now, 2^31-1)`。
- **对照示例**：`learning/05-tiles-raster`。

## 38 `source/tile_cache.js` · `TileCache`（wrapped key + 多版本 entry + timeout 驱逐的 LRU）

- **解决的问题**：在主线程缓存 Tile 对象：快速复用最近访问的 tiles（回退/父子替代/淡入淡出），同时限制最大数量，并可按 TTL 自动过期。
- **为什么难**：它不是教科书 LRU：
  - key 用的是 `tileID.wrapped().key`（world copies 共享 key）。
  - 同一个 key 下允许有多个 entry（`data[key]` 是数组），因此 `order` 里也会出现重复 key。
  - 每个 entry 还可能带一个 `timeout`，到点自动调用 `remove`。
- **核心流程**：
  - `add(tileID, tile, expiryTimeout)`：push entry + push key；超出 `max` 时用 `order[0]` 找到最老 entry 移除，并触发 `onRemove`。
  - `get/getByKey` 永远取 `data[key][0]`；`getAndRemove` shift 掉第一个 entry。
  - `reset` 会清理所有 timeout 并对每个 tile 调 `onRemove`。
  - `filter(fn)` 用于批量清理 stale tiles（例如 style/source 变化）。
- **读代码抓手**：不要把它当“每个 key 只有一个值”的 LRU；它其实是“按插入顺序排队的 entry 列表”，key 只是为了定位 entry 组。
- **对照示例**：`learning/05-tiles-raster`。

## 39 `render/program.js` · `Program`（defines 拼接、attribute 固定索引、segment→VAO 缓存）

- **解决的问题**：把 shader + attribute/uniform 绑定 + VAO 复用封装成一个可复用的 Program：调用方只需要给 buffers/uniformValues/segments，就能在正确的 WebGL 状态下 draw。
- **为什么难**：WebGL 的“底层约束”直接体现在这段代码里：attribute location 必须固定且与 VAO 布局一致；uniform 要分静态与随 paint 变化的 binder uniform；segment 级别缓存 VAO 才能避免重复 bind。
- **核心流程**：
  - 构造时：
    - 组合 `staticAttributes + configuration.getBinderAttributes()`，按顺序 `bindAttribLocation(i, name)` 固定索引。
    - 组合 `staticUniforms + configuration.getBinderUniforms()` 并去重，再 `getUniformLocation`。
    - 拼接 `defines + shader prelude + shader source`，compile/link，生成 `fixedUniforms` 与 `binderUniforms`。
  - `draw(...)`：
    - `context.program.set` + `setDepthMode/setStencilMode/setColorMode/setCullFaceMode`。
    - 写 fixed uniforms；`configuration.setUniforms` 写 binder uniforms。
    - 遍历 `segments.get()`：`segment.vaos[layerID]` 里取/建 VAO，`vao.bind(...)` 后 `gl.drawElements`。
- **对照示例**：`learning/01-program`、`learning/02-buffers`。

## 40 `data/dem_data.js` · `DEMData`（Terrain-RGB/terrarium 解码 + 边界 backfill）

- **解决的问题**：解码 raster-dem（地形高程）瓦片：把 RGB 编码的高度值变为可采样的 elevation，并用邻瓦片 backfill 边界，保证 hillshade/坡度计算不在 tile 边缘出现接缝。
- **为什么难**：
  - 同一数据结构要支持两种编码（mapbox/terrarium）。
  - DEM 纹理依赖“1px padding”语义：坐标允许在 `[-1..dim]`，边界像素用于邻域算子（坡度）计算。
  - backfillBorder 要根据 `(dx,dy)` 只拷贝 1px 宽的边界条带，并映射到正确的源坐标。
- **核心流程**：
  - constructor：验证正方形；`stride = data.height`，`dim = stride-2`；把 buffer 视作 `Uint32Array` 存储；先用“最近内点”填充四条边与四个角（邻瓦片未加载前避免 seams）。
  - `get(x,y)`：从 `Uint8Array(this.data.buffer)` 读 r/g/b，用 `_unpackMapbox` 或 `_unpackTerrarium` 解码高度。
  - `backfillBorder(borderTile, dx, dy)`：计算需要回填的 x/y 范围（只取一条边），并从 neighbor 按偏移 `(ox,oy)` 拷贝数据。
- **对照示例**：`learning/05-tiles-raster`。

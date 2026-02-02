# 20 段“最难读”的核心代码导读（new-mapbox-gl-v1）

> 目的：把仓库里最关键、最容易卡住的 20 段源码（以“函数/类/核心逻辑块”为粒度）抽出来，说明它在解决什么问题、为什么难、阅读时要抓住哪些变量/边界条件，并给出对照的最小化学习示例入口（`learning/`）。

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


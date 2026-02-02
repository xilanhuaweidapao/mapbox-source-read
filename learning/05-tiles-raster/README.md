# 05-tiles-raster：瓦片覆盖 + 并发加载 + 缓存（离线“伪瓦片”）

本例实现一个“迷你版 RasterTile 系统”，目的是理解仓库：

- `source/tile_id.js`（tile 坐标、wrap/world copies、URL 模板思想）
- `source/source_cache.js`（视口驱动：加载/卸载 tiles）
- `source/tile.js` / `source/tile_cache.js`（tile 生命周期/缓存）
- `render/draw_raster.js`（把 tile 贴到正确位置）

> 为避免跨域/CORS 与第三方瓦片服务依赖，本例用 **离线生成的伪瓦片**：每个 tile 都由 Canvas2D 画出颜色+z/x/y 文本，再上传为 WebGL 纹理。

## 你会学到什么

1. “可视瓦片集合”怎么计算：屏幕四角反投影到 Mercator，再映射到 tile x/y 范围  
2. 并发请求队列：`maxParallel` 控制，inFlight/queue 状态可视化  
3. 缓存策略：简单 LRU（按最近使用帧淘汰）  
4. 绘制：每个 tile 一个纹理，按 tile 的 origin/scale 投影到世界

## 操作方式

- 拖拽：平移  
- 滚轮：缩放（鼠标锚点）  
- `Q` / `E`：旋转  
- 面板：
  - `maxParallel`：最大并发“加载”数
  - `maxCache`：最大缓存 tile 数（LRU）
  - `showBorders`：显示 tile 边界

## 代码导读

- `getVisibleTiles()`：本例最核心的 GIS/瓦片逻辑（视口 → tile range）  
- `TileStore`：并发队列 + cache + texture 上传  
- `drawTile()`：把“unit quad + u_origin/u_scale + u_matrix”画到正确位置  

## 推荐发散练习

1. 把“伪瓦片”替换成真实 tile URL（注意 WebGL 对跨域图片的 CORS 要求）  
2. 加一个“优先级队列”：优先加载离中心更近的 tile  
3. 做一个更真实的 eviction：保留 parent tiles 防止空洞  
4. 把 tile 绘制做成批处理（尽量减少状态切换/纹理绑定）  


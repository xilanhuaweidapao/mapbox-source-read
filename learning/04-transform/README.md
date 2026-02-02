# 04-transform：最小 Transform（Mercator + pan/zoom/bearing）

本例实现一个“迷你版 Map Transform”，用于理解仓库 `geo/transform.js` 的核心思想：  
**在 Mercator 投影坐标系里维护 center/zoom/bearing，并生成一个矩阵把世界坐标映射到 clip space。**

## 你会学到什么

1. 坐标空间分层：LngLat → Mercator（[0,1]）→ world pixels → screen → clip  
2. `worldSize = tileSize * 2^zoom` 为什么是 Web 地图的核心尺度  
3. `pan`（拖拽）如何更新中心；`zoom` 如何围绕鼠标点缩放  
4. bearing（旋转）如何影响投影/反投影（project/unproject）

## 操作方式

- 鼠标左键拖拽：平移  
- 滚轮：缩放（以鼠标位置为锚点）  
- `Q` / `E`：旋转（bearing -/+ 10°）

## 如何验证

- 屏幕看到网格与点
- 面板上 center/zoom/bearing 实时变化
- 你能解释：为什么缩放会改变 `worldSize`

## 代码导读

- `main.js`：
  - 使用 `Transform2D`（`learning/_common/Transform2D.js`）
  - `transform.getMercatorToClipMatrix()`：核心矩阵
  - `transform.screenToMercator()`：反投影（用于“以鼠标为锚点缩放”）

## 与仓库对应

- `geo/transform.js`：真实引擎的 Transform（包含 pitch/fov/frustum/covering tiles 等更多内容）
- `geo/mercator_coordinate.js`：Mercator 公式与单位解释

## 推荐发散练习

1. 把网格改成 “tile 边界网格”（每一级 zoom 的 tile grid）  
2. 增加 pitch（倾斜）与透视投影（会进入 3D 矩阵与深度概念）  
3. 增加 `renderWorldCopies` 的可视化：跨越 ±180° 时如何表现  


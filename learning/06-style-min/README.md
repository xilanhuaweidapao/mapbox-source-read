# 06-style-min：最小 style JSON 驱动渲染（background/raster/circle）

本例把第 05 步的“瓦片渲染器”包进一个极简 Style 系统：

- `sources`：定义数据源（本例：raster + geojson 点）
- `layers`：按顺序绘制（background → raster → circle）
- `paint`：每种 layer 的最小 paint 属性（例如 `raster-opacity`）

## 你会学到什么

1. 为什么要用 style JSON：用数据描述渲染，而不是把逻辑写死  
2. render order（图层顺序）为何重要（尤其是透明混合）  
3. 把“渲染器能力”拆成 layer type：`background/raster/circle`  

## 如何验证

- 面板切换 Dark/Light 两套 style：背景色与点样式会变化  
- 调 `raster-opacity` 看透明叠加效果  
- 点是用 `gl.POINTS` + `gl_PointCoord` 画圆形（不是 DOM）

## 与仓库对应

- `style/style.js`：真实 Style 生命周期（加载、校验、diff、事件…）
- `style/style_layer/*`：每种 layer 的实现
- `style/properties.js`：属性系统（transition/表达式/数据驱动）

## 推荐发散练习

1. 加一个 `line` layer（用 `gl.LINES` 先画最简单版本）  
2. 支持 `paint` 的 transition（例如 opacity 随时间插值）  
3. 支持 style diff（只更新变更的 paint，不重建整个 style）  


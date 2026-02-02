# 07-vector-bucket：从 GeoJSON 构建 bucket（positions/indices/attrs）

本例实现一个“迷你版 Bucket 管线”，目标是理解仓库 `data/bucket/*` 的思想：  
把 feature 几何转换为 GPU 能画的 **顶点数组 + 索引数组 + 属性数组**。

> 注意：为保持最小化，本例的 polygon 三角化只支持“凸多边形”（使用 triangle fan）。真实引擎会使用更完整的三角剖分（并处理 holes 等）。

## 你会学到什么

1. bucket 为什么要拆出：`buildBucket(data)` 与 `drawBucket(bucket)`  
2. TypedArray 的价值：结构紧凑、可 transfer、上传到 GPU 高效  
3. `indices` 如何复用顶点，并控制三角形/线段的连接关系  
4. “颜色 attribute 用 UNSIGNED_BYTE + normalized=true” 的打包技巧

## 如何验证

- 你会看到：
  - 一个填充多边形（fill bucket）
  - 一条线（line bucket）
- 面板可切换 fill/line 开关

## 与仓库对应

- `data/bucket.js`：Bucket 抽象与反序列化
- `data/bucket/fill_bucket.js`、`data/bucket/line_bucket.js`：真实 bucket 构建逻辑
- `data/array_types.js`：真实工程里大量 StructArray/attribute 定义

## 推荐发散练习

1. 给 line 实现“粗线”三角带（triangle strip）替代 `gl.LINES`  
2. polygon 支持 holes（需要更完整的 triangulation）  
3. 把 buildBucket 挪到 worker（下一节 08 会做）  


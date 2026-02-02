# learning/ —— 由浅入深的最小示例（可直接跑）

这些示例用于配合 `LEARNING_PLAN.md` 学习本仓库的核心原理：  
从 **WebGL 基础闭环 → buffer/texture → 相机 Transform → 瓦片系统 → 样式驱动 → bucket → worker → stencil → symbol** 逐步搭建“迷你版引擎”。

## 如何运行

建议用静态服务器打开（避免 `file://` 下的模块/Worker 限制）：

- VS Code：右键 `index.html` → “Open with Live Server”
- 或任意静态服务（示例）：`python -m http.server`

然后访问：`http://localhost:8000/learning/.../index.html`

也可以直接打开导航页：`learning/index.html`

## 示例目录

- `learning/00-hello-webgl/`：画三角形（WebGL 最小闭环）
- `learning/01-program/`：封装 Program（缓存 location、切换 program）
- `learning/02-buffers/`：VertexBuffer/IndexBuffer + drawElements
- `learning/03-texture/`：纹理上传、过滤、premultiply alpha、flipY
- `learning/04-transform/`：最小 Transform（Mercator + pan/zoom/bearing）
- `learning/05-tiles-raster/`：瓦片覆盖计算 + 并发加载 + 缓存（用“伪瓦片”离线生成）
- `learning/06-style-min/`：最小 style JSON 驱动渲染（background/raster/circle）
- `learning/07-vector-bucket/`：从 GeoJSON 构建 bucket（positions/indices/attrs）
- `learning/08-worker-transfer/`：把 buildBucket 放进 Worker + transferable
- `learning/09-stencil-clip/`：用 stencil 做 tile clipping（两 pass）
- `learning/10-symbol-collision/`：最小 label 系统（atlas + 碰撞 + 淡入淡出）
- `learning/11-new-features/`：练手新功能合集（拾取/截图/调试开关等）

## 共享小工具

为减少重复样板代码，部分示例会复用 `learning/_common/`：

- `learning/_common/gl.js`：shader/program/buffer 小工具
- `learning/_common/Transform2D.js`：简化版 Mercator 2D 相机
- `learning/_common/ui.js`：简单的面板 UI 组件

每个示例目录都有 `README.md`，包含：

- 学习目标与关键概念
- 代码导读（从哪里开始看）
- 推荐发散练习（怎么继续扩展）

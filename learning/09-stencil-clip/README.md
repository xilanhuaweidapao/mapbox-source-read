# 09-stencil-clip：用 Stencil 做 tile clipping（两 pass）

真实的 Mapbox GL 渲染会用 stencil 做很多“裁剪/遮罩”工作，其中一个经典用途是 **tile clipping**：  
让瓦片内容严格限制在瓦片边界内，避免：

- 纹理线性过滤导致的边缘串色
- 某些图层（pattern/antialias）在 tile 边界处的 overdraw

本例演示一个最小可运行版本：

1. **Mask pass**：向 stencil 写入“tile 边界”  
2. **Content pass**：开启 stencil test，只允许 tile 边界内像素输出  

为了让效果更明显，本例故意把 tile 内容绘制为“略微放大”的 quad：  
没有 clip 时会互相覆盖；开启 clip 后会被 stencil 裁掉。

## 如何验证

- 面板切换 `clipEnabled`：
  - 关闭时：你会看到 tile 边缘的边框更“厚/乱”（overdraw）
  - 开启时：边缘变干净，覆盖被裁剪

## 与仓库对应

- `gl/stencil_mode.js` + `gl/value.js`：仓库对 stencil 状态的封装
- `render/program/clipping_mask_program.js` + `shaders/clipping_mask.*`：更完整的 clipping 管线

## 推荐发散练习

1. 用“递增/递减” stencil 实现嵌套裁剪（例如多层 mask）  
2. 把 stencil 逻辑封装成 `StencilMode` 对象（更接近仓库风格）  
3. 做一个 offscreen pass：先渲染到 FBO，再采样合成  


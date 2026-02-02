# 02-buffers：VertexBuffer / IndexBuffer + drawElements

## 你会学到什么

1. VBO（顶点缓冲）与 IBO/EBO（索引缓冲）的区别  
2. 为什么 `drawElements` 常见：复用顶点、减少数据量  
3. interleaved（交错）布局下的 `stride/offset` 如何计算  
4. 最小封装：`VertexBuffer` / `IndexBuffer` 类

## 如何验证

- 页面显示一个由两三角拼成的矩形  
- 拖动滑块会旋转矩形  
- 控制台会打印 stride/offset 等信息

## 代码导读

- `main.js`
  - `VertexBuffer`：`ARRAY_BUFFER` 上传与绑定
  - `IndexBuffer`：`ELEMENT_ARRAY_BUFFER` 上传与绑定
  - `gl.vertexAttribPointer(stride, offset)`：从交错数据里拆出 position/color
  - `gl.drawElements(gl.TRIANGLES, ...)`：按索引画

## 与仓库对应

- `gl/vertex_buffer.js` / `gl/index_buffer.js`：工程级封装（支持 StructArray）
- `render/vertex_array_object.js`：VAO/属性指针缓存（减少每帧重复绑定）

## 推荐发散练习

1. 把 interleaved 改成两个 buffer（pos/color 分离）并比较写法差异  
2. 把 index 改成 `gl.LINES` 画线框  
3. 做一个小的“动态 buffer”：每帧 updateData（对应仓库 dynamicDraw）  


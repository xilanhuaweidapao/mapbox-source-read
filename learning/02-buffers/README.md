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




这份文件是一个非常标准的 WebGL 入门样例：用 VBO + IBO 画一个矩形，并通过 uniform 让它旋转。

整体目标

把顶点数据（位置+颜色）传到 GPU。
用索引复用顶点，减少重复数据。
在顶点着色器里做旋转变换。
每帧调用 drawElements 绘制。
参考：main.js:74 main.js:82 main.js:113
按执行顺序学习这份代码

初始化 WebGL 和 UI
参考：main.js:35 main.js:40
canvas 来自页面：index.html:22

定义并编译着色器
参考：main.js:42 main.js:59 main.js:67
VS 里用旋转矩阵计算新坐标，FS 直接输出插值颜色。createProgram 的实现可看：gl.js:15

创建两种 Buffer（核心）
参考：main.js:4 main.js:19
VertexBuffer 绑定 ARRAY_BUFFER，IndexBuffer 绑定 ELEMENT_ARRAY_BUFFER。
indices=[0,1,2,0,2,3] 表示两个三角形拼矩形。参考：main.js:82

解释最关键的 stride/offset
参考：main.js:90 main.js:97 main.js:100
每个顶点布局是 [x, y, r, g, b]，共 5 个 float。
stride = 5*4 = 20 字节。
a_pos 偏移 0。
a_color 偏移 2*4 = 8 字节（跳过 x,y）。

渲染循环
参考：main.js:102
每帧做三件事：
resize + viewport、clear、uniform(angle)+drawElements。
这里 drawElements 的参数与你的索引类型严格对应：Uint16Array -> gl.UNSIGNED_SHORT。参考：main.js:82 main.js:113

你现在必须吃透的 3 个点

drawArrays 画“顺序顶点”，drawElements 画“索引指定顶点”。这个例子选择后者是为了复用顶点。
vertexAttribPointer 不是复制数据，而是告诉 GPU “怎么读已经上传好的 VBO”。
uniform 是“整次 draw 共用”的参数；attribute 是“每个顶点不同”的参数。
建议你立刻做的练习

把 indices 改错一个值（如 5），观察绘制异常。
把 colorOffset 改成 3*4，观察颜色错乱，理解 offset 意义。
把 gl.TRIANGLES 改成 gl.LINES，看几何拓扑如何变化。
如果你愿意，我下一步可以按“逐行提问-你作答-我纠正”的方式，带你做一遍这份文件的面试级理解。


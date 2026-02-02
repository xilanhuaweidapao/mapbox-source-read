# 01-program：封装 Program（缓存 location + 切换 program）

## 你会学到什么

1. 为什么要封装 Program：减少重复代码、集中处理编译/链接错误  
2. 为什么要缓存 `getAttribLocation/getUniformLocation`：查找 location 有成本  
3. 切换 program 时 attribute/uniform 的注意事项  

## 如何验证

- 你可以在右上角面板切换两套 program：
  - **VertexColor**：颜色来自顶点属性 `a_color`
  - **UniformColor**：颜色来自 uniform `u_color`，并随时间变化

## 代码导读

- `main.js`：
  1) `Program` 类：编译/链接 + location 缓存  
  2) 两套 shader 对比：一个用 `a_color`，一个用 `u_color`  
  3) 渲染循环里根据 UI 选择 program，并设置需要的 uniform  

## 与仓库对应

- `render/program.js`：真实工程里的 program 管理与缓存
- `render/vertex_array_object.js`：当 program 变化时，attribute 绑定如何高效更新（VAO/非 VAO）

## 推荐发散练习

1. 给 `Program` 加一个 `setUniform` 系列方法（float/vec2/mat4）  
2. 给 `Program` 加“自动发现 active uniforms/attribs”的调试输出  
3. 实现一个简单的“program cache”（同源码只编译一次）  


# 00-hello-webgl：WebGL 最小闭环（画一个三角形）

## 你会学到什么

1. WebGL 是“状态机”：一次 draw 依赖当前绑定的 program/buffer/属性指针等状态  
2. Shader（GLSL）编译/链接的错误如何定位  
3. `attribute`（每顶点）、`varying`（插值）、`gl_Position`（裁剪空间）是什么  
4. 最小渲染循环：resize → viewport → clear → draw

## 如何验证

- 打开页面后应看到一个彩色三角形
- 控制台会输出 WebGL/GLSL 版本与渲染器信息

## 代码导读（建议按顺序看）

1. `main.js`：`createProgram()` → `createBuffer()` → `vertexAttribPointer()` → `drawArrays()`
2. 看 vertex shader：把 `a_pos` 直接写到 `gl_Position`
3. 看 fragment shader：用插值后的 `v_color` 输出颜色

## 与仓库对应关系（读完本例再回读更快）

- `gl/context.js`：仓库里对 WebGL 状态/扩展的“工程化封装”
- `gl/value.js`：仓库为什么要缓存状态（避免重复 set）

## 推荐发散练习（很适合练手）

1. 把三角形改成随时间旋转（加一个 `u_time` uniform）  
2. 让颜色随时间渐变（`sin`/`cos`）  
3. 把顶点数据拆成两个 buffer：position 与 color 分离  
4. 试试把坐标写出 [-1,1] 范围会发生什么（裁剪）  


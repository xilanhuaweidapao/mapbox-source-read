# 11-new-features：练手新功能合集（拾取/截图/调试开关）

本例把前面若干步的能力“拼起来”，做 3 个常见新功能（也最能巩固原理）：

1. **Feature picking（拾取/点选高亮）**  
2. **Screenshot（截图导出）**  
3. **Debug overlay（tile 边界开关）**  

这些功能的意义：

- 拾取：让你真正理解“屏幕坐标 ↔ 世界坐标”的转换，以及交互态（selected）如何进入渲染  
- 截图：理解 GPU 输出如何回到用户（Canvas 导出 / readPixels）  
- 调试开关：学会做“可视化诊断”，对读引擎代码很重要  

## 如何验证

- 点击地图上的点：会高亮并在面板显示选中信息  
- 点击 “Screenshot” 会下载 PNG  
- 勾选 “show tile borders” 显示瓦片边界  

## 推荐发散练习

1. 把拾取改成“离屏颜色编码 picking”（每个 feature 一个颜色 id）  
2. 截图改成 `gl.readPixels`，并支持 offscreen FBO 截图  
3. 把 selected 状态改成“feature-state”：支持 hover/selected 不同样式  


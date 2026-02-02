# 10-symbol-collision：最小 Label 系统（atlas + 碰撞 + 淡入淡出）

Symbol/Label 是地图引擎里最复杂、最吃 CPU 的部分之一。  
本例实现一个“足够小但能看清原理”的版本，帮助你回读仓库 `symbol/*` 更顺畅。

## 本例做了什么（最小但完整的链路）

1. **数据**：生成一批点（lng/lat）+ 文本  
2. **Atlas**：用 Canvas2D 把所有文本打包进一张纹理（texture atlas）  
3. **每帧 placement**：
   - 计算每个 label 的屏幕 bbox
   - 网格（grid）碰撞检测：避免重叠
   - 维护 opacity 状态：placed → 渐入，unplaced → 渐出
4. **渲染**：把可见 labels 批量写入一个动态 VBO，再一次 drawElements 画出来

## 如何验证

- 勾选/取消 `collisionEnabled`：标签重叠是否变化  
- 勾选 `showBoxes`：显示放置后的 bbox  
- 调整 `cellSize`：碰撞粒度越大越“保守”，越小越精细但更慢  

## 与仓库对应

- `symbol/collision_index.js`、`symbol/grid_index.js`：碰撞数据结构与网格加速
- `symbol/placement.js`：placement + opacity 状态机（稳定性与淡入淡出）
- `render/glyph_manager.js` / `render/glyph_atlas.js`：更完整的 glyph 获取与 atlas 管理

## 推荐发散练习

1. 增加优先级排序：重要标签优先放置（减少“关键点被挤掉”）  
2. 支持“沿线标注”：把 anchor 放到 polyline 上并做重复/间距控制  
3. 做跨帧稳定：相同 label 尽量保持位置不抖动（接近 cross-tile 思想）  


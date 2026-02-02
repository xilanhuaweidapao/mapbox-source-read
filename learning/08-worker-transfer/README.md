# 08-worker-transfer：把 buildBucket 放进 Worker + transferable

本例在 07 的基础上，把 `buildBucket(GeoJSON)` 移到 Worker，模拟仓库：

- `util/dispatcher.js` / `util/actor.js`：主线程到 worker 的消息派发  
- `source/worker.js`：worker 侧入口（本例用一个更小的专用 worker）  
- `util/web_worker_transfer.js`：把对象序列化并把 ArrayBuffer 放到 transferables  

## 你会学到什么

1. 为什么要 worker：避免主线程被 CPU 重活阻塞（拖拽/缩放更流畅）  
2. transferable 的价值：`postMessage` 时 **零拷贝** 转移 `ArrayBuffer`  
3. 如何做性能分解：`build(ms)` vs `upload(ms)`  

## 如何验证

- 打开页面后会自动用 Worker 构建 bucket 并绘制  
- 面板提供：
  - `Rebuild in Worker`：worker 构建
  - `Rebuild in Main`：主线程构建（对比）
- 观察耗时变化（数据量越大差异越明显）

## 推荐发散练习

1. 把 worker 的结果做“增量更新”：只更新变更部分而不是全量重建  
2. 让 worker 支持多个图层/多种 bucket 类型（更接近真实引擎）  
3. 引入“任务队列 + 取消”（快速缩放时取消过时任务）  


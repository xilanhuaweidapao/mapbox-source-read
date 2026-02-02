# 03-texture：纹理上传、过滤、premultiply alpha、flipY

## 你会学到什么

1. 纹理基本概念：Texture Unit、`sampler2D`、`texImage2D`  
2. 过滤方式：`NEAREST` vs `LINEAR`（以及 mipmap 的背景知识）  
3. `UNPACK_FLIP_Y_WEBGL` 与 `UNPACK_PREMULTIPLY_ALPHA_WEBGL` 的作用  
4. 为什么透明边缘经常“发黑/发白”（premultiply 与 blendFunc 配套）  

## 如何验证

- 你会看到一个带透明边缘的贴图矩形  
- 切换：
  - Filter（NEAREST/LINEAR）
  - flipY
  - premultiplyAlpha
- 观察透明边缘的变化（尤其在 premultiply 切换时）

## 代码导读

- `main.js`
  - `makeTestCanvas()`：用 Canvas2D 生成一张带透明边缘的“测试图”
  - `uploadTexture()`：演示 `pixelStorei` + `texImage2D` + `texParameteri`
  - shader：顶点传 UV，片元采样 `texture2D(u_tex, v_uv)`

## 与仓库对应

- `gl/context.js`：对 `pixelStoreUnpack*` 的封装与默认值管理
- `render/texture.js`：纹理对象封装与参数设置
- `render/image_manager.js`：sprite/pattern 的 atlas 维护（更复杂的“纹理上层系统”）

## 推荐发散练习

1. 增加 mipmap：比较 minFilter 为 `LINEAR_MIPMAP_LINEAR` 的效果（注意 NPOT 限制）  
2. 叠加两张纹理（多纹理单元）：体验 `activeTexture` 与多个 sampler  
3. 用 `readPixels` 截图对比 premultiply 开/关的结果  


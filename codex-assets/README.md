# codex-assets

Codex 前端高质量流程的可复用资产目录。

## 目录

1. `contracts/`：前端契约类型（DesignTokens、PageConfig、ApiResponse、DoneDefinition）
2. `templates/`：输入包、结构化提示词、验收模板
3. `prompt-library/`：6 类常用任务的提示词模板
4. `checklists/`：质量门禁与测试矩阵检查表

## 使用顺序

1. 先填写 `templates/input-pack.template.md`
2. 再拼接 `templates/structured-prompt.template.md`
3. 任务完成前按 `templates/done-definition.template.md` 验收
4. 最后跑 `checklists/quality-gate.checklist.md`


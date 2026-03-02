# Codex Frontend Playbook

面向个人开发者的高质量工作流，覆盖前端大屏和通用网页制作。

## 1. 目标与原则

目标是建立一套可复制、可验收、可持续的 Codex 使用流程。

核心原则：

1. 先定义约束与验收标准，再让 Codex 生成代码。
2. 每次只交付一个清晰目标，不混合多个大任务。
3. 每轮必须附验证证据，无证据不宣称完成。
4. 优先高质量一次交付，不默认先快后补。

## 2. 文件与资产结构

本手册配套资产在 `codex-assets/`：

1. 合同定义：`codex-assets/contracts/frontend-contracts.ts`
2. 输入包模板：`codex-assets/templates/input-pack.template.md`
3. 结构化提示词模板：`codex-assets/templates/structured-prompt.template.md`
4. 验收定义模板：`codex-assets/templates/done-definition.template.md`
5. Prompt 库：`codex-assets/prompt-library/*.prompt.md`
6. 质量与测试清单：`codex-assets/checklists/*.checklist.md`

## 3. 关键接口契约

使用前先固定契约，禁止让 Codex 猜接口。

```ts
export type DesignTokens = {
  color: Record<string, string>;
  spacing: Record<string, number>;
  fontSize: Record<string, number>;
  shadow: Record<string, string>;
  zIndex: Record<string, number>;
  breakpoints: Record<string, number>;
};

export type PageConfig = {
  mode: "dashboard" | "web";
  dataSources: Array<{
    id: string;
    endpoint: string;
    method: "GET" | "POST";
    refreshMs?: number;
    auth?: "none" | "token" | "cookie";
    fallback?: "stale-cache" | "empty-state" | "retry-only";
  }>;
  permissions: Array<string>;
  runtime: {
    env: "dev" | "test" | "prod";
    browserSupport: string[];
    targetFps?: number;
  };
};

export type ComponentContract<Props, Emits extends string> = {
  name: string;
  props: Props;
  emits: Emits[];
  emptyState: string;
  errorState: string;
};

export type ApiResponse<T> = {
  success: boolean;
  code: string;
  message: string;
  data: T | null;
  requestId?: string;
  ts?: number;
};

export type DoneDefinition = {
  functional: string[];
  visual: string[];
  performance: string[];
  accessibility: string[];
  tests: string[];
};
```

完整版本见 `codex-assets/contracts/frontend-contracts.ts`。

## 4. 执行流程（高质量优先）

### 阶段 A：上下文打包

先填写输入包模板，包含：

1. 目标用户与关键场景
2. 页面清单与范围边界
3. 品牌风格锚点与禁用风格
4. 技术栈与运行环境
5. 性能预算与验收标准
6. 禁止行为（不改无关文件、不绕过测试）

### 阶段 B：结构化提示词

将输入包 + 合同定义 + DoneDefinition 一起喂给 Codex，使用统一模板。

### 阶段 C：四轮迭代

1. 第 1 轮：信息架构与骨架（路由、布局、状态边界）
2. 第 2 轮：核心功能与数据流（API、错误处理、重试）
3. 第 3 轮：视觉与交互细化（空态/错态、A11y）
4. 第 4 轮：性能与测试闭环（代码分割、自动化验证）

每轮输出必须包含：

1. 变更摘要
2. 受影响文件
3. 风险点
4. 验证命令
5. 验证结果证据

### 阶段 D：质量门禁

执行 `codex-assets/checklists/quality-gate.checklist.md`，全部通过才可结束。

## 5. 大屏分支策略

大屏默认额外要求：

1. 固定画布比例与缩放规则明确定义（例如 1920x1080 基准）。
2. 图表刷新频率与数据退化策略明确（弱网或接口失败时不崩）。
3. 长时间运行稳定性：检查内存趋势、定时器泄漏、事件解绑。
4. 目标 FPS 与渲染预算明确（例如 55~60 FPS）。
5. 优先可观测性：关键渲染与数据刷新打日志/指标。

## 6. 网页分支策略

网页默认额外要求：

1. 语义化结构与可访问性（键盘、焦点、ARIA、对比度）。
2. 响应式断点与内容重排策略（360/768/1024/1440）。
3. SEO 相关要素（标题、描述、结构化语义）。
4. 表单可用性（错误可读、可恢复、可重试）。
5. 信息层级优先，视觉效果服从可读性。

## 7. 测试矩阵（必须执行）

1. 功能流：关键用户路径 + 加载/空态/错态/重试/权限受限
2. 适配流：大屏 `1920x1080`、`3840x2160`；网页 `360/768/1024/1440`
3. 可访问性：键盘可达、焦点可见、语义标签、表单错误提示
4. 性能：首屏、交互延迟、长列表/图表刷新、内存趋势
5. 回归：核心组件快照或视觉回归，关键逻辑单测/集成测试
6. 稳定性：弱网、超时、后端失败情况下可恢复

清单化版本见 `codex-assets/checklists/test-matrix.checklist.md`。

## 8. Codex 操作规范

1. 一次只提一个明确目标
2. 每次需求都包含三件套：文件路径 + 约束 + 验收标准
3. 先让 Codex 给计划，再进入编码
4. 每轮都要求执行验证并回传证据
5. 视觉任务给风格锚点和禁用风格，防模板化输出
6. 大屏任务优先稳定性与可观测性
7. 网页任务优先可访问性与信息结构

## 9. 推荐最小执行命令集合

根据项目技术栈选用：

1. `npm run lint`
2. `npm run test`
3. `npm run build`
4. `npm run test:e2e` 或 Playwright/Cypress 对应命令

无法自动执行的验证（如视觉回归）也要提供截图和检查记录。

## 10. 快速开始

1. 复制 `input-pack.template.md` 填完上下文
2. 复制 `structured-prompt.template.md` 作为首轮提示词
3. 在每轮末尾附 `done-definition.template.md` 检查项
4. 选择对应 prompt 库模板（页面搭建/重构/性能/测试/修复/评审）
5. 结束前跑完整质量门禁


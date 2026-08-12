# 多语言与主题适配结构

核验日期：2026-08-04  
结构证据更新：2026-08-11（Web 已迁 Vite SPA；下文 Next 路径作废）

本快照只保留仍成立的 Decision；历史 Next App Router / `next-intl` 结构调研不再当作实现证据。

## Decision（仍有效）

- Runtime 不持有翻译、locale Provider 或主题状态；字典与纯函数在 `src/web/i18n`。
- 使用带类型约束的 `.ts` locale 文件（`en-US` / `zh-CN`），而不是 JSON；进入翻译供应商流程后再评估 JSON/ICU。
- 协议里的 `READY`、`RUNNING`、Attempt / Verification 状态是稳定机器值；只在 UI 映射成文案。
- 颜色通过 `globals.css` 语义 token（`:root` / `.dark`）；组件不复制 dark/light 分支。

## 当前结构（Observed）

```text
src/web/i18n/
  index.ts
  locales.ts
  messages/en-US.ts
  messages/zh-CN.ts
src/web/app.tsx          # locale Router（Vite SPA）
src/web/app/globals.css  # 语义主题 token
```

## 证据边界

- `Implementation evidence`：字典、locale 检测与插值有 `tests/web` / i18n 相关测试覆盖。
- `Not verified`：真实浏览器系统主题首屏无闪烁、跨标签同步、翻译供应商导入、第三种语言。
- 外部 Next / `next-intl` / `react-i18next` 文档仅作行业常见做法参考，**不描述本仓库当前物理结构**。

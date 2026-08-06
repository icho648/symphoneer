# Acceptance — Agent Map

这里存放需要人执行或判断的验收流程，包括真实 Host 兼容性、视觉/交互检查和业务语义决定；它们不进入 `pnpm test`。

## 目录结构

```text
acceptance/
  host/          Codex 等真实 Host 或外部客户端兼容性
  *.md           产品体验、交互、视觉或业务语义判断
```

`host/` 中的流程通常也是手动 Smoke，但 Smoke 是用途，不是目录层级。每个流程应记录固定前置条件、版本、操作步骤、预期结果、实际证据和最终决定；未执行的流程保持 `NOT_RUN` 或 `NOT_VERIFIED`。

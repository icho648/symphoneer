# OpenAI Symphony 的运行时边界

核实日期：2026-07-30

> **Superseded（2026-08-09）：** 本快照的定位结论已被固定 commit 证据覆盖。  
> 请改读：
>
> - 产品表面、对话非目标、Verification / Blocked / 重试 / PR：[`2026-08-09-openai-symphony-product-surface.md`](2026-08-09-openai-symphony-product-surface.md)
> - Workspace 布局与清理：[`2026-08-09-openai-symphony-workspace-layout.md`](2026-08-09-openai-symphony-workspace-layout.md)
> - 规范性合同：[`../references/symphony-spec.md`](../references/symphony-spec.md)

早期一句话判断仍成立，但不再单独保留长文：Symphony 是 Issue 驱动的 scheduler/runner 与 tracker reader，不是看板、聊天产品或通用 Workflow Engine。

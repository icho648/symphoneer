# Symphoneer Docs — Agent Map

本文件是 `docs/` 的总入口，负责文档路由、事实源归属和共同写入规则。根 [`../AGENTS.md`](../AGENTS.md) 的仓库规则继续适用；只读取当前任务对应的叶子文档。

## 读取路由

| 任务 | 先读 | 再按需读取 |
|---|---|---|
| 产品是什么、不是什么 | [`design-docs/product-boundary.md`](design-docs/product-boundary.md) | `system-boundaries.md` |
| 判断原则、Module 与 Seam 取舍 | [`design-docs/core-beliefs.md`](design-docs/core-beliefs.md) | `system-boundaries.md` |
| 对象权威、Runtime、存储与控制 | [`design-docs/system-boundaries.md`](design-docs/system-boundaries.md) | 对应 reference |
| 用户可观察流程与验收 | [`product-specs/manual-delivery-flow.md`](product-specs/manual-delivery-flow.md) | 相关 design doc |
| Symphony 外部契约 | [`references/symphony-spec.md`](references/symphony-spec.md) | `system-boundaries.md` |
| Codex App Server 外部契约 | [`references/codex-app-server.md`](references/codex-app-server.md) | `system-boundaries.md` |
| GitHub Issues 外部契约 | [`references/github-issues.md`](references/github-issues.md) | `product-boundary.md` |
| 调研输入与历史方案 | [`research/AGENTS.md`](research/AGENTS.md) | 对应日期快照 |
| 复杂任务、进度与恢复 | [`plans/AGENTS.md`](plans/AGENTS.md) | 对应 active plan |

## 事实源与写入规则

- `design-docs/` 保存确认后的产品与架构决定。
- `product-specs/` 保存用户可观察行为和验收条件，不重复系统职责。
- `references/` 保存外部契约、核验日期和项目采用差异；外部来源不能证明本项目已经实现。
- `research/` 保存带日期的分析输入；不能自动覆盖设计决定。
- `plans/` 保存需要本地恢复上下文的可选执行状态和历史；GitHub Issue 才是 Issue-driven 增量的目标、范围、依赖和验收事实源。
- 新增或删除叶子文档时，更新本文件或最近的局部 `AGENTS.md`。只有某个目录需要独立路由、生命周期或按需加载规则时，才增加局部 `AGENTS.md`。
- 每份规范性文档分别记录 `Decision status` 与 `Implementation evidence`；易变化的命令、测试数量和停点记录在关联 Issue/PR，只有本地恢复需要时才同步到 active plan。
- 研究材料必须链接它支持或质疑的设计文档；外部契约必须记录来源和核验日期。
- 根 [`../ARCHITECTURE.md`](../ARCHITECTURE.md) 只描述当前真实结构；目标设计留在 `design-docs/`。

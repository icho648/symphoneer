# Symphoneer Docs — Agent Map

本文件是 `docs/` 的总入口，负责文档路由、事实源归属和共同写入规则。根 [`../AGENTS.md`](../AGENTS.md) 的仓库规则继续适用；只读取当前任务对应的叶子文档。

## 读取路由

| 任务 | 先读 | 再按需读取 |
|---|---|---|
| 产品是什么、不是什么 | [`design-docs/product-boundary.md`](design-docs/product-boundary.md) | `system-boundaries.md` |
| 判断原则、Module 与 Seam 取舍 | [`design-docs/core-beliefs.md`](design-docs/core-beliefs.md) | `system-boundaries.md` |
| 对象权威、Runtime、存储与控制 | [`design-docs/system-boundaries.md`](design-docs/system-boundaries.md) | 对应 reference |
| 用户可观察流程与验收 | [`product-specs/delivery-flow.md`](product-specs/delivery-flow.md) | 相关 design doc |
| Symphony 外部契约 | [`references/symphony-spec.md`](references/symphony-spec.md) | `system-boundaries.md` |
| Codex App Server 外部契约 | [`references/codex-app-server.md`](references/codex-app-server.md) | `system-boundaries.md` |
| GitHub Issues 外部契约 | [`references/github-issues.md`](references/github-issues.md) | `product-boundary.md` |
| 调研输入与历史方案 | [`research/AGENTS.md`](research/AGENTS.md) | 对应日期快照 |
| 复杂任务、进度与恢复 | [`plans/AGENTS.md`](plans/AGENTS.md) | 对应 active plan |

## 事实源与写入规则

- `design-docs/` 维护当前确认的产品与架构决定；决定变化时直接改写当前规则，不追加 Issue/PR 变更日志或实现流水账。只保留必要的高层实现状态，具体改动、命令、测试数量和停点写在 Issue/PR。
- `product-specs/` 维护用户可观察行为和验收条件，不重复系统职责。
- `references/` 维护外部契约、来源、核验日期和项目采用差异；外部来源不能证明本项目已实现。
- `research/` 维护带日期的分析输入和历史方案，不能自动覆盖设计决定；研究材料应链接支持或质疑的规范性文档。
- `plans/` 只维护本地恢复上下文和跨 Issue 协调；Issue/PR 承载增量目标、范围、验收、进度和验证。
- 规范性文档按根规则区分 `Decision status` 与 `Implementation evidence`；根 [`../ARCHITECTURE.md`](../ARCHITECTURE.md) 只描述当前真实结构，目标设计留在 `design-docs/`。
- 新增或删除叶子文档时更新本文件或最近的局部 `AGENTS.md`；只有需要独立路由、生命周期或按需加载规则时才增加局部文件。

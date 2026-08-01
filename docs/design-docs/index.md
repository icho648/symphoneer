# Design Docs

这是规范性设计的索引。只打开当前问题对应的叶子文档；调研、外部契约和执行计划不能自动覆盖这里的确认结论。

## 当前文档

| 文档 | 回答什么 | Decision status | Implementation evidence |
|---|---|---|---|
| [product-boundary.md](product-boundary.md) | 产品是什么、不是什么 | Accepted | Not verified |
| [core-beliefs.md](core-beliefs.md) | 哪些原则指导产品和工程取舍 | Accepted | Not verified |
| [system-boundaries.md](system-boundaries.md) | Task、Attempt、Workspace、Thread、Verification 等事实归谁 | Accepted | Not verified |

## 当前顺序

1. 人工审核已确认的产品边界、系统权威和人工交付流程。
2. 以 [`../exec-plans/active/symphony-workbench-v1.md`](../exec-plans/active/symphony-workbench-v1.md) 作为实施与验收路线，但不把计划当成已实现事实。
3. 只有在用户明确进入开发阶段后，才创建代码、依赖、CI、自动化或外部资源。

## 后续细化规则

Symphony Runtime、Provider 边界、Web / MCP 访问面和 Phoenix 的方向已确认；但真实 Schema、失败模式和兼容性仍为 `Not verified`。开发时先在 active ExecPlan 记录证据，只在决定稳定且需要长期维护时新增规范性叶子，不提前创建空壳。

项目级 Harness 继续由仓库文档、检查和执行计划承载，不创建 Workbench 产品的 Harness / Finding 规格。

## 写入规则

- 只有议题进入当前讨论并已有来源、方案取舍或确认决定时，才创建新叶子文档。
- 每份文档分别记录 `Decision status` 与 `Implementation evidence`。
- 外部事实链接到 [`../references/index.md`](../references/index.md)，历史分析链接到 [`../research/index.md`](../research/index.md)。
- 根 [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) 只描述当前真实结构；目标设计保留在本分区。

# Design Docs

这是规范性设计的索引：产品边界定义产品身份、范围和非目标；系统边界定义事实与控制归属；核心原则定义取舍方式。用户可观察行为和验收见 [`../product-specs/`](../product-specs/)。调研、外部契约和执行计划不能自动覆盖这里的确认结论。

## 当前文档

| 文档 | 回答什么 | Decision status | Implementation evidence |
|---|---|---|---|
| [product-boundary.md](product-boundary.md) | 产品是什么、不是什么 | Accepted | Not verified |
| [core-beliefs.md](core-beliefs.md) | 哪些原则指导产品、Module、Seam 与测试取舍 | Accepted | Not verified |
| [system-boundaries.md](system-boundaries.md) | 对象事实归谁，Runtime / Web 如何分进程，以及日志、事件和证据如何分层 | Accepted | Not verified |

## 阅读顺序

1. [product-boundary.md](product-boundary.md)：产品主干、V1 范围和非目标。
2. [core-beliefs.md](core-beliefs.md)：判断原则。
3. [system-boundaries.md](system-boundaries.md)：对象关系、权威、证据和控制。
4. [`../product-specs/manual-delivery-flow.md`](../product-specs/manual-delivery-flow.md)：可观察人工闭环。

## 后续细化规则

独立 Runtime、普通 Next.js Web、Agent Runner Seam、Web / CLI / MCP 访问面和 Phoenix 的方向已确认；真实 Schema、失败模式和兼容性仍为 `Not verified`。Intent 拆解、Sub-issue 编排、同一 Task 多 Thread 和第二个生产 Agent Adapter 属于后续扩展，不进入当前 V1 核心闭环。

## 写入规则

- 只有议题进入当前讨论并已有来源、方案取舍或确认决定时，才创建新叶子文档。
- 每份文档分别记录 `Decision status` 与 `Implementation evidence`。
- 外部事实链接到 [`../references/index.md`](../references/index.md)，历史分析链接到 [`../research/index.md`](../research/index.md)。
- 根 [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md) 只描述当前真实结构；目标设计保留在本分区。

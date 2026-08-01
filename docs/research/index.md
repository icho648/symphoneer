# Research

这里保存带日期的调研快照、外部文章分析和历史方案。它们是证据输入，不是自动生效的产品决定。

## 快照目录

| 文档 | 日期 | 当前作用 | 与规范性设计的关系 |
|---|---|---|---|
| [AI Coding 工程化：个人项目的组件边界](2026-07-30-AI-Coding工程化_个人项目边界.md) | 2026-07-30 | Evidence、Harness、MCP、Phoenix 的取舍输入 | 旧产品形态已被取代；以 [`product-boundary.md`](../design-docs/product-boundary.md) 为准 |
| [Agent Orchestrator、Conductor 与 Symphony Workbench](2026-07-30-agent-orchestrator-conductor-vs-symphony-workbench.md) | 2026-07-30 | 同类产品对象与默认心智比较 | 支持产品差异分析，不证明任何集成已实现 |
| [OpenAI Symphony 的运行时边界](2026-07-30-symphony-runtime-boundaries.md) | 2026-07-30 | Scheduler/Runner、Workspace、重试和非目标输入 | 支持 [`system-boundaries.md`](../design-docs/system-boundaries.md)；实现仍未验证 |
| [Codex 编排控制面与 Workbench 映射](2026-08-01-Codex编排控制面与Workbench映射.md) | 2026-08-01 | Codex 入口、会话与控制原语的分析 | 原始文章不是官方规范；具体行为必须回到官方 Schema 和 Smoke |
| [Harness Builder 与 Symphony：一手资料边界](harness-builder-symphony.md) | 2026-07-30 | Harness 与 Symphony 的衔接输入 | 旧的 Harness 产品增强形态已被“项目级开发基建”决定取代；以 [`core-beliefs.md`](../design-docs/core-beliefs.md) 和 active ExecPlan 为准 |

## 使用规则

- 每份快照保留来源、核验日期和 `Observed` / `Not verified` 状态。
- 新资料优先新增日期快照，不覆盖历史判断；若旧结论被取代，明确链接新的规范性文档。
- 设计结论写回 [`../design-docs/index.md`](../design-docs/index.md)，不能只停留在 research。
- 只有当前任务需要时才读取对应快照，不全量加载。

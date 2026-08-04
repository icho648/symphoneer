# Research — Agent Map

这里保存带日期的调研快照、外部文章分析和历史方案。它们是证据输入，不是自动生效的产品决定；只读取当前任务需要的快照。

## 快照目录

| 文档 | 当前作用 | 与规范性设计的关系 |
|---|---|---|
| [AI Coding 工程化：个人项目的组件边界](2026-07-30-AI-Coding工程化_个人项目边界.md) | Evidence、Harness、MCP、Phoenix 的早期取舍输入 | 旧产品形态已被取代；以 [`../design-docs/product-boundary.md`](../design-docs/product-boundary.md) 为准 |
| [Agent Orchestrator、Conductor 与 Symphoneer](2026-07-30-agent-orchestrator-conductor-vs-symphoneer.md) | 同类产品对象与默认心智比较 | 支持产品差异分析，不证明任何集成已实现 |
| [OpenAI Symphony 的运行时边界](2026-07-30-symphony-runtime-boundaries.md) | Scheduler、Workspace、重试和非目标输入 | 支持 [`../design-docs/system-boundaries.md`](../design-docs/system-boundaries.md)；实现仍未验证 |
| [Codex 编排控制面与 Symphoneer 映射](2026-08-01-Codex编排控制面与Symphoneer映射.md) | Codex 入口、会话与控制原语分析 | 原始文章不是官方规范；具体行为回到官方 Schema 和 Smoke |
| [Anthropic 长时运行 Agent Harness](2026-08-02-anthropic-long-running-agent-harness.md) | 渐进上下文、增量任务、交接与恢复 | 支持项目 Harness；Planner、Evaluator 与多 Agent 不进入产品范围 |
| [多语言与主题适配结构](2026-08-04-i18n-theme-structure.md) | Web 内部的 locale/message、路由和明暗主题 | 实现已落在 `src/web/i18n` 与 `src/web`；更多语言、ICU 复数和翻译流程仍未验证 |

## 局部规则

- 每份快照记录来源、核验日期和 `Observed` / `Not verified` 状态，并链接支持或质疑的规范性文档。
- 新资料新增日期快照，不覆盖历史判断；结论改变时更新对应 `design-docs/`，不能只停留在 Research。
- 新增或删除快照时更新本文件。

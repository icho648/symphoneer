# Symphony Workbench

> 一个计划中的、以 OpenAI Symphony 为运行核心的非官方、本地优先 Coding Agent 交付工作台与求职 Demo。

## 当前阶段

本轮只允许建立文档化产品契约和本地 Git 基线：没有应用代码、依赖、CI、自动化或外部资源，也没有运行 Symphony、Codex App Server、Phoenix 或 MCP Server。

如果本页来自包含 active ExecPlan 的初始 `HEAD`，且 `git status --short` 与 `git remote` 均无输出，则仅 Markdown 的本地 Git 基线已建立；否则它仍是待完成项。后续只有在人工审核 active ExecPlan 并明确要求开发后，才进入代码阶段。

## 当前状态

| 议题 | Decision status | Implementation evidence | 事实源 |
|---|---|---|---|
| 产品定位与非目标 | Accepted | Not verified | [`product-boundary.md`](docs/design-docs/product-boundary.md) |
| 核心原则 | Accepted | Not verified | [`core-beliefs.md`](docs/design-docs/core-beliefs.md) |
| 对象、事实源与职责 | Accepted | Not verified | [`system-boundaries.md`](docs/design-docs/system-boundaries.md) |
| 第一条人工交付流程 | Accepted | Not verified | [`manual-delivery-flow.md`](docs/product-specs/manual-delivery-flow.md) |
| Symphony、Codex、GitHub 的采用方向 | Accepted | Not verified | [`references/`](docs/references/) |

决定已固化为规范性文档，实施顺序、验收和恢复要求见 [`symphony-workbench-v1.md`](docs/exec-plans/active/symphony-workbench-v1.md)。它是计划，不是已实现证据。

## 从哪里开始

- Agent 导航和工作规则：[`AGENTS.md`](AGENTS.md)
- 当前真实仓库结构：[`ARCHITECTURE.md`](ARCHITECTURE.md)
- 产品与架构决定：[`docs/design-docs/index.md`](docs/design-docs/index.md)
- 用户可观察流程：[`docs/product-specs/index.md`](docs/product-specs/index.md)
- 外部契约：[`docs/references/index.md`](docs/references/index.md)
- 调研快照：[`docs/research/index.md`](docs/research/index.md)
- ExecPlan 规则：[`docs/PLANS.md`](docs/PLANS.md)
- 当前开发计划：[`docs/exec-plans/active/symphony-workbench-v1.md`](docs/exec-plans/active/symphony-workbench-v1.md)

## 已确认边界

完整结论只维护在 [`product-boundary.md`](docs/design-docs/product-boundary.md)。这里仅保留最短摘要：

- 产品围绕 Tracker Task 的交付推进和人工掌控，而不是 Agent 数量组织。
- Symphony Runtime 是计划中的运行核心，Codex App Server 是首版 Agent Runtime。
- GitHub Issues 是 V1 Tracker；Workbench 不替代 Tracker、Pull Request、Code Review 或 Codex App。
- V1 以本地服务和 Web Dashboard 为主操作面，MCP 提供查询和受控操作；Electron 后置。
- Phoenix 只在 Symphony 交付闭环完成后作为非阻塞诊断扩展。
- 先形成一条可观察、可判定的人工基线，再决定自动化范围。

所有真实运行、兼容性、质量、效率和求职效果仍为 `Not verified`。

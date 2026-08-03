# Symphoneer

> 一个计划中的、以 OpenAI Symphony 为运行核心的非官方、本地优先 Coding Agent 交付工作台。

## 项目状态

Symphoneer 仍处于早期开发，尚未提供可运行发行版。当前工作范围与验收以 [GitHub Issues](https://github.com/icho648/symphoneer/issues) 为准，跨 Issue 的实施顺序、进度和恢复信息见 [active plan](docs/plans/active/symphoneer-v1.md)；README 不复制易漂移的当前阶段。

## 仓库入口

- Repository contract：[`.symphoneer/WORKFLOW.md`](.symphoneer/WORKFLOW.md)
- 版本化边界 Schema：[`packages/contracts/src/index.ts`](packages/contracts/src/index.ts)
- Workflow / eligibility / scheduler / WorkspaceManager / Agent Runner：[`packages/symphony-core/src/index.ts`](packages/symphony-core/src/index.ts)
- GitHub、Git worktree、Codex App Server 与 Verification Adapter：[`packages/adapters/src/index.ts`](packages/adapters/src/index.ts)
- 确定性测试：[`tests/`](tests/)
- 全量检查：`pnpm check`

## 项目文档

- Agent 导航和工作规则：[`AGENTS.md`](AGENTS.md)
- 当前真实仓库结构：[`ARCHITECTURE.md`](ARCHITECTURE.md)
- 文档总入口和事实源：[`docs/AGENTS.md`](docs/AGENTS.md)
- 调研快照入口：[`docs/research/AGENTS.md`](docs/research/AGENTS.md)
- Plan 规则与状态：[`docs/plans/AGENTS.md`](docs/plans/AGENTS.md)
- 当前开发计划：[`docs/plans/active/symphoneer-v1.md`](docs/plans/active/symphoneer-v1.md)

## 已确认边界

完整结论只维护在 [`product-boundary.md`](docs/design-docs/product-boundary.md)。这里仅保留最短摘要：

- 产品围绕 Tracker Task 的交付推进和人工掌控，而不是 Agent 数量组织。
- Symphoneer Runtime 以固定 Symphony SPEC 为调度与协调核心，Codex App Server 是首版 Agent Runtime。
- GitHub Issues 是 V1 Tracker；Symphoneer 不替代 Tracker、Pull Request、Code Review 或 Codex App。
- V1 规划为独立的 Node.js + TypeScript Runtime 与普通 Next.js Web 进程；CLI 和 Web 都是 Runtime 的客户端，不使用 Next.js custom server。
- Codex App Server 是唯一 V1 生产 Agent Adapter；Claude Agent SDK、OpenCode Server 和 Electron 仅保留后续评估入口。
- Web Dashboard 是主操作面，MCP 提供查询和受控操作；Electron 后置。
- Phoenix 只在 Symphony 交付闭环完成后作为非阻塞诊断扩展。
- 先形成一条可观察、可判定的人工基线，再决定自动化范围。

所有真实运行、兼容性、质量和效率仍为 `Not verified`。

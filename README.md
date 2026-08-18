# Symphoneer

> 一个以 OpenAI Symphony 为运行核心的非官方、本地优先 Coding Agent 交付工作台。

## 项目状态

Symphoneer 仍处于早期开发，仓库已提供可运行的 Runtime、Web、CLI 与 MCP 开发入口，但尚无发行版。当前工作范围与验收以 [GitHub Issues](https://github.com/icho648/symphoneer/issues) 为准；Issue #47 的本地恢复信息见 [active plan](docs/plans/active/issue-47.md)。确定性测试覆盖自动调度主线；真实 GitHub/Codex/Desktop Host Smoke 在获得匹配证据前仍为 `Not verified`。

## 仓库入口

- 受管项目契约：目标仓库 `.symphoneer/WORKFLOW.md`
- 版本化边界 Schema：[`src/contracts/index.ts`](src/contracts/index.ts)
- Runtime Core / Workflow / Scheduler / Workspace：[`src/runtime/index.ts`](src/runtime/index.ts)
- Executor：[`src/runtime/executor/index.ts`](src/runtime/executor/index.ts)
- Tracker：[`src/runtime/tracker/index.ts`](src/runtime/tracker/index.ts)
- Verification：[`src/runtime/verification/index.ts`](src/runtime/verification/index.ts)
- MCP（STDIO 查询与受控操作）：[`src/mcp/index.ts`](src/mcp/index.ts)（Host 拉起 `pnpm mcp:serve`；需先有 loopback Runtime）
- 确定性测试：[`tests/`](tests/)
- 全量检查：`pnpm check`

本地一键启动 Runtime + Web：

```bash
pnpm dev
```

MCP 由 Codex 等 Host 按需 STDIO 拉起，不要和 `pnpm dev` 抢同一个进程。Codex 配置示例：

```toml
[mcp_servers.symphoneer]
command = "pnpm"
args = ["--silent", "mcp:serve"]
cwd = "/absolute/path/to/symphoneer"
```

`pnpm` 不加 `--silent` 时会把生命周期日志写到 stdout，污染 STDIO JSON-RPC；也可用 `command = "node"`、`args = ["src/mcp/stdio.ts"]`。

## 项目文档

- Agent 导航和工作规则：[`AGENTS.md`](AGENTS.md)
- 当前真实仓库结构：[`ARCHITECTURE.md`](ARCHITECTURE.md)
- 文档总入口和事实源：[`docs/AGENTS.md`](docs/AGENTS.md)
- 调研快照入口：[`docs/research/AGENTS.md`](docs/research/AGENTS.md)
- Plan 规则与状态：[`docs/plans/AGENTS.md`](docs/plans/AGENTS.md)
- 当前本地恢复计划：[`docs/plans/active/issue-47.md`](docs/plans/active/issue-47.md)

## 已确认边界

完整结论只维护在 [`product-boundary.md`](docs/core-concepts/product-boundary.md)。这里仅保留最短摘要：

- 产品围绕 Tracker Task 的交付推进和人工掌控，而不是 Agent 数量组织。
- Symphoneer Runtime 以固定 Symphony SPEC 为调度与协调核心，Codex App Server 是默认 Executor，Claude Code 作为第二个真实 Adapter 独立验收。
- GitHub Issues 是 V1 Tracker；Symphoneer 不替代 Tracker、Pull Request、Code Review 或 Codex App。
- V1 规划为独立的 Node.js + TypeScript Runtime 与普通 Next.js Web 进程；CLI 和 Web 都是 Runtime 的客户端，不使用 Next.js custom server。
- Codex App Server 是默认生产 Executor；Claude Code 是第二个真实 Adapter，仍需独立 Smoke；其他 Adapter 和 Electron 只保留后续评估入口。
- Web Dashboard 是主操作面，MCP 提供查询和受控操作；Electron 后置。
- Phoenix 只在 Symphony 交付闭环完成后作为非阻塞诊断扩展。
- Tracker 全量同步后的生产 tick 自动 reconcile、retry 和 dispatch；同一 Attempt 的顺序 Turn 复用一个 Worker / Thread。
- Workspace 按 Issue 稳定复用，Attempt 只持有可变租约；Tracker 终态对账才请求安全清理。
- `symphoneer:review` 是进入 Review 的 Tracker 事实；Turn 或 Attempt 成功不自动表示验收完成。

所有真实运行、兼容性、质量和效率仍为 `Not verified`。

# Symphoneer V1 Coordination Plan

> Plan status: Active  
> Decision status: Accepted  
> Implementation evidence: Per-Issue and live; this coordination plan does not cache current Issue, PR, test, or Smoke status
> Owner: Repository owner with Codex as implementation agent  
> Created: 2026-08-01  
> Last updated: 2026-08-03
> Canonical task source: GitHub Issues [#12](https://github.com/icho648/symphoneer/issues/12)–[#18](https://github.com/icho648/symphoneer/issues/18)

本文件是 V1 的跨 Issue 协调索引，不是 GitHub Issue 的第二份实现规格。每个 Issue 自己承载目标、范围、非目标、依赖、验收和证据要求；本文件只保留跨 Issue 顺序、Review Gate、仓库级决定、本地证据和恢复入口。Issue 内容变化后，不在这里复制整段 Issue。

## Purpose / Big Picture

Symphoneer V1 要让个人开发者把一个合格 GitHub Issue 推进到独立验证和人工决定，并区分 Agent 声明、系统观察、项目检查证据和人的最终决定。Parent [#12](https://github.com/icho648/symphoneer/issues/12) 汇总 V1 目标与最终验收；它不是子 Issue 的技术阻塞者。

```text
GitHub Issue
  -> eligibility / dispatch / retry
  -> isolated Workspace
  -> Codex Thread / Turn / Item
  -> independent Verification
  -> human Review
```

产品边界以 [docs/design-docs/product-boundary.md](../../design-docs/product-boundary.md) 和 [docs/design-docs/system-boundaries.md](../../design-docs/system-boundaries.md) 为准；本 Plan 不覆盖设计决定。

## Progress

- V1 的 Issue 集合、依赖关系和 Review Gate 已在 GitHub 与本文件中定义。
- 每个增量的执行位置、状态、认领人、分支、PR、命令结果和证据都是实时事实，分别从 GitHub Issue/PR/依赖接口与本地 Git 读取。
- 本文件只在 V1 依赖形状、跨 Issue 决定、Review Gate、恢复规则或证据边界变化时更新。

Issue / PR 是单个增量的目标与进度事实源；本文件不是执行进度看板。

## Surprises & Discoveries

- GitHub 依赖是原生关系而不是计划文本；开始、恢复和决定是否可以推进时必须实时读取依赖接口。
- 共享 Workspace 并发语义若仍有未决 Review 选择，在实现该路径前必须实时读取相关 PR 线程并完成决定。
- 仓库结构和外部契约会随 Issue 演进；实现前读取 [ARCHITECTURE.md](../../../ARCHITECTURE.md)、对应 Interface 和外部契约叶子文档。

未验证的外部行为继续标记为 Not verified，不因 Issue、计划或 Fake 测试而升级。

## Decision Log

- GitHub Issue 是 Issue-driven 增量的实现计划；active plan 不复制 Issue。
- active plan 只保留 V1 总览、依赖、Review Gate、本地恢复信息和证据索引。
- Review 按共享验收边界合并：Gate A = #13 + #14 Core/Execution；Gate B = #15 + #16 Runtime/Product Surface；Gate C = #17 真实 E2E 与 Human Review；Gate D = #18 Phoenix；最后由 #12 做 V1 整体验收。
- #14 只实现其 Issue 明确授权的 Adapter、Workspace、Codex 和 Verification 边界；不提前实现 Runtime/Web/MCP/fixture/Phoenix。
- Planner、Evaluator 和多 Agent Harness 是开发方法，不是 Symphoneer 产品对象、状态或 V1 功能。

## Outcomes & Retrospective

已完成的结果是：规范性产品与架构文档已固化，Issue #13 的 TypeScript workspace、版本化共享 Schema、Workflow loader、确定性 Symphony Core、本地目录 Workspace 生命周期和 Agent Runner Fake 已通过本地检查。

这些结果不证明真实 GitHub、Codex、Git worktree、Verification 执行、Runtime、Web、MCP、fixture、Phoenix、CI 或部署。V1 只有在 #17 的真实闭环、#18 的非阻塞观测以及 #12 的人工验收完成后才能结束。

## Context and Orientation

当前真实结构见 [ARCHITECTURE.md](../../../ARCHITECTURE.md)。主要入口是：

- [packages/contracts/](../../../packages/contracts/)：跨边界 Schema。
- [packages/symphony-core/](../../../packages/symphony-core/)：Workflow、Eligibility、Scheduler、Workspace 和 Agent Runner seam。
- [tests/](../../../tests/)：根目录下的 contract、core 和 integration 测试。
- [docs/design-docs/](../../design-docs/)：确认后的产品与系统边界。
- [docs/references/](../../references/)：GitHub Issues、Symphony 和 Codex App Server 外部契约。

Issue 实现的入口是实时 GitHub Issue/PR/依赖状态、本地 Git 状态和上述 Core Interface；不从本 Plan 推断额外产品对象。

## Plan of Work

按 GitHub 原生依赖形状推进：

1. #13 建立共享契约和 Core 基线。
2. #14 建立 GitHub、Git Workspace、Codex App Server 和独立 Verification 边界。
3. #15 在 #14 之后建立 JSONL、Runtime API 和 Web Task Board。
4. #16 在 #15 之后暴露受控 MCP。
5. #17 在 #13–#16 的本地检查稳定后执行真实 fixture Smoke。
6. #18 只在 #17 核心闭环后接入 Phoenix 诊断。

哪个 Issue 正在推进、已经完成到哪一步以及是否被阻塞，都在开始或恢复时从 GitHub 和本地 Git 实时读取。具体实现步骤、文件范围和完成判定写在对应 Issue 与 PR 中，不在这里再建一套 checklist。

## Concrete Steps

Issue-driven 增量的固定入口：

```sh
git status --short
git branch --show-current
git diff --check
pnpm check
```

涉及 Codex App Server 时，依据当前本机 CLI 重新运行：

```sh
codex --version
codex app-server --help
codex app-server generate-ts --help
codex app-server generate-json-schema --help
```

这些命令是入口，不是计划中的缓存结果。实现每次只推进一个可判定 Acceptance，并将 Diff、命令、退出状态、未验证项和下一步写入关联 PR/Issue。未到达的后续 Issue 不创建空包、空脚本或外部 fixture。

## Validation and Acceptance

| Gate | Scope | Required evidence |
|---|---|---|
| A Core / Execution | [#13](https://github.com/icho648/symphoneer/issues/13) + [#14](https://github.com/icho648/symphoneer/issues/14) | Linked Issue/PR, deterministic tests, adapter contract checks |
| B Runtime / Product Surface | [#15](https://github.com/icho648/symphoneer/issues/15) + [#16](https://github.com/icho648/symphoneer/issues/16) | Linked Issue/PR, Runtime/API/UI checks, controlled MCP checks |
| C Real E2E / Human Review | [#17](https://github.com/icho648/symphoneer/issues/17) | Fixture Smoke artifacts and human decision |
| D Optional Diagnostics | [#18](https://github.com/icho648/symphoneer/issues/18) | Non-blocking Phoenix evidence |
| Whole V1 | [#12](https://github.com/icho648/symphoneer/issues/12) | Live Issue/PR status plus Gate A–D evidence |

当前状态不缓存于本表。开始或恢复工作、合并前和进行外部写入前，重新读取关联 Issue/PR、GitHub 原生依赖和本地 Git；真实 GitHub / Codex 兼容性、Git worktree、独立 Verification artifact、进程重启、Web/MCP、fixture 和 Human Review 只能由匹配的 Smoke 或人工证据证明。

## Idempotence and Recovery

- 本地分支与工作树状态从 Git 实时读取；修改前检查工作树，避免覆盖用户改动。
- GitHub Issue、标签、评论、assignee、fixture 和其他外部资源写入前先精确读取；无法判断写入结果时停止并人工确认。
- Issue body 是范围和验收事实源；PR 是实现和验证事实源；active plan 不覆盖二者。
- Git worktree、Codex Turn、Verification 和 Runtime 持久化的恢复规则分别服从其 Issue 和系统边界文档；未实现前保持 Not verified。
- 真实外部 Smoke 之前不创建 icho648/symphoneer-fixture，不打印或保存 Token，不自动 Merge / Close。

## Artifacts and Notes

- Issue/PR、CI、Smoke artifact 和人工决定是当前证据的事实源；必要时只引用不可变链接、提交或 artifact。
- 恢复时从 Git 读取提交、分支、工作树和验证结果；本计划不记录当前测试数量、认领人、分支名或某次命令的退出状态。
- 详细外部契约和产品边界只引用 [docs/AGENTS.md](../../AGENTS.md) 路由的叶子文档；不在本节复制。

## Interfaces and Dependencies

预期依赖形状：

```text
#12 V1 acceptance
├─ #13 Core / Contracts
│  └─ #14 GitHub / Workspace / Codex / Verification
│     └─ #15 Runtime / Web
│        └─ #16 MCP
│           └─ #17 fixture / Human Review
│              └─ #18 Phoenix
```

该图是预期依赖形状，不是当前状态快照，也不创建新的产品状态或调度语义。当前阻塞关系必须从 GitHub 原生依赖接口读取。对象权威、存储、Agent Runner 和人工控制边界分别以 [system-boundaries.md](../../design-docs/system-boundaries.md)、[github-issues.md](../../references/github-issues.md)、[codex-app-server.md](../../references/codex-app-server.md) 和 [manual-delivery-flow.md](../../product-specs/manual-delivery-flow.md) 为准。

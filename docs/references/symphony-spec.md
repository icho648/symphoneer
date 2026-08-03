# Symphony SPEC

> External source status: Fixed source rechecked 2026-08-03
> Project adoption: TypeScript Symphony Core Conformance 以固定 SPEC 为基线
> Implementation evidence: Partial — deterministic Core and local directory Workspace lifecycle; real tracker, Git worktree isolation and app-server remain Not verified

## 固定来源

- [Symphony Service Specification，commit `f8e8b8a`](https://github.com/openai/symphony/blob/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7/SPEC.md)
- [OpenAI Symphony repository，同一快照](https://github.com/openai/symphony/tree/f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7)
- [OpenAI Symphony 文章](https://openai.com/zh-Hans-CN/index/open-source-codex-orchestration-symphony/)

该快照的 SPEC 状态是 `Draft v1`。本项目已决定用 TypeScript 实现 Core Conformance，以该 commit 作为 V1 契约基线。2026-08-02 实施 Issue #13 前，远端 `main` 仍指向同一 commit，fixed 与 live `SPEC.md` 的 SHA-256 同为 `29d6b45a85453e045883c064c0e08595f9d4a33f9a2527f649bc1363b74e0176`；没有静默升级基线。

## Observed：契约边界

- Symphony 是 tracker reader、scheduler 和 runner。
- Repository-owned `WORKFLOW.md` 保存运行配置、Prompt、Hooks、验证和交接策略。
- `workspace.root` 可由 repository contract 声明；缺省值是系统临时目录下的 `symphony_workspaces`，相对路径按 `WORKFLOW.md` 所在目录解析并在使用前转成绝对路径。
- Coordination、Execution、Tracker Integration 和 Observability 是不同职责层。
- 成功可以停在 `Human Review` 等工作流交接状态，不要求等于 Tracker 的 `Done`。
- Rich Web UI、多租户控制面、通用 Workflow Engine 和内建 Ticket/PR 业务逻辑不是核心目标。
- 结构化日志是最低可观测要求；人类可读 Dashboard 是可选状态面，不能成为正确性依赖。

## 官方对象与本项目扩展

固定 SPEC 的核心对象包括：

- `Issue`：适配器提供的可调度工作项，不要求来自某一种 Tracker。
- `Workspace`：分配给 Issue 的工作目录。
- `Run Attempt`：某个 Issue 的一次执行尝试，包含重试或继续所需的运行信息。
- `Live Session`：当前 Agent 进程的 Thread / Turn 运行信息。

本项目在此之上增加 Symphoneer Read Model、独立 Verification、ReviewDecision、Human Handoff 和稳定的 Attempt 历史投影。GitHub Sub-issue、Intent 拆解以及同一 Task 多 Thread 的 `AgentRun` 聚合都不是固定 SPEC 的原生对象，需另行设计和验证。

## 本项目已决定的扩展

- 固定快照以 Linear 为当前 Tracker 合同；GitHub Issues 是 Symphoneer 的 V1 产品决定，不是从该 SPEC 自动继承的已实现能力。
- Symphoneer Read Model、Verification、ReviewDecision 和 Human Handoff 超出最小 Scheduler/Runner 的职责，其事实源边界由 [`../design-docs/system-boundaries.md`](../design-docs/system-boundaries.md) 固化。
- Symphoneer 将 repository-owned contract 放在 `.symphoneer/WORKFLOW.md`，并已在 Issue #13 验证解析与模板行为；该项目内路径选择不冒充 Runtime 已存在的证据。
- 为适配安装软件的存储责任，Symphoneer Loader 接受 Host 显式注入的绝对 Workspace 根目录并令其优先于 repository 配置；未注入时仍遵守固定 SPEC 的 repository 值、环境变量和系统临时目录缺省。未来 Runtime 必须从操作系统应用数据位置提供该 Host 设置，当前真实安装路径仍为 `Not verified`。

项目采用与当前实现证据分别见 [`../design-docs/system-boundaries.md`](../design-docs/system-boundaries.md) 和 [`../plans/active/symphoneer-v1.md`](../plans/active/symphoneer-v1.md)。真实 Tracker、进程重启恢复、Git worktree 隔离与脏目录保护、App Server 协议和安全姿态仍为 `Not verified`。

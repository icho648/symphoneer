# OpenAI Symphony 的运行时边界

核实日期：2026-07-30

## 结论

Symphony 更准确的定义是 **由 Issue 驱动的 Coding Agent Supervisor / Scheduler-Runner**。
它确实是长期运行的后台服务，但不只是 cron 调度器，也不是完整的任务管理产品或通用
Workflow Engine。

它把外部 Issue Tracker 中的任务映射为独立 Agent 运行：负责领取、防重、并发限制、
工作区隔离、Codex App Server 生命周期、多轮继续、超时与停滞检测、失败重试、状态
对账和运行观测。任务看板、需求描述、优先级、依赖、长期状态和人工规划仍由 Linear、
GitHub Issues、Jira、Asana 或 GitLab 等 Tracker 保存。

官方规范直接把边界写成：

- Symphony 是 scheduler/runner 和 tracker reader；
- Ticket 的状态变更、评论和 PR 链接通常由 Coding Agent 通过工具写回；
- Rich Web UI、多租户控制平面、通用 Workflow Engine、内建 Ticket/PR 业务逻辑都
  不是 Symphony 的目标。

来源：[官方 SPEC](https://github.com/openai/symphony/blob/main/SPEC.md)

## 各层职责

| 层 | 负责什么 | 不负责什么 |
|---|---|---|
| Issue Tracker | 任务、描述、状态、优先级、依赖、负责人、评论和长期历史 | Agent 进程生命周期 |
| Symphony | 轮询、筛选、claim、防重、并发、工作区、Agent 启停、多轮继续、重试、对账、运行状态 | 产品需求管理、完整看板、任意 DAG 流程执行 |
| Codex App Server | 模型与工具循环、文件修改、命令、测试、事件流 | 决定整个任务池如何调度 |
| 仓库 Harness | `AGENTS.md`、文档、Skills、测试、CI、架构规则和验收证据 | 跨任务运行调度 |
| Symphony Dashboard / Status Surface | 显示 running、retrying、blocked、Token、运行时间、限流和最近事件 | 新建/排序/规划任务或替代 Tracker |

OpenAI 的文章所说“CI 监看、rebase、处理 review、生成演示视频、合并 PR”，主要是
Codex 在 `WORKFLOW.md`、仓库 Skills 和工具支持下完成的能力；Symphony 本身保证这些
Agent 能持续运行、失败后重试并与 Tracker 状态对账。

来源：

- [OpenAI Symphony 文章](https://openai.com/index/open-source-codex-orchestration-symphony/)
- [参考实现 README](https://github.com/openai/symphony/blob/main/elixir/README.md)
- [当前 Symphony Dashboard 源码](https://github.com/openai/symphony/blob/main/elixir/lib/symphony_elixir_web/live/dashboard_live.ex)

## Linear 是否必需

最初文章与 Draft v1 规范用 Linear 说明控制面，但当前 Elixir 参考实现已经包含 Linear、
GitHub Issues、Jira Cloud、Asana 和 GitLab Adapter。因此真正的依赖不是 Linear，
而是一个提供持久任务事实的 Tracker。

如果希望 Symphony 完全独立运行，就必须自行增加一个本地任务存储/Board Adapter。
那是在 Symphony 之外补建任务系统，而不是解锁一个已有但隐藏的 Symphony 看板。

## `WORKFLOW.md` 是什么

它是仓库内版本化的运行契约：YAML Front Matter 保存 Tracker、工作区、Hook、并发和
Codex 参数，Markdown Body 是渲染给 Agent 的任务策略提示。它不是 n8n/BPMN 式节点图；
任务依赖图和持久状态仍来自 Tracker。

## 最简定位

```text
Tracker 决定“有什么工作、现在处于什么状态”
    ↓
Symphony 决定“哪个 Agent 何时在哪里运行、失败后怎么办”
    ↓
Codex + Repo Harness 决定“具体怎样实现、验证和交付”
```

因此，如果另做 Harness Builder，最小合理衔接是读取 Symphony 的运行证据并链接回
Tracker，不必再造任务看板；只有明确需要脱离外部 Tracker 时，才值得增加自己的任务
存储与管理界面。

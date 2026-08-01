# Codex 编排控制面与 Symphony Workbench 映射

整理日期：2026-08-01  
来源：[Codex 进阶指南：作为 Multi-Agent 编排控制平面](https://x.com/riba2534/status/2082916383248252976)

## 证据状态

- **Observed：** 原文对 Codex App、CLI、IDE、Task、Subagent、Worktree、Remote SSH、Handoff、App Server 和常见编排拓扑的整理。
- **Decision：** Tracker 保存 Task 原生状态；Symphony Runtime 负责调度；Workbench 保存
  Task 引用与执行投影；Codex App Server 提供 Agent 执行。
- **Proposed：** 具体事件映射、人工接管和交还机制。
- **Not verified：** 原文涉及的当前工具名称、参数、跨主机可见性、权限继承和 Handoff 行为；实现前必须以当前官方 Schema、CLI 帮助和本地 Smoke 为准。
- 本文不是 Codex 官方规范，也不把原文中的能力清单当成 Workbench 的产品范围。

## 原文最值得保留的结论

Codex 不只是“一个会话执行一件事”，而是一组可以被组合的运行与控制原语：

```text
发现项目/线程
→ 创建或分叉任务
→ 派工、观察、等待
→ 读取结果并独立验证
→ Steering / 重试 / Handoff
→ Review、归档或交还人工
```

文章强调的不是“多开几个 Agent”，而是把任务、执行环境、运行事件、验证结果和人工决策分开管理。

## 对象模型：不要把 Codex 对象当成 Workbench 业务对象

| Codex 概念 | 原文中的作用 | Workbench 中的建议映射 |
|---|---|---|
| Project / Host | 仓库、目录和执行机器 | `Workspace` 的来源与执行目标 |
| Task / 持久 Thread | 可长期存在、可跨项目或主机操作的会话 | Codex `threadId` 关联到一次 `Attempt`，不替代业务 `Task` |
| Turn | 一次输入及其后续 Agent 工作 | Run 内的一段运行过程，不作为业务状态 |
| Item / Event | 消息、命令、文件变更、工具调用、计划和状态变化 | 运行证据与 Read Model 的最小观察单元 |
| Subagent | Task 内临时派生的独立工作者 | V1 不单独建业务实体；只有在有独立验收证据时才考虑接入 |
| Worktree | 隔离的 Git checkout | `Workspace` 的一种实现，支撑并行修改和独立审查 |
| Handoff | 同一任务迁移执行位置 | 解决“在哪里执行”，不等于把责任交给另一个 Agent |
| Automation | Heartbeat / Cron 等时间触发 | 触发器，不是业务 DAG 或验收状态容器 |

核心边界：**Tracker 保存 Task 原生状态；Workbench 保存 Task 引用、Attempt、
Verification、ReviewDecision 和 Finding；Codex App Server 提供单次 Agent 执行及其事件。**

## 执行位置与并行策略

- **Local：** 复用当前 checkout、端口和开发服务，但并行写入会互相看到改动。
- **Worktree：** 为每个候选或任务提供独立文件树；多方案竞赛必须隔离 worktree 和分支。
- **Remote SSH：** 将编译、内网访问或大型测试路由到合适主机。
- **Handoff：** 搬运同一 Task 的执行位置和 Git 状态；不能把它误解为语义上的责任交接。

对 Workbench 的直接结论：`Workspace` 应记录路径、来源、宿主机、分支和隔离方式；不能只显示一个抽象的“Agent 正在运行”。

## 编排原语与 Workbench 边界

### 可以吸收的控制思想

- `create / fork / send / wait / read / handoff` 构成跨 Task 控制环。
- `Steering` 是向正在执行的 Turn 追加方向；`Interrupt` 是终止当前 Turn，二者不能混成普通新消息。
- `Detached Review` 将 Reviewer 与 Generator 的上下文隔离，避免 Agent 自己审自己。
- `wait-any` 不等于 `wait-all`；下游不能只因为上游“完成”就判定前置条件满足，必须读取并验证产物。
- `outputSchema`、结构化 Artifact 和独立 Verifier 能把自然语言完成声明转换成可判定结果。
- 复杂 DAG 的依赖、重试和节点状态应放在外部 Registry/Workbench，不应靠翻聊天记录恢复。

### 当前明确不吸收的范围

- 不因为文章列出多种拓扑，就把 Workbench 做成通用 Multi-Agent Workflow Engine。
- 不在 V1 同时支持多个 Runtime、多个 Tracker 或多个模型 Adapter。
- 不把 Subagent 数量当作产品价值；没有独立证据和可量化收益时，单 Agent + 工具更合适。
- 不让 MCP 取代 App Server 的运行事件，也不让 MCP 成为 Workbench 的业务状态库。

## 与当前 Workbench 的映射

```text
GitHub Issue / Task
  → Symphony 资格判断与派发
  → Workspace
  → Codex App Server Thread / Turn / Item
  → Verification
  → Human Review
  → Merge、Follow-up 或 Return to Automation
```

因此：

1. **Symphony Runtime** 负责调度、并发、重试、对账和 Workspace 生命周期。
2. **Codex App Server** 负责 Thread、Turn、工具调用和执行事件。
3. **Workbench** 负责 Task/Attempt/Verification/Review 的业务投影、人工控制和证据关联。
4. **MCP** 只作为查询或受控业务适配入口，不能替代完整运行遥测。
5. **人** 仍负责任务资格、异常接管、Finding 是否升级以及最终 Merge。

## 实现前核验清单

在进入 App Server 或真实运行实现前，只核验这些高价值事实：

- 当前 App Server JSON Schema 的 Thread、Turn、Item、事件和 Review 方法。
- Worktree 的分支占用、未提交改动和 Handoff 约束。
- Local、Remote SSH、Cloud 的实际可用范围与权限继承。
- 等待工具到底是 wait-any 还是已提供 wait-all；超时、失败和 cursor 如何表达。
- `outputSchema`、独立 Review 和结构化产物能否在当前版本稳定使用。

其余 Agent 拓扑先留作设计词汇，不进入 V1 任务清单。

## 相关项目文档

- [AI Coding 工程化：个人项目的组件边界](2026-07-30-AI-Coding工程化_个人项目边界.md)
- [OpenAI Symphony 的运行时边界](2026-07-30-symphony-runtime-boundaries.md)
- [Harness Builder 与 Symphony：一手资料边界](harness-builder-symphony.md)
- [Agent Orchestrator、Conductor 与 Symphony Workbench](2026-07-30-agent-orchestrator-conductor-vs-symphony-workbench.md)

## 一手核验入口

- [Codex 文档](https://developers.openai.com/codex/)
- [Codex App Server](https://github.com/openai/codex/tree/main/codex-rs/app-server)
- [Codex Worktrees](https://learn.chatgpt.com/docs/environments/git-worktrees)
- [Codex 长任务](https://learn.chatgpt.com/docs/long-running-work)

# 产品定位与边界

> Decision status: Accepted  
> Implementation evidence: Not verified  
> 产品名：**Symphony Workbench**  
> 仓库候选名：`symphony-workbench`

## 一句话定位

Symphony Workbench 是一个计划中的、本地优先的 Coding Agent 交付工作台：
它以 Issue Tracker 为任务入口、以 OpenAI Symphony 为调度与协调内核、
以 Codex App Server 为首版执行引擎，将合格任务持续推进到验证和人工交接。

这是非官方项目，不使用 `OpenAI Symphony Workbench` 名称，也不暗示 OpenAI
认可或维护本项目。

## 核心用户

V1 的目标用户只有一个：

> 希望系统学习并实践现代 Agent 工程工作流的个人开发者。

该用户既是任务发起者，也是 Reviewer 和最终 Merge 决策者。

## 核心问题

个人使用 Coding Agent 时，信息通常散落在 Issue、终端会话、worktree、测试输出、
PR 和观测工具中，导致几个问题：

- 不清楚任务现在处于派发、运行、验证还是等待人工 Review。
- Agent 的完成声明与实际测试、Diff 和 PR 状态混在一起。
- 重复失败很难追溯到当时生效的 `AGENTS.md`、`WORKFLOW.md`、Skill 或检查命令。
- 自动化流程容易先于人工理解，最终只得到更多状态和更少掌控。

## 产品主干

```text
Tracker Task
→ Symphony Eligibility & Dispatch
→ Isolated Workspace
→ Codex Run / Attempt
→ Verification
→ Human Review
├─→ Merge or Follow-up
└─→ Pause & Continue in Codex
       └─→ Return to Automation（可选）
```

主干首先回答：

1. 什么任务可以执行？
2. 当前运行发生了什么？
3. 哪些完成条件被真实验证？
4. 现在需要 Agent 继续、重试，还是人来决定？
5. 人工接管后应该 Merge、Follow-up，还是交还自动化？

## V1 核心组成

```text
GitHub Issues
    ↓
Symphony Runtime
    ↓
Codex App Server
    ↓
Symphony Workbench
    ↘
      Codex App（人工接管）
```

- **GitHub Issues：** 首版的持久任务入口；Linear 是后续 Adapter 候选。
- **Symphony Runtime：** 负责资格判断、并发调度、重试、对账和 Workspace 生命周期。
- **Codex App Server：** 负责 Thread、Turn、工具调用和 Agent 执行事件。
- **Symphony Workbench：** 以本地服务和 Web Dashboard 提供 Task 看板、Run/Attempt 投影、控制和人工交接。
- **Codex App：** 承接需要完整会话、Terminal、Diff 或持续人工引导的工作。

V1 不创建 Electron 宿主。本地服务与 Web 闭环稳定后，Electron 才可作为复用同一服务和 Web 构建的包装层评估。

## 与 GitHub Issues / Linear 的关系

GitHub Issues 是 V1 Tracker；Linear 是后续 Adapter 候选。两者始终是任务意图、
原生字段、协作记录和持久工作状态的事实源，Workbench 不创建一套与其竞争的
Task 真相。

V1 的可调度 Issue 必须同时满足：原生状态为 `open`、包含 `symphony:ready` 标签、不包含 `symphony:review` 标签。这是本项目的采用决定，GitHub API 权限、限流、写回和最终一致性在真实 Smoke 前仍为 `Not verified`。

Workbench 会有目的地重叠一小部分 Issue Tracker 体验：

- 按执行资格筛选和展示 Task。
- 显示标题、状态、标签、负责人、依赖和原生链接。
- 将 Task 与 Attempt、Workspace、验证结果、PR 和人工接管关联。
- 在工作流需要时，通过原生 Adapter 更新状态、标签、评论或交接信息。

这些重叠只服务于“把任务推进到可审查交付物”。Workbench 不替代：

- Issue 的完整创建、编辑、搜索和讨论体验。
- Backlog、Sprint、Roadmap、Project 和团队协作管理。
- GitHub/Linear 的权限、通知、自动化及原生集成生态。
- GitHub Pull Request、Code Review、Checks 和 Merge 体验。

Workbench 可以缓存或投影 Tracker 数据用于调度和 UI，但必须保留原生 Task ID
与深链；发生冲突时以 Tracker 当前状态为准。Run、Attempt 和运行证据属于
Workbench/Symphony 的执行域，不应反向塞进 Tracker 成为另一套运行日志数据库。

## 人工接管边界

Workbench 计划保存 Tracker Task 引用、Attempt、Workspace 与 Codex `threadId` 的
关联，并提供：

1. `Pause & Continue in Codex`：等待当前 Turn 结束、暂停自动重试，再打开持久化 Thread。
2. `Return to Automation`：人工操作结束后，由明确动作重新允许 Symphony 调度。

Workbench 不重复实现完整 Codex Chat、Terminal 或 Diff 编辑器，也不让 Symphony
与 Codex App 同时控制同一个活跃 Turn。Thread 深链、恢复和交还流程在完成本地
兼容性 Smoke 前均为 `Not verified`。

## 访问面与扩展

### Web-first 与受控 MCP

本地服务是唯一业务入口，Web Dashboard 和 MCP 复用同一契约和状态投影。MCP V1 支持查询 Task / Attempt，以及受控的 refresh、dispatch、pause、retry 和 respond to intervention。变更操作需要版本或前置条件、幂等键、状态复核和 Host 确认。MCP 不执行 Commit、Merge、权限扩大或 Harness 修改。

### 项目级 Harness

Harness 是 Symphony Workbench 仓库自身的开发基建：文档结构、项目检查、证据记录以及后续的定时巡检。它不是 Workbench 产品功能，V1 不建设 Harness Workshop、Finding 管理或 Harness 自动修改。只有该做法在至少两个项目中重复并稳定后，才评估提取 Skill 或独立产品。

### Phoenix

Phoenix 在 Symphony 核心交付闭环通过验收后接入，关联运行事件、验证结果和 Trace / Evaluation。它不拥有 Task、Attempt、Verification 或 Review 状态，发送失败或未配置时不得阻塞任务。

## 与 Symphony 的关系

**Observed：** OpenAI Symphony 将自己定位为 tracker reader、scheduler 和 runner，
负责轮询任务、创建隔离 workspace、运行 Coding Agent、重试和对账。

**Decision：** Symphony 不是外接模块或灵感来源，而是产品运行核心。调度、重试、
对账和 Workspace 生命周期由 Symphony Runtime 层统一拥有；Workbench 是它的
Task-first 产品操作面。首版在此基础上增加：

- 面向个人的人工控制体验。
- 任务、运行、验证和 Review 的统一投影。
- Symphony 与 Codex App 之间的显式人工接管。
- 用项目自身实践这套人工到自动的工作流。

首版用 TypeScript 实现 Symphony Core Conformance，以固定 commit `f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7` 的 SPEC 为契约基线。实现可借鉴官方代码，但不直接嵌入未固定的 `main`；实施前重新核对当前上游只形成差异记录，不静默改变基线。

参考：

- [固定 Symphony SPEC](../references/symphony-spec.md)
- [本地 Symphony/Harness 边界调研](../research/harness-builder-symphony.md)
- [本地 Codex 编排控制面映射](../research/2026-08-01-Codex编排控制面与Workbench映射.md)
- [本地 Agent Orchestrator / Conductor 对比](../research/2026-07-30-agent-orchestrator-conductor-vs-symphony-workbench.md)

## 与同类产品的差异目标

比较轴是“默认由用户管理什么”，而不是某个产品是否具备 Issue、Workspace 或 Agent：

| 产品 | 默认核心对象 | 默认启动方式 | 主要操作面 |
|---|---|---|---|
| Agent Orchestrator | Worker Session / Agent Fleet | 人或 Orchestrator Agent 创建 Session | Session、Terminal、PR、CI、Review |
| Conductor | Workspace / Branch | 人或 API 创建 Workspace，再启动 Agent | Workspace、Chat、Diff、Checks |
| Symphony Workbench | Tracker Task / Issue | Symphony 持续调度合格 Task | Task、Attempt、验证和人工交接 |

AO 已支持 Issue 到 PR，Conductor 也能从 GitHub/Linear Issue 创建 Workspace；这里描述
的是默认产品心智，不是排他功能边界。Symphony Workbench 的目标是让 Tracker Task
成为持久工作身份，让 Run/Session 成为可重试的 Attempt，让 Workspace 成为
Task 专属且可复用的执行资源。

差异目标依次是：

1. **Task-first：** 首屏和生命周期围绕待交付任务，而不是 Agent Fleet 或 Workspace。
2. **Automation-to-human：** 自动执行能够显式交给 Codex App，并可选择交还自动化。
3. **Human authority：** 人决定任务资格、接管、验收和最终 Merge。
4. **Evidence-linked：** Task、Attempt、验证、PR 和 Human Review 可相互追溯。
5. **Provider-aware：** 保留 GitHub/Codex 原生能力，同时避免核心领域被其协议绑死。

以上均为目标定位，尚未通过实现验证。

参考：

- [Agent Orchestrator 文档](https://aoagents.dev/docs/)
- [Conductor Workspace 模型](https://www.conductor.build/docs/concepts/workspaces-and-branches)
- [固定 Symphony SPEC](../references/symphony-spec.md)

## 明确非目标

- 重写 Codex、Claude、Pi 或 Cursor 的 Agent Loop。
- 替代 GitHub Issues、Linear、GitHub Pull Request 或其团队协作能力。
- 重复实现 Codex App 的完整 Chat、Terminal 或 Diff 编辑体验。
- 让两个客户端并发控制同一个活跃 Agent Turn。
- 成为通用 workflow engine 或分布式任务调度器。
- 首版同时支持多个 Tracker 和 Runtime。
- 复制 Arize Phoenix 的 Trace/Evaluation UI。
- 用一个综合分数评价 Agent 或 Harness。
- 把 Harness 评估、Finding 管理或自动修改做成 Workbench 产品功能。
- 自动批准权限或 Merge PR。
- 多租户、组织权限、云托管和企业审计。
- 为覆盖技术关键词引入 LangGraph、数据库或消息队列。

## 当前完成边界

目前只有：

- 已接受的产品、系统边界和人工交付契约。
- 求职需求与同类项目调研。
- 本目录中的 active ExecPlan；只有容纳它的初始提交及提交后检查成功时，仅 Markdown 的本地 Git 基线才算已观察事实。

仍然全部为 `Not verified`：

- Symphony 或任意衍生实现的本地运行。
- GitHub/Codex 的真实派发闭环。
- Symphony Thread 与 Codex App 之间的暂停、打开、恢复和交还。
- Apps SDK UI、MCP UI 和 Phoenix 联动。
- 项目级 Harness 检查和后续定时巡检。
- 任何效率、质量或求职效果。

## 已锁定的 V1 选择

1. TypeScript Symphony Core 对齐固定 `f8e8b8a` SPEC。
2. Workbench 以 append-only JSONL 和不可变 artifact 保存历史投影，但不取代 Tracker、Runtime、Git 或 Phoenix 的原生权威。
3. 首条产品闭环是普通 Symphony 任务交付，不是 Harness 失败管理。
4. 首个真实 E2E 使用专用私有仓库 `icho648/symphony-workbench-fixture`；已获得创建授权，但只在 Smoke 阶段创建。
5. Web-first；MCP 是受控访问面；Electron 后置；Phoenix 位于核心闭环之后。

App Server 具体 Schema、人工接管协议、GitHub 权限行为、JSONL 恢复和所有真实集成仍属于实施检查点，在 Smoke 前保持 `Not verified`。

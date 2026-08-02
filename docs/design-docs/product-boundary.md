# 产品定位与边界

> Decision status: Accepted  
> Implementation evidence: Not verified  
> 产品名：**Symphoneer**

## 一句话定位

Symphoneer 是一个本地优先的 Coding Agent 交付工作台：以 Tracker Task 为入口，以 OpenAI Symphony 为调度与协调核心，以 Codex App Server 为首版 Agent Runtime，把合格任务推进到独立验证和人工决定。

这是非官方项目，不以 OpenAI 官方项目或品牌名义发布，也不暗示 OpenAI 认可或维护本项目。

## 用户和问题

V1 用户是希望实践现代 Agent 工程工作流的个人开发者；同一个人发起任务、Review 变更并决定 Merge。

现有 Coding Agent 工作通常把 Issue、会话、Workspace、Diff、测试、PR 和 Review 分散在不同入口，用户难以回答：任务是否具备执行资格、Agent 做了什么、哪些结果被真实验证、下一步由谁负责。

## V1 主干

```text
GitHub Issue
→ Eligibility / Dispatch
→ Run Attempt
→ Workspace
→ Codex Thread / Turn
→ 独立 Verification
→ Human Review
├─→ Merge / Close
├─→ 继续或重试
├─→ Follow-up
└─→ Codex App 接管后交还自动化（可选）
```

## 核心对象

| 对象 | 作用 | 权威来源 |
|---|---|---|
| Task | 持久的任务意图和原生状态 | GitHub Issue |
| Attempt | 针对一个 Task 的一次执行尝试；承载重试、Workspace、运行引用和结果 | Symphoneer Runtime 的 Symphony Core；Symphoneer 保存历史投影 |
| Workspace | 实际工作目录、仓库、分支、宿主机和所有权；通常由 Git worktree 实现 | Symphoneer Runtime 的 Symphony Core |
| Thread / Turn / Item | Agent 的上下文、工作轮次和运行事件 | Codex App Server |
| Verification | 项目原生检查的独立结果和 artifact | Symphoneer |
| ReviewDecision | Merge、继续、Follow-up、接管或 Close 的最终决定 | 人 |

`Thread` 使用 Workspace 的路径工作，但不拥有 Workspace 生命周期；`Attempt` 不是普通 Session 状态，而是把 Task、执行现场、运行上下文和证据绑定起来的执行对象。详细权威边界见 [`system-boundaries.md`](system-boundaries.md)。

## 系统分工

```text
GitHub Issues → Symphoneer Runtime → Codex App Server
      ↑               ↓                     ↓
      └─ 原生任务事实  调度/投影/控制          Thread/Turn/Item 事件
```

- **GitHub Issues：** V1 Tracker，保存任务意图、原生状态、标签、协作记录和 PR/Review 关联。
- **Symphoneer Runtime：** 以固定 Symphony SPEC 为一致性基线，负责资格判断、派发、并发、重试、对账和 Workspace 生命周期。
- **Codex App Server：** 负责 Thread、Turn、工具调用和 Agent 运行事件。
- **Symphoneer：** 提供 Task 看板、Attempt/Workspace/Verification 投影、受控操作和人工交接。
- **Codex App：** 承接需要完整 Chat、Terminal、Diff 或持续人工引导的工作。

Symphoneer 可以缓存或投影 Tracker 数据，但 Tracker 冲突时以原生状态为准；Attempt、Workspace、Verification 和运行证据留在执行域，不把完整运行日志塞回 Issue。

## GitHub 原生能力的采用边界

- **Issue / Sub-issue / Dependency：** 表达任务和真正独立的交付物；不是 Thread 日志。
- **Labels：** 用于分类、风险和粗粒度调度门禁。V1 使用 `symphony:ready` 和 `symphony:review`，不为每个 Thread 建状态标签。
- **Projects：** 提供计划、聚合状态和筛选视图；Thread、Workspace 和 Verification 细节仍在 Symphoneer。
- **Milestones：** 表示版本或交付目标，不表示 Session、Attempt 或 Agent 数量。

## Intent 拆解和多 Thread（后续扩展）

当前 V1 从一个合格 GitHub Issue 开始，不做模糊 Intent 的自动拆解，也不把同一 Issue 的多个 Thread作为固定业务对象。

后续如有真实需求，采用以下边界：

```text
Intent
→ Plan Draft
→ 人工批准
→ Parent Issue / Sub-issues
→ 按依赖并行执行
→ Integration Attempt
→ 父级 Verification / Human Review
```

- 能独立验收、回滚和审查的工作，拆成 Sub-issue。
- 同一交付物的重试、恢复和交接，保留在同一个 Issue 的多个 Attempt 中。
- 同一 Attempt 下的多个写入 Agent，需要独立 Workspace；这需要未来的 `AgentRun` 投影，固定 Symphony SPEC 未定义该多 Thread 聚合模型。
- 默认不建设通用 DAG 编辑器、自动语义合并或无限 Agent 扩容。

## 人工接管

`pause` 请求中断当前 Run，保留 Workspace 和 Provider Session 引用，并停止自动继续；它不冻结 Runtime 进程，也不承诺 Provider 能恢复到任意指令边界。人工接管前必须确认当前 Run 已中断；交还自动化时必须显式确认修改已保存且没有其他活跃控制者。深链、中断、恢复和交还在 Smoke 前均为 `Not verified`。

## 访问面和扩展

- 独立的 Node.js + TypeScript Runtime 是唯一业务入口；它是由 launcher 持有生命周期的长期前台进程，不自行 daemonize，也不与 Next.js 同进程。
- 普通 Next.js 进程只承载 Web UI / BFF，通过 loopback HTTP / SSE 访问 Runtime；CLI 是同一 Runtime 的薄客户端，不复制 Scheduler。
- 关闭浏览器或重启 Next.js 不改变 Attempt；明确退出父 launcher 时才向 Runtime 和 Web 转发停止信号。
- 不使用 Next.js custom server。Electron 后置；未来如采用，由 Main 进程启动同一个 Runtime Module，Renderer 仍通过安全的 Preload Interface 或本地接口访问它。
- Web Dashboard、CLI 和 MCP 复用同一契约、投影和授权判断。
- MCP V1 支持查询 Task / Attempt，以及受控的 refresh、dispatch、pause、retry 和 intervention response；不执行 Commit、Merge 或权限扩大。
- Phoenix 是核心闭环之后的可选、非阻塞诊断副本。

## Agent Runner Seam

- V1 只有 `CodexAppServerAdapter` 和测试 Fake，不建立 Provider factory、通用事件全集或 capability 注册表。
- `Attempt` 是 Symphoneer 业务对象；`threadId`、`turnId` 等只作为 Provider 引用保存。
- Adapter 保留 Codex 原生 Thread / Turn / Item 事件，只向 Scheduler 提炼开始、介入、完成和失败所需语义。
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/typescript) 与 [OpenCode HTTP/SSE Server](https://opencode.ai/docs/server/) 只记录为未来可行性。第二个生产 Adapter 获得明确采用决定后，才提炼公共能力；缺失能力必须显示 `unsupported`。
- 工具白名单或权限模式不能被表述为与文件系统、网络 sandbox 等价。

## 明确非目标

- 重写任何 Agent Loop，或替代 GitHub Issues、Pull Request、Code Review 和 Merge。
- 成为通用 Workflow Engine、分布式任务调度器或多租户控制面。
- 首版同时支持多个 Tracker、Runtime、模型 Adapter 或云部署。
- 为未来 Provider、Electron、数据库、队列或多 Agent 预建占位包、空 Interface 和配置。
- 复制 Phoenix UI、用综合分数评价 Agent，或自动替用户修改项目规则、权限和 CI。
- 在核心交付闭环前引入 LangGraph、数据库、消息队列或 Electron。

## 当前完成边界

当前只有产品、架构、外部采用边界、人工流程和 ExecPlan 文档。Symphony、GitHub、Codex App Server、Web / CLI / MCP、真实 Workspace、Verification 和效率均为 `Not verified`。

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

GitHub Issues 保存任务事实，Symphoneer Runtime 负责调度、执行投影与控制，Codex App Server 负责 Agent 运行上下文；Symphoneer 提供 Task-first 工作台，Codex App 承接深度人工操作。对象权威、进程拓扑和冲突规则只在 [`system-boundaries.md`](system-boundaries.md) 详细定义。

## GitHub 原生能力的采用边界

- **Issue / Sub-issue / Dependency：** 表达任务和真正独立的交付物；不是 Thread 日志。
- **Labels：** 用于分类、风险和粗粒度调度门禁。V1 使用 `symphoneer:ready` 和 `symphoneer:review`，不为每个 Thread 建状态标签。
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

人工接管是 V1 可选结果，不改变人拥有最终控制权。具体暂停、交还与失败条件见 [`../product-specs/manual-delivery-flow.md`](../product-specs/manual-delivery-flow.md) 和 [`system-boundaries.md`](system-boundaries.md)；真实深链与恢复在 Smoke 前为 `Not verified`。

## 访问面和扩展

- Web Dashboard 是主操作面；CLI 与 MCP 复用同一个 Runtime，其中 MCP 只提供查询和受控操作。
- Codex App 是完整 Chat、Terminal、Diff 与持续人工引导入口，不由 Symphoneer 复制。
- Electron 和其他生产 Agent Adapter 后置；Phoenix 只在核心闭环后作为非阻塞诊断扩展。
- Runtime / Web 进程、访问协议、授权和生命周期只在 [`system-boundaries.md`](system-boundaries.md) 定义。

## Agent Runner Seam

V1 采用 Codex App Server 作为唯一生产 Agent Runtime，并保留一个测试 Fake；不建设通用 Provider 平台。Interface、Provider 引用和安全约束见 [`system-boundaries.md#agent-runner-seam`](system-boundaries.md#agent-runner-seam)，外部协议观察见 [`../references/codex-app-server.md`](../references/codex-app-server.md)。

## 明确非目标

- 重写任何 Agent Loop，或替代 GitHub Issues、Pull Request、Code Review 和 Merge。
- 成为通用 Workflow Engine、分布式任务调度器或多租户控制面。
- 首版同时支持多个 Tracker、Runtime、模型 Adapter 或云部署。
- 为未来 Provider、Electron、数据库、队列或多 Agent 预建占位包、空 Interface 和配置。
- 复制 Phoenix UI、用综合分数评价 Agent，或自动替用户修改项目规则、权限和 CI。
- 在核心交付闭环前引入 LangGraph、数据库、消息队列或 Electron。

当前阶段、授权范围和验收由 [active plan](../plans/active/symphoneer-v1.md) 与关联 GitHub Issue 决定；本文不复制易漂移的实施进度。当前真实代码结构见 [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)。

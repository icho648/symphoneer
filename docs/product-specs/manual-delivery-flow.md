# Manual Delivery Flow

> Decision status: Accepted  
> Implementation evidence: Not verified

## 用户结果

个人开发者从一个合格的 GitHub Issue 出发，在隔离 Workspace 中运行一次 Coding Agent，查看独立验证证据，并决定 Merge、继续、Follow-up 或人工接管。

这是 V1 的人工判定基线：当前从 Issue 开始，不包含模糊 Intent 自动拆解，也不要求同一 Issue 同时运行多个独立 Thread。

## 前置条件

- Issue 原生状态为 `open`，包含 `symphony:ready`，不包含 `symphony:review`。
- Issue 说明任务意图和可观察成功条件。
- `WORKFLOW.md` 通过 `symphoneer.verification` 指定项目原生检查；缺少检查时保持 `Not verified`。
- 用户拥有仓库、PR 和最终 Merge 权限。

## 用户流程

1. **确认 Task**：查看 Issue ID、标题、状态、标签、链接和资格判断。
2. **准备 Workspace**：确认仓库、路径、分支、来源和执行范围。
3. **开始 Attempt**：创建一次执行尝试，关联 Task、Workspace 和 Codex `threadId`。
4. **观察执行**：区分 Domain Event、Runtime Log、Agent Statement、命令输出和外部系统状态。
5. **独立验证**：Turn 结束后运行项目检查，保存命令、退出状态、精确版本和 artifact 引用。
6. **进入 Review**：证据完整且 Tracker 允许时写入 `symphony:review`，再由 Symphoneer 投影为等待人工审查。
7. **人工决定**：选择 Merge / Close、继续或重试、创建 Follow-up，或转入 Codex App 接管。
8. **结束或交接**：记录决定、责任人和下一动作；Tracker 仍保存 Issue、PR、Review、Merge 和 Close 的原生状态。

## 必须区分

| 对象 | 用户要看到的内容 |
|---|---|
| Task | 为什么做、原生状态和来源 |
| Attempt | 第几次执行、开始原因和结果 |
| Workspace | 实际目录、分支和所有权 |
| Thread / Turn | Agent 的上下文和运行过程 |
| Verification | 实际运行的检查及结果 |
| ReviewDecision | 谁基于什么证据决定下一步 |

## Task Board 规范性文字图

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Symphoneer                         ⌘K 搜索   刷新   ● Runtime 在线          │
├──────────────┬───────────────────────────────────────────────────────────────┤
│ 全局导航     │ 任务看板                                      筛选   排序     │
│              │                                                               │
│ ▸ Tasks  12  │ ┌───────────────┬───────────────┬─────────────────────────┐ │
│   Review  3  │ │ READY         │ RUNNING       │ REVIEW                  │ │
│   Activity   │ │ #128 重试逻辑  │ #124 验证流程  │ #121 等待人工确认        │ │
│              │ │ #129 更新文档  │ #125 修复超时  │ #119 验证未完成          │ │
│              │ ├───────────────┼───────────────┼─────────────────────────┤ │
│              │ │ BLOCKED       │               │                         │ │
│              │ │ #130 缺少凭据  │               │                         │ │
│              │ └───────────────┴───────────────┴─────────────────────────┘ │
│              │                                                               │
│              │───────────────────────────────────────────────────────────────│
│ Runtime      │ 选中 Task：#128  修复调度器重试逻辑              [打开 GitHub] │
│ ● Running 2  │                                                               │
│ Last sync    │ 意图：避免同一 Task 重复创建 Attempt                         │
│              │ 标签：symphony:ready    Issue 状态：open                     │
│ Settings     │                                                               │
│              │ Attempt 02 · Running                                         │
│              │ Workspace：worktree/task-128       ← 只在这里显示            │
│              │ Verification：2 passed · 1 Not verified                       │
│              │                                                               │
│              │ [查看完整详情]   [暂停]   [重试]   [进入人工 Review]           │
└──────────────┴───────────────────────────────────────────────────────────────┘
```

这张图是对象层级和信息密度契约，不是新的状态机：

- Task 是主对象；READY、RUNNING、REVIEW、BLOCKED 是现有资格与执行状态的看板投影，不创建第二套 Tracker 真相。
- Workspace 只在选中 Task 的 Attempt 详情出现，不提升为全局导航或独立业务对象。
- `Runtime 在线` 只表示 Web 能连接到 Runtime；它不证明 Scheduler 正确、Provider 可用、检查通过或 Task 已完成。
- Verification 与 Agent / Turn 完成分开显示；`Not verified` 不能被 passed 数量、Agent 自述或 Runtime 在线覆盖。
- `[进入人工 Review]` 是满足既有资格后进入人工判定面的入口，不直接 Merge、写入通过结论或绕过 Tracker；条件不满足时必须禁用并解释原因。
- 最终 ReviewDecision 始终由人作出。AI 不得把列、按钮或布局推断为额外对象、自动状态转换或新的产品能力。

Web 使用 OpenAI UI 包作为组件基础，通过系统字体、紧凑密度、分栏、完整键盘操作、命令面板、轻量材质和克制动画形成接近 macOS 的体验。它仍是 Web UI，不声称原生，也不复制 macOS 私有控件。

## 失败和交接

- 没有检查：保持 `Not verified`，不能进入可合并状态。
- 检查失败：保留命令、退出状态和输出，决定修复、重试或 Follow-up。
- Agent 异常中断或失联：停止自动继续并保留 Attempt、Workspace、Session 引用和已有 artifact；对账后再决定恢复、失败或新 Attempt。
- Web 断开或重启：标记连接状态并重连 Runtime，不结束或重建 Attempt。
- Runtime 失联：停止危险控制动作并对账；不能仅凭 Web 缓存推断 Attempt 已停止。
- Tracker 与执行投影冲突：展示差异并暂停危险写回。
- 人工接管：先中断当前 Run 并暂停自动继续；交还前确认没有其他控制者操作同一活跃 Turn。
- Phoenix 未配置或发送失败：记录诊断缺口，不阻塞核心流程。

## 验收

- 用户能从 Issue 追溯到 Attempt、Workspace、变更和 Verification。
- Agent 完成声明不能单独改变 Verification 或 ReviewDecision。
- 每个失败和阻塞都有责任人及下一动作。
- 用户能明确选择 Merge、继续、Follow-up 或人工接管。
- Web、CLI 与 MCP 读取同一 Runtime 投影；CLI 不复制 Scheduler，MCP 不执行 Commit 或 Merge。
- Task Board 保持 Task 为主对象，Workspace 只出现在 Attempt 详情，Runtime 连接状态与 Verification 分离。
- 关闭浏览器或重启普通 Next.js 进程不改变 Runtime 中的 Attempt。
- 文档演练不能证明 GitHub、Symphony、Codex 或真实仓库已经运行；Smoke 前均为 `Not verified`。

## 后续扩展

当 V1 单 Task 闭环有真实证据后，再评估：

```text
Intent → Plan Draft → 人工批准 → Parent Issue / Sub-issues
→ 依赖感知的并行 Attempt → Integration → 父级 Verification
```

独立交付物进入 Sub-issue；同一交付物的重试保留在 Attempt；同一 Task 多 Thread 需要新的 `AgentRun` 聚合，不在当前规格中提前实现。

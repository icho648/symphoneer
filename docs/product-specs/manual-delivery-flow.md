# Manual Delivery Flow

> Decision status: Accepted  
> Implementation evidence: Not verified

## 用户结果

个人开发者选择一个符合条件的 GitHub Issue，在一个隔离 Workspace 中运行一次 Coding Agent，并基于独立验证证据决定 Merge、继续修改、创建 Follow-up 或人工接管。

这是规范性的人工判定基线，计划由 Symphony Runtime、本地 Workbench 服务、Web Dashboard 和受控 MCP 落地。当前没有任何一项已实现，全部行为保持 `Not verified`。

## 前置条件

- 用户已经选择目标仓库和一个原生状态为 `open`、包含 `symphony:ready`、不包含 `symphony:review` 的 GitHub Issue。
- Issue 说明任务意图与可观察成功条件，人仍可暂停或撤销资格。
- 目标仓库的 `WORKFLOW.md` 通过 `workbench.verification` 引用明确的项目原生检查；如果没有，任务必须保持 `Not verified`。
- 用户拥有所需仓库、PR 和最终 Merge 权限。

## 用户可观察流程

1. **确认 Task：** 显示原生 Issue ID、标题、状态、标签、链接和资格判断；Symphony 只调度同时满足标签门禁的 Task。
2. **准备 Workspace：** 记录 Workspace 路径、分支和来源，确认执行范围与目标仓库一致。
3. **开始 Attempt：** 为本次执行分配独立 Attempt，并关联 Task、Workspace 和 Agent 会话标识。
4. **观察执行：** 区分 Agent 事件、Agent 自述、命令输出和外部系统状态，不把“Agent 已完成”直接当成结果。
5. **执行 Verification：** Codex Turn 结束后，Workbench 独立运行 `WORKFLOW.md` 声明的项目检查，保存命令、退出状态、必要输出以及对应 Diff、Commit 或 PR 引用。
6. **进入 Review：** 检查证据完整且 Tracker 复核允许时，工作流通过 GitHub 原生工具写入 `symphony:review`；Workbench 重读 Issue 后才投影为等待人工审查。
7. **人工 Review：** 人在 GitHub 查看变更与证据，选择 Merge / Close、继续当前工作、创建 Follow-up 或转入人工接管；Workbench 和 MCP 不执行 Merge。
8. **结束或交接：** 记录决定、责任人和下一动作；Task、PR、Review、Merge 和 Close 的原生状态仍由 GitHub 与人保存。

## 必须可区分的对象

| 对象 | 用户需要知道什么 |
|---|---|
| Task | 为什么做、原生状态和来源在哪里 |
| Attempt | 这是第几次执行、为何开始或重试 |
| Workspace | 实际在哪个目录和分支工作 |
| Agent Statement | Agent 声称完成了什么 |
| Verification | 哪个独立检查实际运行、结果是什么 |
| ReviewDecision | 谁决定下一步以及决定依据 |

## 失败路径

- 没有可运行的检查：显示 `Not verified`，不得进入“可合并”状态。
- 检查失败：保留失败命令与输出，明确下一动作是修复、重试还是 Follow-up。
- Agent 中断或失联：结束当前 Attempt；Task 和已有 Workspace 关联不得丢失。
- Tracker 与执行投影冲突：展示冲突并暂停危险写回，不静默覆盖 Tracker。
- 人工接管：在任何未来自动恢复前，必须确认没有另一个控制者仍在操作同一活跃 Turn。
- 变更请求重复或过期：Web / MCP 使用版本或前置条件、幂等键和 Host 确认；无法复核当前状态时拒绝执行。
- Phoenix 未配置或发送失败：记录诊断缺口，但不改变核心任务状态或阻塞人工 Review。

## 验收条件

- 用户能从原生 Issue 追溯到 Attempt、Workspace、变更和验证证据。
- Agent 完成声明不会单独改变 Verification 或 ReviewDecision。
- 每个失败和阻塞状态都有责任人及下一动作。
- 用户能明确选择 Merge、继续、Follow-up 或人工接管。
- Web 与 MCP 读取同一投影；MCP 只提供查询和受控的 refresh、dispatch、pause、retry、respond to intervention，不提供 Commit 或 Merge。
- 文档演练只能证明流程定义完整；GitHub、Symphony、Codex 和真实仓库行为在 Smoke 前继续标记 `Not verified`。

## 已锁定的 Smoke 边界

- 首个真实 E2E 使用专用私有仓库 `icho648/symphony-workbench-fixture`。创建权限已获得，但仓库、Issue 和标签只在真实 Smoke 阶段创建，不在文档初始提交中创建。
- Codex App 人工接管、暂停、恢复和交还自动化的具体协议及 UI 尚未完成本地 Smoke，仍为 `Not verified`。

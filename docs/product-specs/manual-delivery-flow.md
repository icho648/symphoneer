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
4. **观察执行**：区分 Runtime Event、Agent Statement、命令输出和外部系统状态。
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

## 失败和交接

- 没有检查：保持 `Not verified`，不能进入可合并状态。
- 检查失败：保留命令、退出状态和输出，决定修复、重试或 Follow-up。
- Agent 中断或失联：结束当前 Attempt，保留 Task、Workspace 和已有 artifact 的关联。
- Tracker 与执行投影冲突：展示差异并暂停危险写回。
- 人工接管：暂停自动重试；交还前确认没有其他控制者操作同一活跃 Turn。
- Phoenix 未配置或发送失败：记录诊断缺口，不阻塞核心流程。

## 验收

- 用户能从 Issue 追溯到 Attempt、Workspace、变更和 Verification。
- Agent 完成声明不能单独改变 Verification 或 ReviewDecision。
- 每个失败和阻塞都有责任人及下一动作。
- 用户能明确选择 Merge、继续、Follow-up 或人工接管。
- Web 与 MCP 读取同一投影；MCP 不执行 Commit 或 Merge。
- 文档演练不能证明 GitHub、Symphony、Codex 或真实仓库已经运行；Smoke 前均为 `Not verified`。

## 后续扩展

当 V1 单 Task 闭环有真实证据后，再评估：

```text
Intent → Plan Draft → 人工批准 → Parent Issue / Sub-issues
→ 依赖感知的并行 Attempt → Integration → 父级 Verification
```

独立交付物进入 Sub-issue；同一交付物的重试保留在 Attempt；同一 Task 多 Thread 需要新的 `AgentRun` 聚合，不在当前规格中提前实现。

# Manual Delivery Flow

> Decision status: Accepted  
> Implementation evidence: Not verified

## 用户结果

个人开发者从一个 GitHub Issue 出发，在隔离 Workspace 中运行一次 Coding Agent，查看持久化的活动、文件变更和检查结果，并决定完成、继续、删除 Attempt 或交接到 Codex。

这是 V1 的人工判定基线：当前从 Issue 开始，不包含模糊 Intent 自动拆解，也不要求同一 Issue 同时运行多个独立 Thread。

## 前置条件

- Issue 原生状态为 `open`；本地 `WorkflowStatus` 已由用户设为 `Ready`。
- Issue 说明任务意图和可观察成功条件。
- 用户拥有仓库和最终人工确认权限。

## 用户流程

1. **确认 Task**：查看 Issue ID、标题、状态、标签、链接和资格判断。
2. **准备 Workspace**：确认仓库、路径、分支、来源和执行范围。
3. **开始 Attempt**：创建一次执行尝试，关联 Task、Workspace 和 Codex `threadId`。
4. **观察执行**：查看持久化的 Codex 活动、工具调用、文件修改、检查结果、错误和人工介入。
5. **进入 Review**：Codex Turn 成功结束后，本地 WorkflowStatus 进入 `In review`。
6. **人工决定**：明确确认完成、保留后续处理，或把当前 Thread 交给 Codex App 继续。
7. **结束或清理**：保留 Attempt 历史；显式删除 Attempt 时一并删除其受管 Workspace。

## 必须区分

| 对象 | 用户要看到的内容 |
|---|---|
| Task | 为什么做、原生状态和来源 |
| Attempt | 第几次执行、开始原因和结果 |
| Workspace | 实际目录、分支和所有权 |
| Thread / Turn | Agent 的上下文和运行过程 |
| Activity / Artifact | Codex 活动、文件修改、检查结果和错误 |
| ReviewDecision | 谁基于什么证据决定下一步 |

## 信息结构

- 一级页按项目分组展示 Issue、WorkflowStatus 和单一主操作；Assistant 保留为任务编排型 Agent 的独立入口。
- 二级页标题栏横向展示编排模式、当前节点和 `Workspace → Codex → 人工确认` 进度。
- 二级页左侧展示有限高度的 Issue 详情，右侧展示可重放的 Codex App Server 活动。
- 同一 Issue 可以保留多个 Attempt，但同一时刻最多一个 Attempt 运行；Attempt 选择器用于查看历史。
- 暂停会中断当前 Run 并保留 Workspace；交接会暂停后打开对应 Codex Thread；删除需要确认并同时删除受管 Workspace。
- 最终 ReviewDecision 始终由人作出；`Done` 不自动关闭 Issue、提交 PR 或 Merge。

Web 使用 OpenAI UI 包作为组件基础，通过系统字体、紧凑密度、分栏、完整键盘操作、命令面板、轻量材质和克制动画形成接近 macOS 的体验。它仍是 Web UI，不声称原生，也不复制 macOS 私有控件。

## 失败和交接

- Agent 未运行检查或检查失败：活动流明确保留证据缺口或失败输出，由人决定继续、交接或新建 Attempt。
- Agent 异常中断或失联：停止自动继续并保留 Attempt、Workspace、Session 引用和已有 artifact；对账后再决定恢复、失败或新 Attempt。
- Web 断开或重启：标记连接状态并重连 Runtime，不结束或重建 Attempt。
- Runtime 失联：停止危险控制动作并对账；不能仅凭 Web 缓存推断 Attempt 已停止。
- Tracker 与执行投影冲突：展示差异并暂停危险写回。
- 人工接管：先中断当前 Run 并暂停自动继续；交还前确认没有其他控制者操作同一活跃 Turn。
- Phoenix 未配置或发送失败：记录诊断缺口，不阻塞核心流程。

## 验收

- 用户能从 Issue 追溯到多个 Attempt、Workspace、Codex Session、活动和文件变更。
- 同一 Issue 最多一个进行中的 Attempt。
- 每个失败和阻塞都有责任人及下一动作。
- 用户能暂停、交接到 Codex、删除 Attempt，并人工确认 `Done`。
- Web、CLI 与 MCP 读取同一 Runtime 投影；CLI 不复制 Scheduler，MCP 不执行 Commit 或 Merge。
- Task Board 保持 Task 为主对象，按项目分组；Workspace 和执行活动只出现在 Attempt 详情。
- 关闭浏览器或重启普通 Next.js 进程不改变 Runtime 中的 Attempt。
- 文档演练不能证明 GitHub、Symphony、Codex 或真实仓库已经运行；Smoke 前均为 `Not verified`。

## 后续扩展

当 V1 单 Task 闭环有真实证据后，再评估：

```text
Intent → Plan Draft → 人工批准 → Parent Issue / Sub-issues
→ 依赖感知的并行 Attempt → Integration → 父级 Verification
```

独立交付物进入 Sub-issue；同一交付物的重试保留在 Attempt；同一 Task 多 Thread 需要新的 `AgentRun` 聚合，不在当前规格中提前实现。

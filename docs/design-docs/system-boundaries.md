# System Boundaries

> Decision status: Accepted  
> Implementation evidence: Not verified

本文件定义对象、权威、证据和控制边界；不定义数据库 Schema，也不声称对象已经实现。

## 对象关系

```text
Tracker Task / GitHub Issue
  └── Attempt：一次执行尝试
      ├── Workspace：实际工作目录和 Git checkout
      ├── Codex Thread / Turn / Item：Agent 运行上下文与事件
      ├── Verification：项目原生检查结果
      └── ReviewDecision：人工决定
```

| 对象 | 权威来源 | Symphoneer 责任 |
|---|---|---|
| Task | GitHub Issue 的身份、意图、状态、标签和协作记录 | 按原生 ID 投影、筛选和对账，不创建第二套 Task 真相 |
| Attempt | Symphony 的一次执行生命周期 | 分配稳定 ID，保存开始原因、状态、来源和历史转换 |
| Workspace | Symphony 的路径、分支、宿主机、所有权和回收规则 | 保存引用，检测竞争所有者、脏目录和来源不一致 |
| Thread / Turn / Item | Codex App Server | 保存原生 ID 和必要事件，不把 Turn 完成当成验收 |
| Diff / Commit / Branch | Git | 保存版本引用，不伪造变更真相 |
| Verification | 项目原生检查及其 artifact | 独立运行、记录命令、退出状态、版本和输出引用 |
| ReviewDecision | 人 | 记录决定、依据、责任人和下一动作 |
| PR / Checks / Review / Merge state | GitHub 原生对象；Merge / Close 的最终决定由人持有 | 重新读取原生状态，保存关联和冲突，不从历史投影重建 |
| Trace / Evaluation | Phoenix 等诊断系统 | 只保存关联 ID；不可用时不阻塞核心流程 |
| Historical Projection | Symphoneer append-only JSONL 和 immutable artifact | 支持重放、查询和 UI，不覆盖原生事实 |

## 当前 V1 的执行粒度

- V1 默认是 `Task → Attempt → 一个活跃 Agent Session`；Session 由 Codex `threadId` / `turnId` 表示。
- 同一 Task 可以有多个 Attempt，用于首次执行、重试、继续或人工交还；Attempt 不是普通 Session 的归档状态。
- 多个独立 Task 可以并行；同一 Task 的并行 Attempt、Workspace 或活跃 Turn 必须有明确所有权，当前不允许未定义的并发写入。
- 同一 Task 多 Thread 的 `AgentRun` 聚合是未来扩展，不是固定 Symphony SPEC 的 V1 对象。只有需要独立写入、验证和合并时才引入它。

## Workspace、Worktree 和 Thread

- `Workspace` 是执行资源：至少包含实际路径、仓库、分支、宿主机和所有权。
- `Worktree` 是 Git checkout 的实现形式；一个 Workspace 通常由一个 Worktree 落地。
- `Thread` 使用 Workspace 路径作为 `cwd`，但不拥有 Workspace 的创建、复用、回收或并发锁。
- 同一 Workspace 可以被同一 Attempt 的连续 Turn 使用；并行写入者必须使用不同 Worktree。
- Retry 或恢复前必须重新核对仓库、分支、HEAD、未提交改动和所有权；不能因为 Thread 仍存在就直接复用目录。

## 事实、投影和证据

1. `Runtime Event` 只证明某个事件被观察到。
2. `Agent Statement` 和 Codex Turn 完成不是独立验证器。
3. `Verification` 必须运行 `WORKFLOW.md` 声明的项目检查，并绑定精确版本和 artifact。
4. GitHub、Git、Runtime、Codex 和 Phoenix 的原生事实不由历史投影覆盖。
5. 缺少匹配证据时显示 `Not verified`，不能用文档、Mock、构建成功或单一评分代替 Smoke 和人工判断。

JSONL 只追加带稳定 ID、来源、时间和 Schema 版本的事件；大输出、检查日志和差异作为 immutable artifact 引用。重放只重建查询投影，不执行外部写操作。

凭据、Token、API key、Cookie、签名 URL、认证头和私密内容不得写入 JSONL、immutable artifact 或 Phoenix；Verification、Agent 和 Provider 输出进入持久化边界前必须脱敏。

## 控制和安全

- Web 和 MCP 复用同一本地服务、契约和授权判断。
- refresh、dispatch、pause、retry 和 intervention response 必须带目标版本或前置条件、幂等键和 Host 确认。
- MCP 不提供 Commit、Merge 或权限扩大。
- Tracker、第三方页面、日志和 Agent 输出都是不可信输入，不能直接成为高优先级系统指令。
- Workspace 隔离不是 sandbox、审批或路径校验的替代品。
- 人工接管前暂停自动推进；交还自动化前确认修改已保存且没有其他活跃控制者。

## 冲突处理

Tracker 与执行投影冲突时，展示来源差异并停止危险写回；Retry、Cancel、Timeout、失联、进程重启和人工接管必须能对账。调度重试不等于业务 exactly-once。

真实 Schema、权限、Workspace 隔离、Codex 生命周期、JSONL 恢复、Web/MCP 共用状态和 Phoenix 脱敏均在 Smoke 前保持 `Not verified`。

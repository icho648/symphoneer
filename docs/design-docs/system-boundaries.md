# System Boundaries

> Decision status: Accepted  
> Implementation evidence: Partial — contract v2, production tick wiring, deterministic Core/Worker tests, Git worktree and Verification temp-repository checks; external compatibility remains `Not verified`

本文件定义对象、权威、证据和控制边界；不定义数据库 Schema，也不声称对象已经实现。

## Runtime 进程拓扑

```text
pnpm dev / future Electron Main
├─ Node.js + TypeScript Runtime
│  ├─ DesktopRuntimeHost（应用级项目目录与聚合 API）
│  │  └─ PollingCoordinator（单一时钟、退避与全局轮询并发）
│  ├─ ProjectRuntime A（一个 WORKFLOW / Tracker Sync / Scheduler）
│  ├─ ProjectRuntime B（一个 WORKFLOW / Tracker Sync / Scheduler）
│  ├─ loopback HTTP / SSE
│  └─ optional static Vite UI (standalone)
└─ Vite Dev Server (development only)
   └─ React SPA + proxy to Runtime

Browser → Vite SPA / static UI → RuntimeClient → Runtime
CLI ──────────────────────────────────────────→ Runtime
```

本文后续的 Runtime 指 Symphoneer Runtime 进程。`RuntimeService` 是遵循固定 Symphony SPEC 的单项目核心：一份 WORKFLOW、一个 Tracker scope、一套 Tracker 同步 / Scheduler / Attempt 状态。`DesktopRuntimeHost` 是 Symphoneer 的应用级扩展，负责项目登记、生命周期、聚合查询、命令路由和统一轮询 cadence，但不跨项目合并 Symphony 调度状态。

- Runtime 是由 launcher（`scripts/dev.ts` / `pnpm dev`）持有生命周期的长期前台进程：输出 stdout / stderr，不自行 daemonize，不创建 PID 文件或后台 `start / stop / status` 系统。launcher 是产品级 Host 入口，纳入根 TypeScript 检查，而不是未被类型覆盖的旁路脚本。
- `pnpm dev` 发现目标地址已有健康 Runtime 时，将其视为外部管理进程并复用；launcher 退出时只停止自己启动的 Runtime 和 Web 子进程。显式设置 `SYMPHONEER_DATA_DIR` 时不复用未知数据目录的现有 Runtime。
- 开发模式下 Runtime 与 Vite 分进程；Standalone 模式由 Runtime 同源托管 Vite 静态 UI，不再常驻第二个 Node Web Server。关闭浏览器或重启 Vite 不改变 Attempt；明确退出父 launcher 时才向自己启动的子进程转发停止信号。
- CLI 和 Web 都是 Runtime 的客户端，只经 RuntimeClient / RuntimeTransport 通信，不复制 Scheduler 或业务状态机。loopback Host / Origin / session token 已落地；完整浏览器 Smoke 仍待验证。
- 一个操作系统进程可以承载多个项目 Runtime；应用级 PollingCoordinator 统一计时、退避并串行调用项目同步回调，每个项目仍拥有独立 Tracker scope、EventLog、artifact、checkpoint、Workspace 根和 Symphony 调度状态。V1 不为每个项目创建额外 OS 进程，也不实现跨项目依赖调度。
- Electron 不是 V1 前提；未来如采用，按其[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)由 Main 启动同一个 Runtime Module，Renderer 仍通过安全的 Preload Interface 或本地接口通信。

## 对象关系

```text
Tracker Task（V1 由 GitHub Issue 实现）
  └── Attempt：一次执行尝试
      ├── Workspace：实际工作目录和 Git checkout
      ├── Codex Thread / Turn / Item：Agent 运行上下文与事件
      ├── Activity / Artifact：执行活动和 Agent 产生的检查、diff 等记录
      └── ReviewDecision：人工决定
      └── Orchestration Run / TeamRun：LangGraph 编排状态与人工门控
```

| 对象 | 权威来源 | Symphoneer 责任 |
|---|---|---|
| Task | Tracker 的身份、意图、状态、标签和协作记录 | 按 Tracker 原生 ID 投影、筛选和对账，不创建第二套 Task 真相；GitHub Issue 只是 V1 的一种 Tracker Task |
| Attempt | Symphoneer Runtime 中 Symphony Core 的一次执行生命周期 | 分配稳定 ID，保存开始原因、状态、来源和历史转换 |
| Workspace | Symphoneer Runtime 中 Symphony Core 的 per-Issue 路径、分支、宿主机、可变租约和回收规则 | 跨 Attempt 保存稳定引用，检测竞争所有者、脏目录和来源不一致 |
| Thread / Turn / Item | Codex App Server | 保存原生 ID 和必要事件，不把 Turn 完成当成验收 |
| Diff / Commit / Branch | Git | 保存版本引用，不伪造变更真相 |
| Check Artifact | Codex / Git / 项目原生工具 | 保存 Agent 执行中产生的检查、diff 和输出引用；不作为 Single Agent 的固定独立阶段 |
| Orchestration Run / checkpoint | Runtime 应用数据目录中的 LangGraph SQLite checkpoint | 保存可恢复的编排状态；对外查询仍以 Domain Event 投影为准 |
| Orchestration Definition | 仓库 `.symphoneer/orchestrations/*.json`（JSON IR） | 项目拥有的编排定义；TeamRun 绑定 id / version / hash |
| ReviewDecision | 人 | 记录决定、依据、责任人和下一动作 |
| PR / Checks / Review / Merge state | GitHub 原生对象；Merge / Close 的最终决定由人持有 | 重新读取原生状态，保存关联和冲突，不从历史投影重建 |
| Trace / Evaluation | Phoenix 等诊断系统 | 只保存关联 ID；不可用时不阻塞核心流程 |
| Historical Projection | Symphoneer 应用数据目录中的 append-only JSONL 和 immutable artifact | 支持重放、查询和 UI，不覆盖原生事实 |

## 当前 V1 的执行粒度

- Single Agent 默认是 `Task → Attempt → Attempt Worker → 顺序 Turn`；Team / 显式 Gate 继续使用独立的 `plan-implement-review` JSON IR，Session 仍由 Codex `threadId` / `turnId` 表示。
- 同一 Task 可以有多个 Attempt，用于首次执行、重试、继续或人工交还；Attempt 不是普通 Session 的归档状态。
- 多个独立 Task 可以并行；同一 Task 的并行 Attempt、Workspace 或活跃 Turn 必须有明确所有权，当前不允许未定义的并发写入。
- 同一 Task 多 Thread 的 `AgentRun` 聚合是未来扩展，不是固定 Symphony SPEC 的 V1 对象。只有需要独立写入、验证和合并时才引入它。

## Agent Runner Seam

Scheduler 只依赖一个小的 Agent Runner Interface；V1 的真实 Adapter 是 Codex App Server，测试使用 Fake：

```text
AgentRunner.openWorker(context) → AttemptWorker

AttemptWorker
├─ startTurn({ prompt, threadId? }) → RunHandle
├─ readSession(...)
├─ processIdentity
└─ close()

RunHandle
├─ events
├─ interrupt()
├─ respondToIntervention(requestRef, decision)
└─ completion
```

- `Attempt` 是 Symphoneer 业务对象；`threadId`、`turnId` 和未来 Provider 的 Session ID 只是运行引用，不能成为核心状态机的身份。
- Codex Adapter 保留原生 Thread / Turn / Item 事件，并只向 Scheduler 提炼开始、介入、完成和失败所需语义。
- Worker 创建时绑定 Attempt、Task、Workspace 和 Codex 设置，并以 Workspace 作为 App Server、Thread、Turn 和 sandbox cwd；同一 Worker 只允许一个活跃 Turn。
- 首个 Turn 创建或恢复 Thread，后续 Turn 复用 Worker 内的同一 Thread，不重复启动 App Server。`RunHandle.completion` 只表示 Turn 结束；编排层在暂停、失败、`maxTurns`、交接或 Attempt 终止时显式关闭 Worker。
- 普通 `pause` 可以中断当前 Turn；Handoff 则等待当前 Turn 自然结束，再关闭 Worker、保留 Workspace并交出控制权。
- 不预建 Provider factory、通用事件全集或 capability 注册表。第二个生产 Adapter 获得明确采用决定后再提炼公共能力；能力缺失必须明确返回 `unsupported`。
- 工具权限或白名单不能冒充文件系统、网络 sandbox 或宿主审批。每个生产 Adapter 未来必须通过共享契约测试和一条真实 Smoke；Fake 只验证本项目逻辑。

## Tracker Seam

Scheduler 与投影调用方只依赖一个小的 Tracker Interface；V1 的真实 Adapter 是 GitHub Issues，测试使用 Fake：

```text
getTask(nativeId, options?) → TaskSnapshot{ task, versionToken }
listTasks(options?) → TrackerTaskPage
```

- `Task` 权威仍在 Tracker；Symphoneer 只按原生身份投影、筛选和对账，不创建第二套 Task 真相。
- Web、CLI 和 MCP 的任务操作先进入 Runtime，再由注入的 Tracker 执行；Tracker 变更后重新读取状态，再写入本地投影。
- GitHub Adapter 把 Issue 收成 `TaskSummary`，并把 ETag 等并发标记收成不透明的 `versionToken`。
- 不预建 Tracker factory 或通用字段全集。第二个生产 Tracker Adapter 获得明确采用决定后再提炼公共能力；能力缺失必须明确返回 `unsupported`。
- Fake 只验证本项目对 Tracker 端口的依赖；真实 GitHub 兼容性仍由匹配 Smoke 证明。

## Workspace、Worktree 和 Thread

- `Workspace` 是执行资源：至少包含实际路径、仓库、分支、宿主机和所有权。
- `Worktree` 是 Git checkout 的实现形式；一个 Workspace 通常由一个 Worktree 落地。
- `Thread` 使用 Workspace 路径作为 `cwd`，但不拥有 Workspace 的创建、复用、回收或并发锁。
- Workspace 使用稳定 `workspace:<task-id>`、`<workspace-root>/issue-<number>` 和 `codex/issue-<number>`；`ownerAttemptId` 只是当前租约。同一 Issue 的后续 Attempt 在安全校验后复用它。
- 同一 Workspace 可以被同一 Attempt 的连续 Turn 和同一 Issue 的顺序 Attempt 使用；并行写入者必须使用不同 Worktree。
- Retry 或恢复前必须重新核对仓库、分支、HEAD、未提交改动和所有权；不能因为 Thread 仍存在就直接复用目录。
- Attempt 成功、失败、超时、暂停、`maxTurns` 或人工接管后保留 Workspace；删除 Attempt 历史也不删除稳定 Workspace。
- Tracker 终态 reconciliation 或 fixture manifest cleanup 才请求释放。释放前后均重新核对 Git HEAD、fingerprint 与 tracked/untracked/ignored 状态，使用无 `--force` 的 `git worktree remove`，不自动 stash、reset、clean、删分支或清理状态不一致的路径。

## 事实、日志、投影和证据

| 记录 | 用途 | 持久性与证明范围 |
|---|---|---|
| Runtime Log | 结构化运行诊断；关联 Task、Attempt、Workspace 和 Provider 引用 | 可轮转；只证明某条诊断被记录 |
| Domain Event | Task 投影、Attempt 和 Workspace 等业务状态变化 | append-only、带稳定 ID 和 Schema 版本，可重放查询投影 |
| Check Artifact | Agent 活动中的命令、精确代码版本、退出状态和必要输出 | immutable；只证明对应检查在绑定版本上的结果 |
| Trace | Phoenix 等系统中的调试与评估副本 | 可选、可丢失，不参与调度或验收判定 |

1. `Agent Statement`、Codex Turn 完成和 Runtime Log 不能替代人工 ReviewDecision。
2. Agent 执行中的检查结果、diff 和命令输出作为活动与 artifact 保存；Single Agent 不再追加固定的独立 Verification 节点。
3. GitHub、Git、Runtime、Codex 和 Phoenix 的原生事实不由历史投影覆盖。
4. 缺少匹配证据时明确显示证据缺口，不能用文档、Mock、构建成功或单一评分代替 Smoke 和人工判断。

JSONL 只追加 Domain Event；大输出、检查日志和差异作为 immutable artifact 引用。重放只重建查询投影，不执行外部写操作。

### 可选独立检查的容纳边界

Runtime 仍保留独立检查与 immutable artifact 能力，供 Team 编排或未来明确配置的 Gate 使用，但它不是默认 Single Agent 的固定生命周期节点。启用时，Runtime 只承担三件可以自己保证的事：检查在独立进程组中启动并在观察前被容纳；artifact 一次性原子发布，既不覆盖已有证据也不因失败留下占位；检查前后的 Git HEAD 与 Workspace 状态绑定进同一条证据。

脱离进程组的后台进程、同一 OS 身份对历史 artifact 的改写，以及仓库自带 Git 配置的滥用，都需要 OS 级 sandbox、job/cgroup 或独立存储身份才能真正阻止。Agent 自己的 Turn 同样拥有该身份的文件系统权限，所以这些属于安装 Host 的隔离责任，V1 不承担，也不用 in-process 的路径隐藏、进程表轮询或启发式扫描假装承担。同理，进入记录边界的 Provider 文本按最小化和脱敏处理，但脱敏是尽力而为的模式匹配，不能替代「不写入原始 Provider payload」这条硬边界。

### 项目归属与软件存储责任

“与某个项目关联”不等于“由该项目仓库保存”。存储位置由数据的写入者、生命周期和恢复责任决定：

| 数据类别 | 所有者与默认位置 | 责任 |
|---|---|---|
| Repository contract | 目标仓库根 `WORKFLOW.md`，进入 Git | 配置、Prompt 和团队共享策略；旧 `.symphoneer/WORKFLOW.md` 仅作缺失回退并记录弃用 |
| Project registry | Symphoneer application data 下的 `projects/index.json` | 仅保存稳定、不透明的 `project-id` 列表；项目路径是查找键，不是身份 |
| Project-scoped runtime data | Symphoneer application data 下的 `projects/<project-id>/` | 配置、Domain Event、Verification Artifact、checkpoint 与恢复元数据；由 Runtime 创建和保留 |
| Workspace | Host 注入的 Workspace 根下 `/<project-id>/` | Attempt Git worktree 与未提交工作；不作为 cache，也不随项目从目录中移除而删除 |
| Runtime Log | 操作系统的 Symphoneer Logs 目录下 `<project-id>/operator.jsonl` | project-scoped 操作、关联 ID、PID、耗时、outcome 和 error kind；不记录 Prompt、Token、源码或 Provider payload |
| Cache / temporary data | 操作系统 Cache / temporary 目录 | 仅保存可重建内容；系统清理不能导致业务证据或未提交 Workspace 丢失 |
| Credentials | 操作系统 Keychain 或等价凭据存储 | Runtime 按引用读取；不进入仓库、事件、artifact、日志或 Trace |

macOS 安装版的目标映射是 `~/Library/Application Support/Symphoneer/projects/<project-id>/`、`~/Library/Logs/Symphoneer/` 与 `~/Library/Caches/Symphoneer/`；其他平台使用各自原生位置，不从仓库路径推导。`project-id` 是 Host 分配并持久化的不透明稳定身份。规范化项目路径和 Git common dir 只用于找回已有身份：符号链接和同一 clone 的 linked worktree 会命中同一项目，两个独立 clone 即使 remote 相同也保留为两个项目。

固定 Symphony SPEC 仍允许 repository contract 声明 `workspace.root`，并在未声明时回落到系统临时目录。Symphoneer 的安装 Host 必须用更高优先级的应用设置注入已解析的绝对 Workspace 根目录；因此进入 Git 的根 `WORKFLOW.md` 不声明机器存储位置，仓库配置也不能越过 Host 选择任意写入位置。当前 Runtime 已支持显式 application data / logs / cache / workspace 根和跨重启项目恢复；Electron `app.getPath()` 适配、安装包目录映射和真实应用重启 Smoke 仍为 `Not verified`。

凭据、Token、API key、Cookie、签名 URL、认证头、私有源码全文、原始 Provider payload 和未经脱敏的错误原因不得写入 Runtime Log、Domain Event、Verification Artifact 或 Phoenix；Verification、Agent 和 Provider 输出进入任何记录边界前必须最小化并脱敏。

## 控制和安全

- Web、CLI 和 MCP 复用同一个 Runtime、共享契约和授权判断。
- refresh、dispatch、pause、retry 和 intervention response 必须带目标版本或前置条件、幂等键和 Host 确认。
- MCP 不提供 Commit、Merge 或权限扩大。
- Tracker、第三方页面、日志和 Agent 输出都是不可信输入，不能直接成为高优先级系统指令。
- Workspace 隔离不是 sandbox、审批或路径校验的替代品。
- Handoff 等待当前 Turn 结束并关闭 Worker后才设置 `controller=codex`。Codex-owned Attempt 拒绝普通输入抢占；Return to Automation 必须确认 Thread idle、HEAD/fingerprint/dirty state 未漂移并重新取得租约，成功后才设置 `controller=symphoneer` 并恢复 Worker/Thread。

## 冲突处理

Tracker 与执行投影冲突时，展示来源差异并停止危险写回；Retry、Cancel、Timeout、失联、进程重启和人工接管必须能对账。调度重试不等于业务 exactly-once。

真实 GitHub 权限、Codex 生命周期、JSONL 恢复、Web / CLI / MCP 共用状态和 Phoenix 脱敏均在匹配 Smoke 前保持 `Not verified`；临时仓库中的 Git worktree 与 Verification 检查只证明受控本地边界。

# System Boundaries

> Decision status: Accepted  
> Implementation evidence: Partial — contract v2, deterministic Core, adapter contract tests, Git worktree and Verification temp-repository checks; external compatibility remains Not verified

本文件定义对象、权威、证据和控制边界；不定义数据库 Schema，也不声称对象已经实现。

## Runtime 进程拓扑

```text
pnpm dev / future Electron Main
├─ Node.js + TypeScript Runtime
│  ├─ Scheduler
│  ├─ Attempt / Workspace / Verification
│  ├─ Tracker Adapter
│  ├─ Agent Runner
│  └─ loopback HTTP / SSE
└─ ordinary Next.js process
   └─ Web UI / BFF

Browser → Next.js BFF → Runtime
CLI ─────────────────→ Runtime
```

本文后续的 Runtime 指 Symphoneer Runtime 进程；`src/runtime` 是其中遵循固定 Symphony SPEC 的核心 Module。

- Runtime 是由 launcher（`scripts/dev.ts` / `pnpm dev`）持有生命周期的长期前台进程：输出 stdout / stderr，不自行 daemonize，不创建 PID 文件或后台 `start / stop / status` 系统。launcher 是产品级 Host 入口，纳入根 TypeScript 检查，而不是未被类型覆盖的旁路脚本。
- `pnpm dev` 发现目标地址已有健康 Runtime 时，将其视为外部管理进程并复用；launcher 退出时只停止自己启动的 Runtime 和 Web 子进程。显式设置 `SYMPHONEER_DATA_DIR` 时不复用未知数据目录的现有 Runtime。
- Runtime 与 Next.js 分进程运行，不使用 [Next.js custom server](https://nextjs.org/docs/app/guides/custom-server)。关闭浏览器或重启 Web 不改变 Attempt；明确退出父 launcher 时才向两个子进程转发停止信号。
- CLI 和 Web 都是 Runtime 的客户端，不复制 Scheduler 或业务状态机。loopback HTTP / SSE 的鉴权、端口发现和断线恢复仍待实现验证。
- Electron 不是 V1 前提；未来如采用，按其[进程模型](https://www.electronjs.org/docs/latest/tutorial/process-model)由 Main 启动同一个 Runtime Module，Renderer 仍通过安全的 Preload Interface 或本地接口通信。

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
| Attempt | Symphoneer Runtime 中 Symphony Core 的一次执行生命周期 | 分配稳定 ID，保存开始原因、状态、来源和历史转换 |
| Workspace | Symphoneer Runtime 中 Symphony Core 的路径、分支、宿主机、所有权和回收规则 | 保存引用，检测竞争所有者、脏目录和来源不一致 |
| Thread / Turn / Item | Codex App Server | 保存原生 ID 和必要事件，不把 Turn 完成当成验收 |
| Diff / Commit / Branch | Git | 保存版本引用，不伪造变更真相 |
| Verification | 项目原生检查及其 artifact | 独立运行、记录命令、退出状态、版本和输出引用 |
| ReviewDecision | 人 | 记录决定、依据、责任人和下一动作 |
| PR / Checks / Review / Merge state | GitHub 原生对象；Merge / Close 的最终决定由人持有 | 重新读取原生状态，保存关联和冲突，不从历史投影重建 |
| Trace / Evaluation | Phoenix 等诊断系统 | 只保存关联 ID；不可用时不阻塞核心流程 |
| Historical Projection | Symphoneer 应用数据目录中的 append-only JSONL 和 immutable artifact | 支持重放、查询和 UI，不覆盖原生事实 |

## 当前 V1 的执行粒度

- V1 默认是 `Task → Attempt → 一个活跃 Agent Session`；Session 由 Codex `threadId` / `turnId` 表示。
- 同一 Task 可以有多个 Attempt，用于首次执行、重试、继续或人工交还；Attempt 不是普通 Session 的归档状态。
- 多个独立 Task 可以并行；同一 Task 的并行 Attempt、Workspace 或活跃 Turn 必须有明确所有权，当前不允许未定义的并发写入。
- 同一 Task 多 Thread 的 `AgentRun` 聚合是未来扩展，不是固定 Symphony SPEC 的 V1 对象。只有需要独立写入、验证和合并时才引入它。

## Agent Runner Seam

Scheduler 只依赖一个小的 Agent Runner Interface；V1 的真实 Adapter 是 Codex App Server，测试使用 Fake：

```text
startOrContinue(request) → RunHandle

RunHandle
├─ events
├─ interrupt()
├─ respondToIntervention(requestRef, decision)
└─ completion
```

- `Attempt` 是 Symphoneer 业务对象；`threadId`、`turnId` 和未来 Provider 的 Session ID 只是运行引用，不能成为核心状态机的身份。
- Codex Adapter 保留原生 Thread / Turn / Item 事件，并只向 Scheduler 提炼开始、介入、完成和失败所需语义。
- `pause` 调用当前 `RunHandle.interrupt()`，保留 Workspace 和 Session 引用并停止自动继续；它不冻结 Runtime 进程，也不保证任意 Provider 都能无损恢复。
- `completion` 落定表示该 Turn 的 Provider 进程已经停止；超时和中断也必须等到停止后才落定，否则 Verification、保留和重试会与仍在写入的 Agent 争用同一 checkout。
- 不预建 Provider factory、通用事件全集或 capability 注册表。第二个生产 Adapter 获得明确采用决定后再提炼公共能力；能力缺失必须明确返回 `unsupported`。
- 工具权限或白名单不能冒充文件系统、网络 sandbox 或宿主审批。每个生产 Adapter 未来必须通过共享契约测试和一条真实 Smoke；Fake 只验证本项目逻辑。

## Tracker Seam

Scheduler 与投影调用方只依赖一个小的 Tracker Interface；V1 的真实 Adapter 是 GitHub Issues，测试使用 Fake：

```text
getTask(nativeId, options?) → TaskSnapshot{ task, versionToken }
```

- `Task` 权威仍在 Tracker；Symphoneer 只按原生身份投影、筛选和对账，不创建第二套 Task 真相。
- GitHub Adapter 把 Issue 收成 `TaskSummary`，并把 ETag 等并发标记收成不透明的 `versionToken`。
- 不预建 Tracker factory 或通用字段全集。第二个生产 Tracker Adapter 获得明确采用决定后再提炼公共能力；能力缺失必须明确返回 `unsupported`。
- Fake 只验证本项目对 Tracker 端口的依赖；真实 GitHub 兼容性仍由匹配 Smoke 证明。

## Workspace、Worktree 和 Thread

- `Workspace` 是执行资源：至少包含实际路径、仓库、分支、宿主机和所有权。
- `Worktree` 是 Git checkout 的实现形式；一个 Workspace 通常由一个 Worktree 落地。
- `Thread` 使用 Workspace 路径作为 `cwd`，但不拥有 Workspace 的创建、复用、回收或并发锁。
- 同一 Workspace 可以被同一 Attempt 的连续 Turn 使用；并行写入者必须使用不同 Worktree。
- Retry 或恢复前必须重新核对仓库、分支、HEAD、未提交改动和所有权；不能因为 Thread 仍存在就直接复用目录。
- Attempt 成功、失败、超时、暂停或人工接管后先保留 Workspace；当前 V1 不实现 TTL 或后台清理器。
- 只有终态 Task 的未来 Runtime 策略或显式人工操作可以请求释放。释放前后均重新核对 Git 身份与 tracked/untracked 状态，使用无 `--force` 的 `git worktree remove`，不自动 stash、reset、clean、删分支或清理状态不一致的路径。

## 事实、日志、投影和证据

| 记录 | 用途 | 持久性与证明范围 |
|---|---|---|
| Runtime Log | 结构化运行诊断；关联 Task、Attempt、Workspace 和 Provider 引用 | 可轮转；只证明某条诊断被记录 |
| Domain Event | Task 投影、Attempt 和 Workspace 等业务状态变化 | append-only、带稳定 ID 和 Schema 版本，可重放查询投影 |
| Verification Artifact | 命令、工具版本、精确代码版本、退出状态和必要输出 | immutable；只证明对应检查在绑定版本上的结果 |
| Trace | Phoenix 等系统中的调试与评估副本 | 可选、可丢失，不参与调度或验收判定 |

1. `Agent Statement`、Codex Turn 完成和 Runtime Log 不是独立验证器。
2. `Verification` 必须运行 `.symphoneer/WORKFLOW.md` 声明的项目检查，并绑定精确版本和 artifact。
3. GitHub、Git、Runtime、Codex 和 Phoenix 的原生事实不由历史投影覆盖。
4. 缺少匹配证据时显示 `Not verified`，不能用文档、Mock、构建成功或单一评分代替 Smoke 和人工判断。

JSONL 只追加 Domain Event；大输出、检查日志和差异作为 immutable artifact 引用。重放只重建查询投影，不执行外部写操作。

### Verification 的容纳边界

Verification 运行仓库自己声明的检查，因此它防的是「把 Agent 或 Turn 的成功声明当成验收」，不是防一个主动伪造证据的检查进程。Runtime 只承担三件可以自己保证的事：检查在独立进程组中启动并在观察前被容纳；artifact 一次性原子发布，既不覆盖已有证据也不因失败留下占位；检查前后的 Git HEAD 与 Workspace 状态绑定进同一条证据。

脱离进程组的后台进程、同一 OS 身份对历史 artifact 的改写，以及仓库自带 Git 配置的滥用，都需要 OS 级 sandbox、job/cgroup 或独立存储身份才能真正阻止。Agent 自己的 Turn 同样拥有该身份的文件系统权限，所以这些属于安装 Host 的隔离责任，V1 不承担，也不用 in-process 的路径隐藏、进程表轮询或启发式扫描假装承担。同理，进入记录边界的 Provider 文本按最小化和脱敏处理，但脱敏是尽力而为的模式匹配，不能替代「不写入原始 Provider payload」这条硬边界。

### 项目归属与软件存储责任

“与某个项目关联”不等于“由该项目仓库保存”。存储位置由数据的写入者、生命周期和恢复责任决定：

| 数据类别 | 所有者与默认位置 | 责任 |
|---|---|---|
| Repository contract | 目标仓库 `.symphoneer/`，进入 Git | `WORKFLOW.md`、Prompt 和后续团队共享策略；可审查、可版本化 |
| Project-scoped runtime data | Symphoneer application data 下的 `projects/<project-id>/` | Domain Event、Verification Artifact、Workspace 与恢复所需元数据；由 Runtime 创建、保留和回收 |
| Runtime Log | 操作系统的 Symphoneer Logs 目录 | 跨项目诊断、轮转、保留期和脱敏；日志记录携带 project / Task / Attempt 关联 ID |
| Cache / temporary data | 操作系统 Cache / temporary 目录 | 仅保存可重建内容；系统清理不能导致业务证据或未提交 Workspace 丢失 |
| Credentials | 操作系统 Keychain 或等价凭据存储 | Runtime 按引用读取；不进入仓库、事件、artifact、日志或 Trace |

macOS 安装版的目标映射是 `~/Library/Application Support/Symphoneer/projects/<project-id>/`、`~/Library/Logs/Symphoneer/` 与 `~/Library/Caches/Symphoneer/`；其他平台使用各自原生位置，不从仓库路径推导。`project-id` 是 Runtime 分配或登记的稳定身份，不能只用可能冲突的仓库 basename。

固定 Symphony SPEC 仍允许 repository contract 声明 `workspace.root`，并在未声明时回落到系统临时目录。Symphoneer 的安装 Host 必须用更高优先级的应用设置注入已解析的绝对 Workspace 根目录；因此进入 Git 的 `.symphoneer/WORKFLOW.md` 不声明机器存储位置，仓库配置也不能越过 Host 选择任意写入位置。操作系统目录发现、真实 Runtime 持久化、轮转和恢复仍为 `Not verified`。

凭据、Token、API key、Cookie、签名 URL、认证头、私有源码全文、原始 Provider payload 和未经脱敏的错误原因不得写入 Runtime Log、Domain Event、Verification Artifact 或 Phoenix；Verification、Agent 和 Provider 输出进入任何记录边界前必须最小化并脱敏。

## 控制和安全

- Web、CLI 和 MCP 复用同一个 Runtime、共享契约和授权判断。
- refresh、dispatch、pause、retry 和 intervention response 必须带目标版本或前置条件、幂等键和 Host 确认。
- MCP 不提供 Commit、Merge 或权限扩大。
- Tracker、第三方页面、日志和 Agent 输出都是不可信输入，不能直接成为高优先级系统指令。
- Workspace 隔离不是 sandbox、审批或路径校验的替代品。
- 人工接管前暂停自动推进；交还自动化前确认修改已保存且没有其他活跃控制者。

## 冲突处理

Tracker 与执行投影冲突时，展示来源差异并停止危险写回；Retry、Cancel、Timeout、失联、进程重启和人工接管必须能对账。调度重试不等于业务 exactly-once。

真实 GitHub 权限、Codex 生命周期、JSONL 恢复、Web / CLI / MCP 共用状态和 Phoenix 脱敏均在匹配 Smoke 前保持 `Not verified`；临时仓库中的 Git worktree 与 Verification 检查只证明受控本地边界。

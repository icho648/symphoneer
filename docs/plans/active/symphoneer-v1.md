# Symphoneer V1 ExecPlan

> Plan status: Active  
> Decision status: Accepted  
> Implementation evidence: Partial — Issue #13 local Core checks pass; real GitHub, Codex, Git worktree, Runtime/Web, MCP, Phoenix and scheduled-check behavior remains Not verified
> Owner: Repository owner with Codex as implementation agent  
> Created: 2026-08-01  
> Last updated: 2026-08-03
> Symphony contract baseline: `f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`

本 ExecPlan 是自包含、可恢复、持续更新的开发规格。它固化实施顺序和验收方法，但不把计划中的命令、界面或外部系统写成已经运行的事实。每次实施停点都必须更新本文档的进度、发现、决定、证据和下一步。

## Purpose / Big Picture

Symphoneer V1 要让个人开发者把一个合格 GitHub Issue 推进到可人工审查的交付物，并且能明确区分 Agent 说了什么、系统观察到什么、项目检查实际证明了什么、最后由谁决定。

用户最终能观察到下列闭环：

```text
GitHub Issue
  -> Symphony eligibility / dispatch / retry / reconciliation
  -> isolated workspace
  -> Codex App Server thread / turn / item
  -> Symphoneer-independent project verification
  -> GitHub review handoff
  -> human merge, continue, follow-up, or takeover
```

产品交付顺序是：

1. TypeScript Symphony Core 与独立 Verification 形成可测闭环。
2. 独立 Node.js + TypeScript Runtime 和普通 Next.js Web Dashboard 提供主操作面。
3. MCP 让人能在 Codex 中查询并执行受控操作。
4. 专用私有 fixture 验证真实 GitHub / Codex 端到端流程。
5. Phoenix 作为非阻塞诊断和评测扩展接入。

本计划的非目标包括：Next.js custom server、通用 Provider 平台、数据库、消息队列、LangGraph、多租户、云托管、自动 Merge、复制 Phoenix UI，以及在 V1 核心验收前创建 Electron 宿主。Planner、Evaluator 和多 Agent Harness 是开发方法的可选工具，不是 Symphoneer 产品功能。

## Progress

- [x] 2026-08-01：确认 Symphony-first、Web-first、受控 MCP、JSONL 投影、fixture 和 Phoenix 顺序。
- [x] 2026-08-01：将已确认决定回写到规范性设计、产品规格和引用文档。
- [x] 2026-08-01：完成本 active ExecPlan 和规范性 Markdown 候选内容。
- [x] 2026-08-02：将项目与仓库文档身份统一为 Symphoneer，保留 Symphony 外部契约；项目标签随后统一为 `symphoneer:*`。
- [x] 2026-08-02：完成全项目文档二次优化；本地链接、分区索引、ExecPlan 12 章、仅 Markdown、冲突词、两处 Task Board 图一致性和 Diff 检查均通过。
- [x] 2026-08-02：用户通过 GitHub Issue #13 明确授权进入代码阶段；实施前基线为 `33ebe0568f053266f7ad9b8de082be8c57b1b949`，工作树干净。
- [x] 2026-08-02 Phase 1：建立项目检查入口和最小 TypeScript workspace。
- [x] 2026-08-02 Phase 2 / Issue #13：实现共享契约、Symphony Core Conformance、本地目录 Workspace 生命周期和 Agent Runner Fake，并通过双轴复审。
- [x] 2026-08-03 Issue #13 结构复核：将 120 行软阈值和多文件功能目录规则写入根 `AGENTS.md`，并按行为整理 Scheduler、Workflow、Workspace 及对应测试，公开 Interface 不变。
- [x] 2026-08-03 Issue #13 路径复核：曾用 `.symphoneer/` 收拢进入 Git 的 `WORKFLOW.md` 与被忽略的 Workspace / events / artifacts / logs；该临时布局随后被同日“项目归属不等于软件存储责任”的决定取代。
- [x] 2026-08-03 Issue #13 存储与结构复核：基线 `b9a51ca395e039b9598edeb0863f62ecb12bc352`、工作树干净；repository-owned contract 与软件存储责任已分离，Scheduler 已按 dispatch / attempt / retry 行为整理，Standards / Spec 双轴复审通过，`pnpm check` 为 24/24。
- [x] 2026-08-03 文档 Harness：把旧 Plan 规则与分区索引收敛为分层 `AGENTS.md`，将计划目录简化为 `plans/`，去除 Codemap、设计和计划中的重复事实；`pnpm check` 通过。
- [x] 2026-08-03 Issue #13 PR 复审：修复 Workspace hook 后复检 / 删除 / 稳定 identity 所有权、连续 Turn、容量等待计数与未来 start、失败转换原子性、reconciliation 部分写入与时钟前置校验、Attempt / Verification / Intervention 时间顺序、Verification 完整证据与 exit status、成功/failure 和 Eligibility 结果一致性；定向回归和全量检查通过。
- [ ] Phase 3：打通 GitHub Tracker、Workspace、Codex App Server 和独立 Verification。
- [ ] Phase 4：实现 JSONL 历史投影、独立 Runtime 和普通 Next.js Web Dashboard。
- [ ] Phase 5：实现受控 MCP 查询与操作。
- [ ] Phase 6：创建私有 fixture 并完成真实 E2E Smoke。
- [ ] Phase 7：在核心闭环后接入非阻塞 Phoenix 观测。
- [ ] Follow-up：只在远程仓库和 `pnpm check` 稳定后启用定时检查；只在 Web 需要桌面分发时评估 Electron。

文档 Harness 增量已在本地完成，不改变 Issue #13 代码行为。恢复时先读取根 `AGENTS.md`、`docs/AGENTS.md`、`docs/plans/AGENTS.md` 并核对工作树：若本 Diff 尚未发布，先完成提交与 PR 更新；若工作树干净，下一增量进入 Phase 3 / Issue #14。

## Surprises & Discoveries

- 2026-08-01 — 初始目录只有 22 个 Markdown 文件，没有 `.git`、应用代码、manifest、锁文件、CI 或非 Markdown 文件。初始文档检查观察到 56 个本地链接且无断链，六个分区无漏索引叶子。
- 2026-08-01 — 固定 Symphony SPEC 的现有 Tracker 合同面向 Linear，GitHub Issues 是 Symphoneer 的显式扩展，不能冒充为从 SPEC 自动获得的能力。
- 2026-08-01 — 文档结构、repository system of record 和定时检查已构成当前项目的开发基线。
- 2026-08-01 — Apps SDK UI 组件和 MCP App 宿主桥接是不同契约；选择 OpenAI UI 组件不能单独证明 Codex MCP App UI 兼容。必须在本地 Codex 宿主中做真实 Smoke。
- 2026-08-01 — Codex App Server 的具体 Schema 会演进，因此实现应由当前本地 CLI 生成 TypeScript 契约，而不是从调研文档手写字段。
- 2026-08-01 — Phoenix 只能是可丢失的诊断副本。如果它变成 Task 或 Review 事实源，核心闭环就会被非必需外部服务阻塞。
- 2026-08-01 — Git 默认对中文路径使用带引号的 C-style 转义输出，按文本行尾检查 `.md` 会误报。暂存与提交文件类型改用 `-z` 的 NUL 分隔原始路径和 Ruby 标准库校验。
- 2026-08-02 — Next.js 官方将 custom server 定位为内建 Router 无法满足需求时的逃生口，并说明它会失去部分优化且 standalone 输出不会自动追踪 custom server 文件。Symphoneer 无需为 Runtime 共进程承担这项成本。
- 2026-08-02 — Electron 本身已有 Main、Renderer、Preload 进程边界；保留独立 Runtime Module 比提前把 Scheduler 嵌入 Next.js 更适合未来宿主复用。
- 2026-08-02 — Codex App Server 已提供 Thread / Turn / Item、流式事件、中断和审批等控制原语；Claude Agent SDK 与 OpenCode Server 也存在未来接入路径，但协议语义不同，不能提前压成万能 Provider SDK。
- 2026-08-02 — Anthropic 的长时任务材料支持渐进上下文、增量目标、状态交接和独立验收；这些习惯适用于整个仓库 Harness，不要求把 Planner、Evaluator 或多 Agent 编排加入产品。
- 2026-08-02 — Issue #13 实施前重新核对 `openai/symphony`：远端 `main` 仍指向固定 commit `f8e8b8a670c799f6e0ade7a8c25c4bf4a4a56ec7`，固定版与 live `SPEC.md` 的 SHA-256 均为 `29d6b45a85453e045883c064c0e08595f9d4a33f9a2527f649bc1363b74e0176`，没有需要升级基线的差异。
- 2026-08-02 — 实施环境为 Node.js `v24.16.0` 与 pnpm `11.15.1`；Node 当前可直接运行 TypeScript type stripping，因此测试入口不需要额外 TypeScript runner。
- 2026-08-02 — Node type stripping 只接受可擦除语法；首个 Workflow 测试发现 constructor parameter property 会触发 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。实现改为普通 class field，并用 TypeScript `erasableSyntaxOnly` 在静态检查阶段阻止同类回归。
- 2026-08-02 — 首轮独立 spec / standards 审查共提出 10 条 findings：RetryQueued 消费、ID 规范化、Workspace 生命周期、Task / Workspace 身份、Attempt / Turn 状态组合，以及 Node 类型版本、package 边界、`z.json()`、统一终止清理、临时目录清理；修复后原 findings 全部关闭。
- 2026-08-02 — 复审进一步发现调用者可伪造 Attempt 序号/来源、Workspace 等价路径与回收身份、hook 后代进程、无界幂等缓存，以及旧的 17 条测试记录。根因修复为 Scheduler 严格序号/来源校验、canonical path + Manager identity registry + symlink guard、超时终止进程组、SHA-256 指纹与 1,000 条进程内重放窗口；新增回归后 `pnpm check` 为 24/24。
- 2026-08-03 — 120 行 review threshold 原先只存在于本计划的 Decision Log，没有进入根 Agent 工作规则；Issue #13 因而形成 609 行 `scheduler.ts`、324 行 `workspace.ts` 和 265 行 `workflow.ts`。用户确认规则含义是“功能拆成多个文件后统一进入同名目录”，不是强制每个文件少于 120 行；实现据此改为目录 Module 和单一 `index.ts` Interface。
- 2026-08-03 — 根 `WORKFLOW.md`、`.workspaces/` 与整体忽略的 `.symphoneer/` 把一个产品的配置和本地状态分散在三处，也会阻止 `.symphoneer/` 下未来策略文件进入 Git。改为只忽略明确的运行数据子目录后，配置可版本化且新增文件默认可见。
- 2026-08-03 — 把 Workspace、events、artifacts 和 logs 放回目标仓库的 `.symphoneer/` 仍然混淆了项目关联与软件生命周期：这些数据与项目关联，但由安装软件创建、轮转、恢复和回收。规范性边界因此改为 repository contract 留在 Git，运行数据按 project ID 进入操作系统应用位置。
- 2026-08-03 — 固定 Symphony SPEC 的 `workspace.root` 是可选 repository 配置，缺省为系统临时目录下的 `symphony_workspaces`；Loader 增加 Host 根目录优先级即可让未来安装 Runtime 注入 application data 路径，同时保留未注入时的上游行为。
- 2026-08-03 — `policy.ts` 只有 30 行却同时承载 dispatch order、retry backoff 和状态标准化，按行数无需拆、按变化原因必须拆；相反 `core-scheduler.ts` 约 138 行但集中表达一个 Interface，保留为 120 行软阈值的明确例外。
- 2026-08-03 — 定向测试命令 `node --test tests/core/scheduler` 把目录当成模块并以 `MODULE_NOT_FOUND` 退出 1；改用 `node --test tests/core/scheduler/*.test.ts` 后 10/10 通过，失败只改变验证命令，不改变实现。
- 2026-08-03 — 每个文档分区都放 `index.md` 会让路由、事实源说明和状态在根 `AGENTS.md`、Codemap 与叶子文档之间重复；Design / Product Specs / References 文件较少，可由 `docs/AGENTS.md` 直接路由，只有 Research 和 Plans 需要局部 Agent Interface。
- 2026-08-03 — PR 复审暴露了三个共享状态转换缺口：fatal `before_run` 失败仍保留活跃 Workspace owner、`attachTurn` 无法推进同一 Thread 的下一 Turn、容量等待复用了 worker failure 计数。修复均落在共享转换入口，不增加新公开 Interface。
- 2026-08-03 — 后续 PR 复审发现 `attachTurn` 和 `terminateRunning` 在新快照通过 Schema 校验前释放旧 Turn / Thread；无效时间或 failure 会让 Attempt 与所有权 Map 分叉。转换顺序改为先构造并校验全部新状态，再执行共享 Map 变更。
- 2026-08-03 — 再次复审发现 reconciliation 会在后续无效时间失败前更新已保留 Task 的缓存状态，且成功 Attempt 可携带 failure。reconciliation 现在进入循环前校验时间，Attempt Schema 直接拒绝成功与 failure 并存；因公开 snapshot 不暴露内部 running Task 缓存，回归通过后续 per-state capacity 决策观察部分写入。
- 2026-08-03 — `reconciliation.test.ts` 与 `retry.test.ts` 超过 120 行软阈值，但分别集中表达 reconciliation 和 retry 的状态机场景并只经过 Scheduler Interface；本轮保留行为局部性，避免为行数拆出重复 setup 或内部文件镜像。
- 2026-08-03 — 第四轮 PR 复审发现 `remove()` 可删除活跃 Workspace、Attempt 时间可倒退、Eligibility 布尔值与 reasons 可矛盾。修复落在 Workspace lifecycle guard 和共享 Contract Schema；旧 symlink 安全测试改为先 `finish()` 再删除，以保留真实 retained-only 删除前置条件而不弱化路径防护。
- 2026-08-03 — 第五轮 PR 复审发现 `workspace_owned` 混合了暂态 owner 与永久 identity 冲突、稳定 Workspace ID 可换路径、连续 Turn 与 Verification 时间可倒退，以及 ISO-valid 旧 reconciliation 时间仍可造成部分写入。Core 现在单列 `workspace_identity_mismatch`、绑定 ID/path、在写入前校验活跃 Attempt 时钟，并在共享 Schema 固化 Verification chronology。
- 2026-08-03 — 第六轮 PR 复审发现 setup hook 可在成功退出前替换 Workspace 路径、failed Verification 可带 exit code 0、Intervention 决定可早于请求。`prepare()` 现在在全部 setup hooks 后最终复检路径；共享 Schema 固化 `passed ⇔ exitCode 0` 与 Intervention chronology。
- 2026-08-03 — 第七轮 PR 复审发现未运行 Verification 可保留半份 completion evidence，且 Retry 可创建时间晚于 transition clock 的活跃 Attempt。Verification Schema 现在要求执行状态与 completion time / artifact 分别等价；Retry 在占用 claim 和 capacity 前校验 proposed start。

新发现必须记录日期、直接证据和它改变了哪个计划或决定。未证实猜测不进入本节。

## Decision Log

| 日期 | 决定 | 理由 | 责任人 |
|---|---|---|---|
| 2026-08-01 | 产品主干是 Symphony-first 交付闭环 | 用一条可观察、可判定的 Task 交付路径验证价值 | User |
| 2026-08-01 | TypeScript 实现 Symphony Core Conformance，固定 `f8e8b8a` SPEC | 与 Web / MCP 共享类型，同时保留稳定上游基线 | User |
| 2026-08-01 | GitHub eligibility 为 `open` + `symphoneer:ready` + not `symphoneer:review` | 用原生状态和两个显式标签表达可调度与待审查 | User |
| 2026-08-01 | Codex App Server 拥有 Thread / Turn / Item；Verification 由 Symphoneer 独立运行 | Agent 自述和 Turn 完成不能成为自证 oracle | User |
| 2026-08-01 | V1 默认 `Task → Attempt → 一个活跃 Agent Session`；同一 Task 多 Thread 的 `AgentRun` 聚合后置 | 先验证跨 Task 并行和单 Task 可恢复闭环，不把未定义的并发写入带进核心 | User |
| 2026-08-01 | Human Review 拥有最终验收、Merge、Close 和接管权 | 自动化不替代人的交付决定 | User |
| 2026-08-01 | Web-first UI，MCP 支持查询与受控操作，Electron 后置 | 先建一个业务入口和一套 UI，再按需增加宿主 | User |
| 2026-08-01 | MCP 不提供 Commit、Merge 或权限扩大 | 控制面不越过 Git、GitHub 和人的权威 | User |
| 2026-08-01 | JSONL + immutable artifacts 作为 Symphoneer 历史投影 | V1 需要可重放证据，但无需引入数据库 | User |
| 2026-08-01 | 私有 `icho648/symphoneer-fixture` 只在真实 Smoke 阶段创建 | 用独立、可控的仓库测试外部写操作，不污染主项目 | User |
| 2026-08-01 | Phoenix 在核心闭环后接入且非阻塞 | 观测不应成为业务正确性依赖 | User |
| 2026-08-01 | 初始提交仅包含 Markdown，不配 remote | 先建立可审核的文档系统记录，不偷跑实施 | User |
| 2026-08-02 | Runtime 是独立 Node.js + TypeScript 前台进程；Web 是普通 Next.js 进程，不使用 custom server | 浏览器或 Web 重启不应拥有 Attempt 生命周期；CLI 与未来 Electron Main 可复用同一 Runtime | User |
| 2026-08-02 | Runtime 不自行 daemonize；由 launcher 持有并转发停止信号 | 保留简单可观察的本地进程模型，不预建 PID 或后台服务管理系统 | User |
| 2026-08-02 | Agent Runner Seam 的 V1 只有 Codex App Server Adapter 和 Fake | 用一个真实 Adapter 验证边界；第二个真实实现出现后再提炼共同能力 | User |
| 2026-08-02 | Attempt 是业务对象，Provider Session ID 只是引用；`pause` 中断当前 Run 并停止自动继续 | 避免核心模型被 Codex 专有生命周期占据，也避免把暂停误解为冻结进程 | User |
| 2026-08-02 | Runtime Log、Domain Event、Verification Artifact 与可选 Trace 分层 | 诊断、业务重放、独立验收和外部观测承担不同证明责任 | User |
| 2026-08-02 | OpenAI UI 包提供视觉基础，Task Board 采用 macOS 风格信息密度但仍是 Web | 追求熟悉的桌面体验，不声称原生或复制私有控件 | User |
| 2026-08-02 | 项目 Harness 吸收渐进上下文、增量任务、交接和可执行验收 | 提高长时开发可恢复性，但不扩大 Symphoneer 产品范围 | User |
| 2026-08-02 | Issue #13 只实现四个公开测试 Seam：共享契约、Workflow loader/renderer、Core Scheduler/Workspace 所有权、Agent Runner + Fake | 它们覆盖本 Issue 的跨边界与确定性验收；真实 GitHub、Codex、worktree、Runtime 和 Verification 留给后续 Issue | Codex，依据已接受设计与 Issue #13 |
| 2026-08-02 | Retry / continuation 只能通过 `transitionRetry` 消费队列，Attempt 序号严格按 Task 历史递增 | 防止调用者绕过 backoff 或伪造 provenance，保留 Scheduler 单一权威 | Codex，依据 Issue #13 复审 |
| 2026-08-02 | Issue #13 的 WorkspaceManager 只管本地目录、四个 hook 和进程内身份；Git worktree / 脏目录保护留给 Issue #14 | 闭合固定 SPEC 的 Core 生命周期，不偷跑真实 Adapter 范围 | Codex，依据 Issue #13 与非目标 |
| 2026-08-03 | 120 行是手写代码 review threshold；一个功能拆成多个文件后统一放入同名目录 | 保持功能局部性和导航一致性，同时避免为凑行数制造浅层转发 | User |
| 2026-08-03 | `.symphoneer/` 同时保存 repository contract 与被忽略的本地运行数据 | 临时收拢产品文件；已被同日后续存储责任决定取代 | User，superseded |
| 2026-08-03 | `.symphoneer/` 只保存进入 Git 的项目契约；Project-scoped runtime data 由安装软件放在操作系统 application data，Runtime Log、Cache、Credentials 分别使用 OS 原生位置 | 数据是否关联项目不决定物理存储；写入者、生命周期与恢复责任才决定所有者 | User |
| 2026-08-03 | Module 顶层按能力分类，内部按 dispatch / attempt / retry 等行为聚类；有清晰入口的目录可用 `index.ts`，功能 `index.ts` 可承载主行为，Module 根 `index.ts` 只暴露稳定 Interface | 让目录表达产品行为而非文件种类，同时允许明确入口而不制造纯 barrel 或隐藏副作用 | User |
| 2026-08-03 | 文档使用分层 `AGENTS.md`：`docs/AGENTS.md` 总路由，Research 与 Plans 保留局部入口，`exec-plans/` 简化为 `plans/` | 让 Agent 规则随目录按需加载，同时避免为少量叶子文件维护浅层 `index.md` | User |

新决定如果改变规范性边界，必须同时更新对应 design doc 或 product spec；ExecPlan 不能单独覆盖规范。

## Outcomes & Retrospective

当前已产生两层结果：确认后的产品/架构契约已被 Markdown 固化；Issue #13 的 TypeScript workspace、版本化共享 Schema、Workflow loader/renderer、Core Scheduler、本地目录 WorkspaceManager 和 Agent Runner Fake 已完成本地范围并通过 `pnpm check` 与双重实现审查。这些证据不证明真实 GitHub、Codex、Git worktree、Verification 执行、Runtime 或用户交付闭环。

计划只在下列结果全部有直接证据后才可移入 `completed/`：

- 真实 fixture 上的 Issue 能被正确筛选、调度、执行、独立验证并交给人审查。
- Web 和 Codex MCP App UI 能读取同一投影，受控操作的幂等、版本与确认边界已被验证。
- 进程重启、重试、超时、事件损坏和 Tracker 冲突有可演练恢复路径。
- Phoenix 关闭或发送失败不阻塞核心闭环，且启用时可由 Symphoneer ID 追溯 Trace。
- 文档、检查和真实 Smoke 证据一致，用户完成人工验收。

完成时在本节记录：实际结果、未完成或删除的范围、与原计划的差异、量化证据、人工决定和可复用经验。Issue #13 已有本地确定性证据；上述完整 V1 结果仍为 `Not verified`。

## Context and Orientation

当前仓库包含文档系统和 Issue #13 的两个 package：[`../../../packages/contracts/`](../../../packages/contracts/) 保存跨边界 Schema，[`../../../packages/symphony-core/`](../../../packages/symphony-core/) 保存 Workflow、资格、调度、Workspace 与 Agent Runner seam。Scheduler、Workflow、Workspace 的内部实现分别位于同名目录，只由 Module 根 `index.ts` 暴露公开 Interface；Scheduler 内部再按 dispatch / attempt / retry 行为聚类，功能目录 `index.ts` 承载主入口。对应场景测试位于根 [`../../../tests/`](../../../tests/) 下。根 [`../../../ARCHITECTURE.md`](../../../ARCHITECTURE.md) 是真实 Codemap；规范性产品与架构决定仍在 [`../../design-docs/`](../../design-docs/)。

核心术语：

| 术语 | 定义 |
|---|---|
| Task | GitHub Issue 中的持久工作身份与意图 |
| Eligibility | Issue 为 `open`、有 `symphoneer:ready`、无 `symphoneer:review` 的可调度判定 |
| Attempt | Symphoneer Runtime 的 Symphony Core 为某 Task 发起的一次可重试执行尝试 |
| Workspace | 与 Task / Attempt 关联的隔离工作目录和分支 |
| Worktree | Workspace 的 Git checkout 实现；Thread 使用其路径，但不拥有其生命周期 |
| Codex Run | App Server Thread / Turn / Item 及工具事件；V1 默认一个 Attempt 一个活跃 Agent Session |
| Verification | Symphoneer 在 Agent 执行后独立运行项目检查得到的结果与 artifact |
| ReviewDecision | 人基于变更和证据作出的 Merge、继续、Follow-up 或接管决定 |
| Historical Projection | 由 append-only JSONL 重放得到的 Symphoneer 查询状态，不是外部系统的原生真相 |
| Artifact | 与稳定 ID 关联的不可变输出，例如验证日志、事件片段或差异引用 |
| Intervention | 需要 Host / 人回答或批准后才能继续的显式停点 |
| Agent Runner | Scheduler 调用 Agent Runtime 的小 Interface；V1 只有 Codex Adapter 与 Fake |
| Runtime Log | 可轮转的结构化运行诊断，不是业务状态或验收证据 |
| Domain Event | append-only 的业务状态变化，可重放查询投影 |

事实源与访问面的固定边界：

| 数据或行为 | 权威来源 |
|---|---|
| Issue 身份、意图、状态、标签 | GitHub Issues |
| Eligibility、Dispatch、Retry、Reconciliation、Workspace 生命周期 | 独立 Symphoneer Runtime；语义遵循固定 Symphony SPEC |
| Thread、Turn、Item、Agent 运行事件 | Codex App Server |
| Diff、Commit、Branch | Git |
| PR、Checks、Review、Merge | GitHub 原生对象与人 |
| 项目检查结果 | Symphoneer 独立运行产生的 artifact |
| 最终交付决定 | Human Review |
| Runtime Log | Symphoneer Runtime 诊断输出 |
| Domain Event / 历史查询与 UI 状态 | Symphoneer append-only projection |
| Trace / Span / Evaluation | Phoenix 可选诊断副本 |
| Web、CLI、MCP、后续 Electron | 访问面，不是事实源 |

计划中的最小代码结构如下；实施时不为未来 Provider 或宿主预建更多包：

```text
packages/contracts/       Web、CLI、MCP、Runtime 共享的类型和边界验证
packages/symphony-core/   与固定 SPEC 对齐的调度、Workspace、Attempt 与 Verification 核心
apps/runtime/             Adapter 装配、JSONL、HTTP / SSE、CLI 入口与进程生命周期
apps/web/                 普通 Next.js Web UI / BFF
tests/
  core/
  contracts/
  integration/
  e2e/
  fixtures/
```

`symphony-core` 不依赖 Next.js、GitHub 或 Codex 进程实现；Web 只依赖共享契约，Runtime 负责装配 Adapter。Electron、Claude、OpenCode、数据库、队列和多 Agent 不在该结构中，因为它们不属于 V1 验收。

## Plan of Work

### Phase 0 — 文档整理与本地 Git 检查

维护规范性决定、Agent 导航和本 Plan。本轮把旧分区索引收敛为 `docs/AGENTS.md` 与必要的局部 `AGENTS.md`，并让项目检查验证文档路由覆盖、Plan 12 章和路径一致性。检查通过的 revision 写入 Git 历史；停点以该 commit、本地同一 `HEAD` 和干净工作树为恢复依据。

### Phase 1 — 项目检查入口与最小 TypeScript workspace

在新授权后创建首个实现提交：`package.json`、workspace 配置、`.gitignore`、TypeScript 配置和 `.symphoneer/WORKFLOW.md`。只安装当前阶段使用的依赖。建立当前已有行为所需的 `pnpm check` 和 `pnpm test` 入口：`pnpm check` 串联格式/静态检查、类型检查、最小测试、Markdown 本地链接、Agent 导航覆盖、Plan 章节和架构依赖方向。不为尚未存在的 Web / MCP 消费者创建占位脚本。

测试统一进入根 `tests/{core,contracts,integration,e2e,fixtures}`，不创建 colocated `*.test.ts`。单元测试集中在状态转换、资格判定、backoff、幂等、解析和 reducer；UI 主要使用交互级测试、可访问性检查和少量 Playwright 主流程，少写组件级单元测试。

本阶段不创建定时器。只有远程仓库存在且 `pnpm check` 经过稳定运行后，才用仓库原生定时工作流每周检查；巡检只报告或更新一个问题，不自动修复，也不自动加 `symphoneer:ready`。

### Phase 2 — 共享契约与 Symphony Core Conformance

在 `packages/contracts` 定义 Task、Attempt、Workspace、Verification、ReviewDecision、Intervention、DomainEvent、API snapshot 和 API error 的最小边界 Schema。只有跨进程、文件或网络边界的数据使用运行时验证；纯内部状态不重复建模。

在 `packages/symphony-core` 按固定 SPEC 依次实现 `.symphoneer/WORKFLOW.md` 加载与校验、资格判定、调度与并发所有权、Workspace 生命周期、Agent Runner 结果、Retry / backoff 和 reconciliation。核心只依赖小 Interface：Tracker Seam 只有 GitHub 与 Fake，Agent Runner Seam 只有 Codex 与 Fake；不创建 Provider factory、通用事件全集或 capability 注册表。

实现下文 [Agent Runner Interface](#agent-runner-interface)，先用 Fake 完成确定性测试；Fake 不能作为任何 Provider 兼容证据。

### Phase 3 — GitHub、Workspace、Codex 与独立 Verification 闭环

实现唯一的 GitHub Issues Adapter，保留原生 ID 和深链，并对 `open` + `symphoneer:ready` + not `symphoneer:review` 做可独立测试的筛选。访问令牌只来自进程环境或本地认证工具，不写入配置、Runtime Log、Domain Event、artifact 或 Phoenix。

先运行 App Server 契约生成命令的 `--help`，再用当前 CLI 生成 TypeScript Schema 并记录 Codex 版本。实现 `CodexAppServerAdapter` 的初始化、Thread / Turn 执行、原生事件保存、超时、中断、审批与介入响应。`threadId`、`turnId` 只是 Attempt 的 Provider 引用；`pause` 中断当前 Run、保留 Workspace 与 Session 引用并停止自动继续，不冻结 Runtime 进程。

每个生产 Adapter 必须通过共享契约测试和一条真实 Smoke。V1 不实现 Claude 或 OpenCode；第二个生产 Adapter 获得采用决定后才提炼公共能力，缺失能力明确为 `unsupported`，工具权限不得冒充 sandbox。不在 Agent Runner 中伪造 Verification；Turn 结束后由 Symphoneer 独立运行 `symphoneer.verification` 指定的命令。

本阶段先用本地 fake 仓库和可控失败测试闭环，不创建 GitHub fixture。

### Phase 4 — JSONL 投影、独立 Runtime 与 Web Dashboard

在 `apps/runtime` 建立 append-only Domain Event store 和 immutable Verification Artifact store。它们按稳定 project ID 进入操作系统 application data；Workspace 也由 Host 在同一软件管理域下分配，但不得放入可被系统清理的 Cache。Domain Event 带有稳定 ID、Schema 版本、来源、时间和相关 ID；投影必须可从空目录重放。损坏或不支持的记录不得被静默跳过。Runtime Log 使用操作系统 Logs 目录并可轮转，Trace 是可选、可丢失副本，两者都不能重建业务状态或改变验收。

Runtime 是独立 Node.js + TypeScript 长期前台进程，由 `pnpm dev` launcher 持有，不自行 daemonize、不创建 PID 文件或后台 `start / stop / status`。它通过 loopback HTTP / SSE 提供查询与受控操作；先用 Node 原生 HTTP / URL / stream，只有真实复杂度需要时才引入框架。关闭浏览器或重启 Web 不改变 Attempt；明确退出 launcher 时才向 Runtime 和 Web 转发停止信号。

`apps/web` 使用普通 Next.js，不使用 custom server。Web UI / BFF 和 CLI 都是 Runtime 客户端，不复制 Scheduler。Web 以 OpenAI UI 包为组件基础，通过系统字体、紧凑密度、分栏、键盘操作、命令面板、轻量材质和克制动画形成接近 macOS 的体验，但不声称原生或复制私有控件。

Task Board 以 [`manual-delivery-flow.md`](../../product-specs/manual-delivery-flow.md#task-board-规范性文字图) 为唯一信息架构规格：Task 是主对象，Workspace 只在 Attempt 详情出现，Runtime 在线只代表连接，Verification 与 Agent 完成分离，最终 Review 由人决定。

本阶段在开发服务存在时新增 `pnpm dev`，在第一个可自动 Web 主流程存在时新增 `pnpm test:e2e`；不在消费者之前创建空脚本。

### Phase 5 — 受控 MCP

将同一本地服务暴露为 MCP 工具和 MCP App UI 资源。查询工具可列出/读取 Task 和 Attempt；变更工具仅限 refresh、dispatch、pause、retry 和 respond to intervention。每个变更请求包含目标版本或前置条件、幂等键，并在执行前重读当前状态和要求 Host 确认。

用 MCP Apps 标准连接 Host 和 UI，Apps SDK UI 只用于视觉组件。必须在真实 Codex 宿主中验证资源渲染、工具调用、确认与错误表达。

本阶段在首个可自动 MCP 故事存在时才扩展 `pnpm test:e2e`。

### Phase 6 — 私有 fixture 真实 E2E Smoke

在进入本阶段时再确认当前 GitHub 账号和目标名称不冲突，然后创建 `icho648/symphoneer-fixture` 私有仓库。fixture 只包含一个最小 TypeScript 应用、一条 `pnpm check`、一份 `.symphoneer/WORKFLOW.md` 和所需标签。

创建一个小型功能 Issue，让它经过资格门禁、Attempt、Workspace、Codex、PR、独立 Verification、`symphoneer:review` 写回和人工 Review。人手工 Merge / Close，然后验证 Symphoneer 对账到终态并清理本地 Workspace。不删除 fixture 仓库，使它保留为可重现测试资产。

### Phase 7 — Phoenix 非阻塞观测

只在 Phase 6 核心 Smoke 通过后安装 Phoenix / OpenTelemetry 相关客户端。Phoenix 作为外部可选 sidecar，Symphoneer 不内嵌或复制 Phoenix UI。Attempt 是根 span，Turn 和 Verification 是子 span，工具调用使用 tool span；所有 span 保留 Symphoneer Task / Attempt / Turn / Verification ID。

对 prompt、输出、工具参数和日志做默认脱敏；凭据、私有源码全文、原始 Provider payload、签名 URL、未经脱敏的错误原因、完整命令输出或未审查的工具 payload 不发送到 Phoenix。无 endpoint、超时、网络失败或 exporter 异常都只记录受控诊断，不改变业务状态。

## Concrete Steps

所有命令默认在仓库根目录执行。未到达的阶段命令只是计划，状态为 `Not verified`；执行者必须在当时的 `Progress` 和 `Artifacts and Notes` 记录实际命令、版本和输出。

### Repository Harness 检查

```sh
pnpm check:project
```

预期：本地 Markdown 链接、Agent 导航覆盖、Plan 12 章、测试位置和依赖方向全部通过。

### 每个实施阶段的固定入口

```sh
git status --short
git diff --check
pnpm check
```

预期：开始前已知用户改动范围；Diff 没有空白错误；当前阶段提供的所有检查通过。Phase 1 创建 `pnpm check` 之前，先记录对应的最小独立命令；不用不存在的脚本冒充证据。

### App Server 契约固定

```sh
codex --version
codex app-server --help
codex app-server generate-ts --help
codex app-server generate-json-schema --help
```

预期：记录当前 Codex CLI 版本、App Server 传输方式和生成子命令的实际参数。执行者必须把根据 `--help` 得到的精确生成命令补回本节，再生成并审查 TypeScript Schema。如果子命令不存在，不猜测替代参数，在 `Surprises & Discoveries` 记录并重做实现决定。

### 本地闭环与 Web / MCP 检查

Phase 1 只创建当前有消费者的稳定脚本：

```sh
pnpm check
pnpm test
```

`pnpm check` 是合并前的唯一全量入口；`pnpm test` 覆盖当前已存在的确定性单元/集成行为，且测试文件只位于根 `tests/`。Phase 4 开发服务存在后再创建一个 launcher 驱动的 `pnpm dev`，并验证：Runtime 与普通 Next.js 是两个进程；Web 重启后同一 Attempt 仍可查询；父 launcher 退出时两个进程都收到停止信号。可自动 Web 主流程存在后再创建 `pnpm test:e2e`；Phase 5 再将 MCP 故事加入同一 E2E 入口。这些脚本当前都不存在，状态为 `Not verified`。

### fixture 创建与 Smoke

仅在 Phase 1–5 的本地验收通过后执行：

```sh
gh auth status
gh repo view icho648/symphoneer-fixture
gh repo create icho648/symphoneer-fixture --private
gh label create 'symphoneer:ready' --repo icho648/symphoneer-fixture
gh label create 'symphoneer:review' --repo icho648/symphoneer-fixture
```

`gh repo view` 预期在首次创建前报告仓库不存在；如果已存在，停止创建并先核对所有权和内容。创建后用非交互命令推送最小 fixture，再用 `gh issue create` 创建一个边界清晰的 Issue 并加 `symphoneer:ready`。不在命令行、日志或计划中打印 Token。

真实 Smoke 的通过证据必须同时包含：Issue URL、Attempt ID、Workspace / branch、Codex thread ID、Verification 命令与退出状态、PR URL、`symphoneer:review` 的 Tracker 复读、人工 Review 决定、Merge / Close 的原生链接以及本地清理结果。

### Phoenix 检查

对一个明确的外部 Phoenix endpoint，分别执行启用和禁用两套 Smoke。禁用或无法连接时，同一核心任务仍必须到达 Human Review；启用时，必须能用 Attempt ID 查到根 span 及 Turn / Verification 子 span，且抽样确认没有 Token、私有代码或未审查 payload。实际启动 Phoenix 服务的命令取决于当时已安装的外部环境，不在本仓库预设容器或部署方式。

## Validation and Acceptance

验收遵循“项目事实 -> 确定性检查 -> Agent 产物 -> 独立 Verification -> 真实外部证据 -> Human Review”。任何一层不能替代其后的层级。

| AC | 验收条件 | 验证方式 | 当前状态 |
|---|---|---|---|
| AC-00 | 本轮文档二次优化只修改 Markdown，索引完整，ExecPlan 保持 12 个必需章节 | 本地链接、索引、章节、文件类型和 `git diff --check` | Pass — documentation only |
| AC-01 | 只有 `open` + `symphoneer:ready` + not `symphoneer:review` 的 Issue 可调度 | 表格测试所有标签/状态组合，再用 fixture Smoke | Partial — deterministic Pass；fixture Not verified |
| AC-02 | 同一 Task 没有未定义的并发 Attempt、Workspace 所有者或活跃 Turn | 状态机/并发测试，进程重启对账 Smoke | Partial — strict Attempt sequence, canonical Workspace ownership and Turn ownership Pass；restart Smoke Not verified |
| AC-03 | Retry、timeout、cancel、失联和重启能对账，不重放已完成外部写入 | fake clock / runner 测试；注入失败的恢复 Smoke | Partial — due-time transition, retry/backoff, bounded in-memory idempotency and reconciliation Pass；persistent/external recovery Not verified |
| AC-04 | Agent 声明或 Turn 完成不能把未运行/失败检查升级为通过 | 伪造完成声明与失败检查的集成测试 | Partial — Verification Schema rejects false pass；independent executor Not verified |
| AC-05 | Verification 证据包含命令、退出状态、必要输出、时间和对应版本 | artifact Schema 测试和 fixture 抽查 | Partial — versioned result Schema Pass；artifact production Not verified |
| AC-06 | JSONL 可从空投影重放，损坏记录有明确停止/恢复路径 | golden event replay、截断尾记录、未知 Schema 版本测试 | Not verified |
| AC-07 | Web、CLI 和 MCP 展示同一 Runtime 投影，实时更新不创建第二套业务状态 | API contract 测试、SSE 断线重连、Web / CLI / MCP 对照 | Not verified |
| AC-08 | MCP 变更操作有版本/前置条件、幂等键、状态复读和 Host 确认，且无 Commit / Merge / 权限扩大 | 重复请求、过期版本、取消确认测试；工具列表审计 | Not verified |
| AC-09 | Tracker 与投影冲突时展示来源差异并停止危险推进 | 修改 fixture Issue 模拟竞争写，检查无静默覆盖 | Not verified |
| AC-10 | 真实 fixture 能追溯 Issue -> Attempt -> Workspace -> Codex -> Verification -> PR / Review，人仍负责 Merge / Close | 保留链接和 ID 的真实 E2E Smoke + Human Review | Not verified |
| AC-11 | Phoenix 关闭或失败不阻塞闭环；启用时 Trace 可关联且已脱敏 | disabled / unreachable / enabled 三组 Smoke 和人工抽查 | Not verified |
| AC-12 | Web 主流程具有键盘操作、正确焦点、语义标记和可读对比度 | 自动可访问性检查 + 键盘人工 Smoke | Not verified |
| AC-13 | Runtime 与普通 Next.js 分进程；Web 重启不改变 Attempt，launcher 退出可停止两者 | 进程级集成测试和人工 Smoke | Not verified |
| AC-14 | Codex Adapter 与 Fake 通过同一 Agent Runner 契约；真实 Codex 兼容性只由 Smoke 证明 | 共享契约测试 + Codex App Server Smoke | Partial — Fake contract Pass；Codex Adapter / Smoke Not verified |
| AC-15 | Runtime Log、Domain Event、Verification Artifact 与 Trace 不互相冒充，敏感字段被脱敏 | Schema / reducer / redaction 测试和 artifact 抽查 | Not verified |
| AC-16 | Task Board 以 Task 为主对象，Workspace 只在 Attempt 详情，连接、Agent 完成、Verification 与人工决定分离 | 交互测试、可访问性检查和人工 UI 审阅 | Not verified |
| AC-17 | 项目 Harness 能从 active ExecPlan 恢复当前增量、证据、失败和下一步，且不创造产品状态 | 文档契约检查和一次无聊天上下文的交接演练 | Not verified |
| AC-18 | 进入 Git 的 `.symphoneer/` 不承载软件运行数据；Host Workspace 根优先于 repository 配置，缺省仍符合固定 Symphony SPEC | Loader 表格测试、`.gitignore` / Workflow / design docs 审查 | Partial — loader deterministic Pass；安装 Runtime 与 OS 目录 Not verified |
| AC-19 | Scheduler 的公开 Interface 不变，内部按 dispatch / attempt / retry 行为聚类；目录入口规则不制造额外公开 Seam | package exports、类型检查、Scheduler 场景测试和 Codemap 审查 | Partial — deterministic Pass；未来 Runtime caller Not verified |

最小测试矩阵：

- `tests/core/`：资格判定、状态转换、backoff、幂等和投影 reducer。
- `tests/contracts/`：边界解析、Schema 版本、Tracker 与 Agent Runner 共享契约。
- `tests/integration/`：Fake Tracker / Runner / clock、Workspace 所有权、App Server 协议边界、Verification Artifact、JSONL 重放、HTTP / SSE、进程生命周期和 MCP tools。
- `tests/e2e/`：少量 Web / MCP 主流程、可访问性和真实 Smoke；不以大量组件级单测代替用户行为。
- `tests/fixtures/`：确定性输入和失败样本；Fake 或 fixture 不能证明真实 Provider 兼容。
- 故障注入：进程重启、截断 JSONL、重复请求、Tracker 竞争写、Codex 超时、Verification 超时、Phoenix 不可达。
- 真实 Smoke：私有 GitHub fixture、当前 Codex App Server、Codex MCP App UI、人工 Review、可选 Phoenix。

未实际执行的检查一律不得标记 Pass。自动检查全绿也不能替代 AC-10 和最终产品验收的 Human Review。

## Idempotence and Recovery

- **仓库增量：** 修改前确认工作树和授权范围。已提交停点必须记录 Git commit，并同时满足本地 `HEAD` 指向该 commit、工作树干净；检查失败时保留当前改动并修复，不使用破坏性 reset。
- **外部资源：** 创建 fixture、标签或 Issue 前先按精确名称查询。已存在时核对所有权和契约，不重复创建或删除未确认资源。
- **进程生命周期：** launcher 记录子进程状态并转发停止信号；Web 单独退出只触发连接丢失，不把 Attempt 写成结束。Runtime 重启后先重放 Domain Event，再对账 Tracker、Workspace 和 Provider。
- **调度所有权：** 对 Task 获取带版本的单一活跃所有权。进程重启后先对账 Tracker、Workspace 和 Codex，再决定恢复、结束旧 Attempt 或创建新 Attempt。
- **外部写入：** dispatch、pause、retry、intervention 回答和 Tracker 写回使用幂等键与前置条件。重试前查询原生状态；无法判定是否成功时进入人工介入，不盲目重放。
- **Workspace：** Issue #13 用稳定 Task identifier + hash 派生 canonical path，并在单个 Manager 生命周期内校验 ID、Task、路径与文件类型。Phase 3 重用前还必须检查 repo、branch、HEAD 和所有者；不删除有未提交改动或所有权不明的 Git worktree。
- **Codex：** timeout 或 `pause` 先请求 `RunHandle.interrupt()` 并记录最后已观察事件。重启时通过原生 ID 查询当前状态；不在两个客户端同时继续同一活跃 Turn。
- **Verification：** 每次运行绑定 Attempt、检查 ID 和精确 Git 版本。超时或中断记录为非通过；修复后生成新结果，不覆盖旧 artifact。
- **JSONL：** 只追加完整记录，完成持久化后才更新内存投影。启动时顺序验证 Schema；遇到截断尾记录或未知版本时保留原文件、报告偏移和最后有效 ID，不静默修补。
- **Projection：** 随时可从 JSONL 和 artifact 重建到新目录并对比摘要。重放不执行任何 GitHub、Codex 或 Git 写操作。
- **Phoenix：** exporter 带有界限明确的 timeout 和错误隔离。发送失败可丢弃诊断数据，但不影响核心事件持久化或状态转换。
- **密钥与日志：** Token 只存于进程内存。凭据、私有源码全文、原始 Provider payload、签名 URL 和未经脱敏的错误原因不得进入 Runtime Log、Domain Event、Verification Artifact 或 Trace；发现泄漏时停止对外传输，保留受控证据并由人轮换凭据。
- **人工恢复：** 无法证明唯一所有者、外部写入结果或对应 Git 版本时，任务进入显式介入；系统不自动 Merge、Close 或删除有价值的工作区。

## Artifacts and Notes

Phase 0 文档工作的最小证据是：

- 本 Plan 及 [`../AGENTS.md`](../AGENTS.md) 中的 active 状态。
- [`../../AGENTS.md`](../../AGENTS.md) 中的规范性文档、外部契约和证据状态。
- 本轮记录的 Git commit、本地指向该 commit 的 `HEAD`、干净工作树，以及本地链接、Agent 导航、Plan 章节和 `git diff --check` 结果。
- [`../../research/2026-08-02-anthropic-long-running-agent-harness.md`](../../research/2026-08-02-anthropic-long-running-agent-harness.md) 中的来源、采用与不采用边界。
- 2026-08-02 的旧分区索引与 Task Board 副本只保留为 Git 历史；当前以分层 `AGENTS.md` 和产品规格为单一入口。

Issue #13 本地实现的最小证据是：

- 实施前 `HEAD`：`33ebe0568f053266f7ad9b8de082be8c57b1b949`；开始时工作树干净。
- 外部契约：2026-08-02 的 Symphony `main` 与固定 `f8e8b8a` 相同，两个 SPEC 文件的 SHA-256 均为 `29d6b45a85453e045883c064c0e08595f9d4a33f9a2527f649bc1363b74e0176`。
- 2026-08-03 路径复核的中间布局曾把 `root: workspaces` 解析为 `.symphoneer/workspaces/` 并忽略四类运行目录；该证据只记录历史，已被下面的软件存储责任复核取代。
- 2026-08-03 存储与结构复核基线：`b9a51ca395e039b9598edeb0863f62ecb12bc352`，工作树干净。先修改测试后，`pnpm check:types` 因 `workspaceRoot` 尚不存在而退出 1；实现 Host 注入后同一类型检查退出 0，Workflow + Fake flow 4/4、Scheduler 10/10 定向测试通过。
- 审阅实例 `i13_storage_structure_20260803_a`：Standards 首轮 `STD-001—004` 与 Spec `SPEC-001` 均已修复；复审发现的 `SPEC-002` 相对 `$VAR` 路径问题也已修复。原两轴最终复审均为 `passed`，无仍存在 finding 或待决策项。
- 主 Agent 最终 `pnpm check`：Biome 检查 61 个文件、TypeScript、项目结构检查和 24 条 contract / core / integration 测试全部退出 0；`git diff --check` 退出 0。该证据不证明安装 Runtime、真实 OS 路径发现、GitHub、Codex、worktree、Verification store 或外部 Smoke。
- 2026-08-03 PR 复审回归：首批 Workspace retry、连续 Turn 和容量等待场景在 5 条定向测试中准确失败 3 条，修复后 5/5；后续无效 Turn、Attempt finish 和 reconciliation 时间场景在 6 条定向测试中准确失败 3 条，修复后 6/6；第三批 reconciliation 部分写入与 success/failure 冲突先由 6 条定向测试暴露 2 条失败，再补充 capacity 行为断言暴露内部缓存漂移，修复后 6/6。随后 `pnpm check` 的格式、类型、项目结构和 24 条测试全部退出 0。
- 2026-08-03 第四批 PR 复审回归：活跃 Workspace 删除、Attempt 时间倒退和 Eligibility 矛盾在 5 条定向测试中准确失败 3 条，修复后 5/5；全量检查随后暴露旧 symlink 测试绕过 retained 前置条件，调整为先 `finish()` 后，Workspace 定向测试 3/3、最终 `pnpm check` 24/24。
- 2026-08-03 第五批 PR 复审回归：Workspace identity/path、连续 Turn 时间、Verification 时间和 ISO-valid 旧 reconciliation 时间在 6 条定向测试中准确失败 5 条，修复后 6/6；`pnpm check` 的格式、类型、项目结构和 24 条测试全部退出 0。
- 2026-08-03 第六批 PR 复审回归：hook 后路径替换、failed/zero-exit Verification 和 Intervention 逆序决定在 5 条定向测试中准确失败 3 条，修复后 5/5；`pnpm check` 的格式、类型、项目结构和 24 条测试全部退出 0。
- 2026-08-03 第七批 PR 复审回归：未运行检查的半份 evidence 与未来 Retry start 在 2 条定向测试中均准确失败，修复后 2/2；`pnpm check` 的格式、类型、项目结构和 24 条测试全部退出 0。
- 2026-08-03 文档 Harness：`docs/AGENTS.md` 直接路由 Design / Product Specs / References，Research 与 Plans 使用局部 `AGENTS.md`；项目检查拒绝 `docs/**/index.md` 并验证所有叶子路由。最终 `pnpm check` 的格式、类型、项目结构与 24 条测试全部退出 0。
- 审查实例 `i13_20260802_a`：独立 standards / spec 首轮 findings 全部关闭；复审新增的 Attempt provenance、Workspace identity/path、hook process group 和有界幂等窗口问题已修复并由同一组审查者通过最终复审。
- 直接证据：[`../../../packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts)、[`../../../packages/symphony-core/src/index.ts`](../../../packages/symphony-core/src/index.ts) 与 [`../../../tests/`](../../../tests/)。
- 明确未验证：真实 GitHub / Codex Adapter、实际 worktree、Verification 执行与 artifact、Runtime / Web / MCP、JSONL、fixture、Phoenix、CI 和部署。

Repository contract 与软件运行数据的规范性布局只维护在 [`system-boundaries.md`](../../design-docs/system-boundaries.md#项目归属与软件存储责任)。本 Plan 只记录 Issue #13 已验证 Host root 注入，而操作系统路径发现、持久化和恢复仍为 `Not verified`。

每个阶段停点在本节追加最小证据摘要：提交或 Diff 引用、执行过的命令、退出状态、直接证据位置、未验证项和下一步。不粘贴无界限日志，也不用一个综合评分代替具体 AC 证据。

## Interfaces and Dependencies

### Repository-owned workflow contract

`.symphoneer/WORKFLOW.md` 已在 Phase 1 创建并通过 loader / Schema / strict template 测试，是目标仓库拥有的运行契约；当前没有 Runtime 消费者，因此不是动态 reload 或真实执行证据。当前形状是：

```yaml
tracker:
  kind: github
  provider:
    repo: icho648/symphoneer-fixture
    token: $GITHUB_TOKEN
  active_states: [open]
  terminal_states: [closed]
agent:
  max_concurrent_agents: 1
  max_turns: 20
codex:
  command: codex app-server
  approval_policy: on-request
  turn_timeout_ms: 3600000
  stall_timeout_ms: 300000
symphoneer:
  eligibility:
    required_labels: [symphoneer:ready]
    excluded_labels: [symphoneer:review]
  verification:
    - id: check
      argv: [pnpm, check]
      cwd: .
      timeout_ms: 120000
```

进入 Git 的 contract 不声明机器级 Workspace 位置。Loader 的有效值优先级是：Host 显式绝对 `workspaceRoot`、repository `workspace.root`、固定 Symphony SPEC 的 `<system-temp>/symphony_workspaces`；repository 值继续支持 `$VAR`、`~` 和相对 Workflow 路径，因此不破坏 Core Conformance。未来安装 Runtime 必须始终从操作系统 application data 或用户批准的全局设置注入已解析绝对 Host root；当前只有 loader 行为有确定性证据。Prompt 和交接策略继续由 repository-owned contract 表达。当 Verification 通过并准备交接时，工作流使用受限的 GitHub 原生工具添加 `symphoneer:review`；Symphoneer 必须重新读取 Tracker 后才进入等待人工审查状态。

### Shared contracts

`packages/contracts` 只导出下列跨边界契约：Task summary、eligibility result、Attempt snapshot、Workspace reference、Verification result、Review decision、Intervention、Domain Event envelope、projection version 和 API error。每个契约使用稳定 ID、显式 Schema 版本和来源；Codex 原生事件留在 Codex Adapter，内部不跨边界的状态不为了“共享”再造一层 DTO。

### Agent Runner Interface

规范性 Interface 见 [`system-boundaries.md`](../../design-docs/system-boundaries.md#agent-runner-seam)，当前类型落点是 [`agent-runner.ts`](../../../packages/symphony-core/src/agent-runner.ts)。Phase 3 只增加 Codex Adapter：`startOrContinue` 返回支持事件、interrupt、介入响应和 completion 的 RunHandle；不增加 Provider factory 或通用 capability 注册表。

### Local HTTP and SSE surface

V1 最小接口族是：

- `GET /api/v1/state`：当前服务与投影版本。
- `GET /api/v1/tasks` 与 `GET /api/v1/tasks/:id`：Task 投影与原生链接。
- `GET /api/v1/attempts/:id`：Attempt、Workspace、Codex、Verification 和 Review 关联。
- `POST /api/v1/refresh`、`/dispatch`、`/pause`、`/retry` 与 `/interventions/:id/respond`：受控操作。
- `GET /api/v1/events`：可从最后已知事件恢复的 SSE 流。

变更接口共享版本/前置条件、幂等键和确认语义。接口由 `apps/runtime` 提供并默认只绑定 loopback；`apps/web` 的普通 Next.js BFF、CLI 和 MCP 都是客户端。任何 LAN 或远程暴露都需要新的身份认证和威胁模型决定。

### MCP surface

MCP V1 的最小工具是：`list_tasks`、`get_task`、`get_attempt`、`refresh_tasks`、`dispatch_task`、`pause_attempt`、`retry_attempt` 和 `respond_intervention`。UI 资源只渲染 Task 和 Attempt 面板，不保存独立业务状态。

### Dependency policy

依赖在对应阶段才安装并固定版本，不在 Phase 1 一次性为未来阶段搭脚手架：

| 能力 | 默认选择 | 采用边界 |
|---|---|---|
| Runtime / language | Node.js + TypeScript | 两端共享契约；实施开始时记录当前版本 |
| Package manager | pnpm workspace | 只管理当前两个 packages 与两个 apps，不引入额外 monorepo 框架 |
| Boundary validation | Zod | 只用于外部、文件、HTTP 和 MCP 边界 |
| Workflow parsing / templates | 一个 YAML parser + LiquidJS | 只因固定 Symphony SPEC 的配置与模板契约而引入 |
| Server | Node native HTTP / URL / streams | 先使用平台能力；只在已测得复杂度需求时再评估框架 |
| Web | ordinary Next.js + Tailwind + OpenAI UI package | 用于 Web Dashboard 与 Codex MCP App UI 的视觉基础；不使用 custom server |
| MCP | Model Context Protocol TypeScript SDK + MCP Apps standard | 用于工具契约、Host 桥接与 UI 资源；不替代 App Server 运行事件 |
| Unit / integration tests | Node `node:test` 与小型 Fake | 全部位于根 `tests/`；先使用标准库，只在明确缺少能力时引入框架 |
| Browser tests | Playwright | 只在 Web 主流程存在时安装 |
| Formatting / static checks | 一个统一工具 | 实施时在已有工具与 Biome 中选最小解法，不叠加 formatter / linter |
| Phoenix | OpenTelemetry / OpenInference TypeScript 客户端 | 仅 Phase 7 安装；Phoenix 服务保持外部可选 sidecar |
| Electron | None in V1 | 只在 Web 闭环通过且出现桌面分发需求时评估；未来 Main 启动同一 Runtime Module |

明确不采用数据库、队列、LangGraph、通用 Provider factory 或没有真实替换需求的 Interface。如果标准库、平台能力或已安装依赖已解决问题，不新增包。

### Repository engineering rules

文件结构、入口、120 行软阈值和测试位置只维护在根 [`AGENTS.md`](../../../AGENTS.md)；当前物理依赖见 [`ARCHITECTURE.md`](../../../ARCHITECTURE.md)。本 Plan 只记录阶段特有 Interface、依赖采用理由和经过确认的例外。

外部契约入口：

- [固定 OpenAI Symphony SPEC](../../references/symphony-spec.md)
- [Codex App Server 契约边界](../../references/codex-app-server.md)
- [GitHub Issues 采用边界](../../references/github-issues.md)
- [Anthropic 长时 Agent Harness 研究快照](../../research/2026-08-02-anthropic-long-running-agent-harness.md)
- [Next.js Custom Server](https://nextjs.org/docs/app/guides/custom-server)
- [Electron Process Model](https://www.electronjs.org/docs/latest/tutorial/process-model)
- [Claude Agent SDK for TypeScript](https://code.claude.com/docs/en/agent-sdk/typescript)
- [OpenCode Server](https://opencode.ai/docs/server/)
- [OpenAI Apps SDK UI](https://github.com/openai/apps-sdk-ui)
- [OpenAI MCP Apps UI 指南](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Arize Phoenix TypeScript API](https://arize.com/docs/phoenix/resources/typescript-api)

外部页面说明了供应方公开契约，不证明本项目已实现或兼容。每次开始相应阶段前都要核对当前官方契约、记录版本并保留差异。

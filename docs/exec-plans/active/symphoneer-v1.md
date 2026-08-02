# Symphoneer V1 ExecPlan

> Plan status: Active  
> Decision status: Accepted  
> Implementation evidence: Documentation baseline observed; all application, GitHub, Codex, Web/MCP, Phoenix and scheduled-check behavior is Not verified
> Owner: Repository owner with Codex as implementation agent  
> Created: 2026-08-01  
> Last updated: 2026-08-02
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
2. 本地服务和 Web Dashboard 提供主操作面。
3. MCP 让人能在 Codex 中查询并执行受控操作。
4. 专用私有 fixture 验证真实 GitHub / Codex 端到端流程。
5. Phoenix 作为非阻塞诊断和评测扩展接入。

本计划的非目标包括：通用 Provider 平台、数据库、消息队列、LangGraph、多租户、云托管、自动 Merge、复制 Phoenix UI，以及在 V1 核心验收前创建 Electron 宿主。

## Progress

- [x] 2026-08-01：确认 Symphony-first、Web-first、受控 MCP、JSONL 投影、fixture 和 Phoenix 顺序。
- [x] 2026-08-01：将已确认决定回写到规范性设计、产品规格和引用文档。
- [x] 2026-08-01：完成本 active ExecPlan 和规范性 Markdown 候选内容。
- [x] 2026-08-02：将项目与仓库文档身份统一为 Symphoneer，保留 Symphony 外部契约和 `symphony:*` 标签。
- Phase 0 Git 基线是条件式进度：只有包含本文的初始 `HEAD` 存在，且提交后文件类型、工作树和 remote 检查全部通过时，才视为 Completed / Observed；否则仍是 In progress。
- [ ] 待用户审核后：明确授权进入代码阶段。
- [ ] Phase 1：建立项目检查入口和最小 TypeScript workspace。
- [ ] Phase 2：实现共享契约和 Symphony Core Conformance。
- [ ] Phase 3：打通 GitHub Tracker、Workspace、Codex App Server 和独立 Verification。
- [ ] Phase 4：实现 JSONL 历史投影、本地服务和 Web Dashboard。
- [ ] Phase 5：实现受控 MCP 查询与操作。
- [ ] Phase 6：创建私有 fixture 并完成真实 E2E Smoke。
- [ ] Phase 7：在核心闭环后接入非阻塞 Phoenix 观测。
- [ ] Follow-up：只在远程仓库和 `pnpm check` 稳定后启用定时检查；只在 Web 需要桌面分发时评估 Electron。

当前下一步只是用户审核本计划。在新的明确开发指令前，不执行 Phase 1。

## Surprises & Discoveries

- 2026-08-01 — 初始目录只有 22 个 Markdown 文件，没有 `.git`、应用代码、manifest、锁文件、CI 或非 Markdown 文件。初始文档检查观察到 56 个本地链接且无断链，六个分区无漏索引叶子。
- 2026-08-01 — 固定 Symphony SPEC 的现有 Tracker 合同面向 Linear，GitHub Issues 是 Symphoneer 的显式扩展，不能冒充为从 SPEC 自动获得的能力。
- 2026-08-01 — 文档结构、repository system of record 和定时检查已构成当前项目的开发基线。
- 2026-08-01 — Apps SDK UI 组件和 MCP App 宿主桥接是不同契约；选择 OpenAI UI 组件不能单独证明 Codex MCP App UI 兼容。必须在本地 Codex 宿主中做真实 Smoke。
- 2026-08-01 — Codex App Server 的具体 Schema 会演进，因此实现应由当前本地 CLI 生成 TypeScript 契约，而不是从调研文档手写字段。
- 2026-08-01 — Phoenix 只能是可丢失的诊断副本。如果它变成 Task 或 Review 事实源，核心闭环就会被非必需外部服务阻塞。
- 2026-08-01 — Git 默认对中文路径使用带引号的 C-style 转义输出，按文本行尾检查 `.md` 会误报。暂存与提交文件类型改用 `-z` 的 NUL 分隔原始路径和 Ruby 标准库校验。

新发现必须记录日期、直接证据和它改变了哪个计划或决定。未证实猜测不进入本节。

## Decision Log

| 日期 | 决定 | 理由 | 责任人 |
|---|---|---|---|
| 2026-08-01 | 产品主干是 Symphony-first 交付闭环 | 用一条可观察、可判定的 Task 交付路径验证价值 | User |
| 2026-08-01 | TypeScript 实现 Symphony Core Conformance，固定 `f8e8b8a` SPEC | 与 Web / MCP 共享类型，同时保留稳定上游基线 | User |
| 2026-08-01 | GitHub eligibility 为 `open` + `symphony:ready` + not `symphony:review` | 用原生状态和两个显式标签表达可调度与待审查 | User |
| 2026-08-01 | Codex App Server 拥有 Thread / Turn / Item；Verification 由 Symphoneer 独立运行 | Agent 自述和 Turn 完成不能成为自证 oracle | User |
| 2026-08-01 | V1 默认 `Task → Attempt → 一个活跃 Agent Session`；同一 Task 多 Thread 的 `AgentRun` 聚合后置 | 先验证跨 Task 并行和单 Task 可恢复闭环，不把未定义的并发写入带进核心 | User |
| 2026-08-01 | Human Review 拥有最终验收、Merge、Close 和接管权 | 自动化不替代人的交付决定 | User |
| 2026-08-01 | Web-first 本地服务，MCP 支持查询与受控操作，Electron 后置 | 先建一个业务入口和一套 UI，再按需增加宿主 | User |
| 2026-08-01 | MCP 不提供 Commit、Merge 或权限扩大 | 控制面不越过 Git、GitHub 和人的权威 | User |
| 2026-08-01 | JSONL + immutable artifacts 作为 Symphoneer 历史投影 | V1 需要可重放证据，但无需引入数据库 | User |
| 2026-08-01 | 私有 `icho648/symphoneer-fixture` 只在真实 Smoke 阶段创建 | 用独立、可控的仓库测试外部写操作，不污染主项目 | User |
| 2026-08-01 | Phoenix 在核心闭环后接入且非阻塞 | 观测不应成为业务正确性依赖 | User |
| 2026-08-01 | 初始提交仅包含 Markdown，不配 remote | 先建立可审核的文档系统记录，不偷跑实施 | User |

新决定如果改变规范性边界，必须同时更新对应 design doc 或 product spec；ExecPlan 不能单独覆盖规范。

## Outcomes & Retrospective

当前已产生的结果只是：产品边界、系统权威、人工流程、外部采用边界和完整实施计划已被 Markdown 固化为候选内容。只有容纳它们的初始提交与提交后检查成功时，文档已版本化才是 Observed；即使如此，也不证明任何产品行为。

计划只在下列结果全部有直接证据后才可移入 `completed/`：

- 真实 fixture 上的 Issue 能被正确筛选、调度、执行、独立验证并交给人审查。
- Web 和 Codex MCP App UI 能读取同一投影，受控操作的幂等、版本与确认边界已被验证。
- 进程重启、重试、超时、事件损坏和 Tracker 冲突有可演练恢复路径。
- Phoenix 关闭或发送失败不阻塞核心闭环，且启用时可由 Symphoneer ID 追溯 Trace。
- 文档、检查和真实 Smoke 证据一致，用户完成人工验收。

完成时在本节记录：实际结果、未完成或删除的范围、与原计划的差异、量化证据、人工决定和可复用经验。目前除文档基线外的结果均为 `Not verified`。

## Context and Orientation

当前仓库是 docs-only。导航从根 [`../../../AGENTS.md`](../../../AGENTS.md) 和 [`../../../README.md`](../../../README.md) 开始；规范性产品与架构决定在 [`../../design-docs/`](../../design-docs/)；用户可观察行为在 [`../../product-specs/`](../../product-specs/)；外部契约在 [`../../references/`](../../references/)；带日期的分析输入在 [`../../research/`](../../research/)。

核心术语：

| 术语 | 定义 |
|---|---|
| Task | GitHub Issue 中的持久工作身份与意图 |
| Eligibility | Issue 为 `open`、有 `symphony:ready`、无 `symphony:review` 的可调度判定 |
| Attempt | Symphony 为某 Task 发起的一次可重试执行尝试 |
| Workspace | 与 Task / Attempt 关联的隔离工作目录和分支 |
| Worktree | Workspace 的 Git checkout 实现；Thread 使用其路径，但不拥有其生命周期 |
| Codex Run | App Server Thread / Turn / Item 及工具事件；V1 默认一个 Attempt 一个活跃 Agent Session |
| Verification | Symphoneer 在 Agent 执行后独立运行项目检查得到的结果与 artifact |
| ReviewDecision | 人基于变更和证据作出的 Merge、继续、Follow-up 或接管决定 |
| Historical Projection | 由 append-only JSONL 重放得到的 Symphoneer 查询状态，不是外部系统的原生真相 |
| Artifact | 与稳定 ID 关联的不可变输出，例如验证日志、事件片段或差异引用 |
| Intervention | 需要 Host / 人回答或批准后才能继续的显式停点 |

事实源与访问面的固定边界：

| 数据或行为 | 权威来源 |
|---|---|
| Issue 身份、意图、状态、标签 | GitHub Issues |
| Eligibility、Dispatch、Retry、Reconciliation、Workspace 生命周期 | Symphony Runtime |
| Thread、Turn、Item、Agent 运行事件 | Codex App Server |
| Diff、Commit、Branch | Git |
| PR、Checks、Review、Merge | GitHub 原生对象与人 |
| 项目检查结果 | Symphoneer 独立运行产生的 artifact |
| 最终交付决定 | Human Review |
| 历史查询与 UI 状态 | Symphoneer JSONL projection |
| Trace / Span / Evaluation | Phoenix 诊断副本 |
| Web、MCP、后续 Electron | 访问面，不是事实源 |

计划中的最小代码结构只有三个责任区，实施时不为未来 Provider 预建更多包：

```text
packages/contracts/       Web、MCP、Runtime 共享的类型和边界验证
packages/symphony-core/   与固定 SPEC 对齐的调度、工作区与 runner 核心
apps/symphoneer/           CLI、本地服务、JSONL 投影、Web 和 MCP
```

如果一个 workspace 就能清晰维护上述依赖方向，不再拆包。Electron 不在该结构中，因为它不属于 V1 验收。

## Plan of Work

### Phase 0 — 文档与本地 Git 基线

建立规范性决定、本 ExecPlan 和仅 Markdown 的初始提交。验证所有本地链接、分区索引、12 个必需章节、状态语义和提交文件类型。停在这个提交，等待用户审核。

### Phase 1 — 项目检查入口与最小 TypeScript workspace

在新授权后创建首个实现提交：`package.json`、workspace 配置、`.gitignore`、TypeScript 配置和 `WORKFLOW.md`。只安装当前阶段使用的依赖。建立当前已有行为所需的 `pnpm check` 和 `pnpm test` 入口：`pnpm check` 串联格式/静态检查、类型检查、最小测试、Markdown 本地链接、索引覆盖、ExecPlan 章节和架构依赖方向。不为尚未存在的 Web / MCP 消费者创建占位脚本。

本阶段不创建定时器。只有远程仓库存在且 `pnpm check` 经过稳定运行后，才用仓库原生定时工作流每周检查；巡检只报告或更新一个问题，不自动修复，也不自动加 `symphony:ready`。

### Phase 2 — 共享契约与 Symphony Core Conformance

在 `packages/contracts` 定义 Task、Attempt、Workspace、CodexEvent、Verification、ReviewDecision、Intervention 和 SymphoneerEvent 的最小边界 Schema。只有跨进程、文件或网络边界的数据使用运行时验证；纯内部状态不重复建模。

在 `packages/symphony-core` 按固定 SPEC 依次实现 `WORKFLOW.md` 加载与校验、资格判定、调度与并发所有权、Workspace 生命周期、Runner 结果、Retry / backoff 和 reconciliation。首先使用内存 fake tracker / runner 完成确定性测试，不等到 GitHub 才验证核心状态机。

### Phase 3 — GitHub、Workspace、Codex 与独立 Verification 闭环

实现唯一个 GitHub Issues adapter，保留原生 ID 和深链，并对 `open` + `symphony:ready` + not `symphony:review` 做可独立测试的筛选。访问令牌只来自进程环境或本地认证工具，不写入配置、日志、JSONL 或 Phoenix。

先运行 App Server 契约生成命令的 `--help`，再用当前 CLI 生成 TypeScript Schema 并记录 Codex 版本。实现初始化、Thread / Turn 执行、事件观察、超时、取消、审批与中断表达。不在 Runner 中伪造 Verification；Turn 结束后由 Symphoneer 独立运行 `symphoneer.verification` 指定的命令。

本阶段先用本地 fake 仓库和可控失败测试闭环，不创建 GitHub fixture。

### Phase 4 — JSONL 投影、本地服务与 Web Dashboard

在 `apps/symphoneer` 建立 append-only JSONL event store 和 immutable artifact store。事件带有稳定 ID、Schema 版本、来源、时间和相关 ID；投影必须可从空目录重放。损坏或不支持的记录不得被静默跳过。

本地 HTTP 服务提供查询、受控操作和 SSE 事件流。先用 Node 原生 HTTP / URL / stream 能力；只在路由、校验或中间件复杂度实际超过它时才引入 Web 框架。Web Dashboard 用 React、Vite、Tailwind 和 `@openai/apps-sdk-ui` 实现 Task Board、Attempt Inspector、Intervention 和 Handoff 四个最小视图，保留键盘、焦点、对比度和语义标记等无障碍基线。

本阶段在开发服务存在时新增 `pnpm dev`，在第一个可自动 Web 主流程存在时新增 `pnpm test:e2e`；不在消费者之前创建空脚本。

### Phase 5 — 受控 MCP

将同一本地服务暴露为 MCP 工具和 MCP App UI 资源。查询工具可列出/读取 Task 和 Attempt；变更工具仅限 refresh、dispatch、pause、retry 和 respond to intervention。每个变更请求包含目标版本或前置条件、幂等键，并在执行前重读当前状态和要求 Host 确认。

用 MCP Apps 标准连接 Host 和 UI，Apps SDK UI 只用于视觉组件。必须在真实 Codex 宿主中验证资源渲染、工具调用、确认与错误表达。

本阶段在首个可自动 MCP 故事存在时才扩展 `pnpm test:e2e`。

### Phase 6 — 私有 fixture 真实 E2E Smoke

在进入本阶段时再确认当前 GitHub 账号和目标名称不冲突，然后创建 `icho648/symphoneer-fixture` 私有仓库。fixture 只包含一个最小 TypeScript 应用、一条 `pnpm check`、一份 `WORKFLOW.md` 和所需标签。

创建一个小型功能 Issue，让它经过资格门禁、Attempt、Workspace、Codex、PR、独立 Verification、`symphony:review` 写回和人工 Review。人手工 Merge / Close，然后验证 Symphoneer 对账到终态并清理本地 Workspace。不删除 fixture 仓库，使它保留为可重现测试资产。

### Phase 7 — Phoenix 非阻塞观测

只在 Phase 6 核心 Smoke 通过后安装 Phoenix / OpenTelemetry 相关客户端。Phoenix 作为外部可选 sidecar，Symphoneer 不内嵌或复制 Phoenix UI。Attempt 是根 span，Turn 和 Verification 是子 span，工具调用使用 tool span；所有 span 保留 Symphoneer Task / Attempt / Turn / Verification ID。

对 prompt、输出、工具参数和日志做默认脱敏；不发送 Token、私有代码、原始 Issue 秘密、完整命令输出或未审查的工具 payload。无 endpoint、超时、网络失败或 exporter 异常都只记录受控诊断，不改变业务状态。

## Concrete Steps

所有命令默认在 `/Users/icho/求职/projects/symphoneer` 执行。未到达的阶段命令只是计划，状态为 `Not verified`；执行者必须在当时的 `Progress` 和 `Artifacts and Notes` 记录实际命令、版本和输出。

### Phase 0 命令

提交前先用 Ruby 标准库验证所有 Markdown 本地链接：

```sh
ruby -rpathname -ruri -e '
missing = []
Dir["**/*.md"].sort.each do |file|
  File.read(file).scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.each do |raw|
    target = raw.strip
    next if target.match?(/\A(?:https?:|mailto:|data:|#)/)
    target = target[1...-1] if target.start_with?("<") && target.end_with?(">")
    target = target.split("#", 2).first.split("?", 2).first
    next if target.empty?
    path = Pathname.new(file).dirname.join(URI::DEFAULT_PARSER.unescape(target)).cleanpath
    missing << "#{file}: #{raw}" unless path.exist?
  end
end
puts missing
exit(missing.empty? ? 0 : 1)
'
```

预期：无输出，退出 0。HTTP(S)、`mailto:`、`data:` 和文档内 anchor 不属于本地文件检查；外部契约由引用文档的核验日期管理。

验证每个分区的直接叶子都被所属 `index.md` 引用：

```sh
ruby -rpathname -ruri -e '
dirs = %w[
  docs/design-docs
  docs/product-specs
  docs/references
  docs/research
  docs/exec-plans/active
  docs/exec-plans/completed
]
missing = []
dirs.each do |dir|
  index = "#{dir}/index.md"
  linked = File.read(index).scan(/\[[^\]]*\]\(([^)]+)\)/).flatten.map do |raw|
    target = raw.strip
    next if target.match?(/\A(?:https?:|mailto:|data:|#)/)
    target = target[1...-1] if target.start_with?("<") && target.end_with?(">")
    target = target.split("#", 2).first.split("?", 2).first
    next if target.empty?
    Pathname.new(dir).join(URI::DEFAULT_PARSER.unescape(target)).cleanpath.to_s
  end.compact
  Dir["#{dir}/*.md"].sort.each do |leaf|
    next if leaf == index
    missing << "#{leaf}: missing from #{index}" unless linked.include?(Pathname.new(leaf).cleanpath.to_s)
  end
end
puts missing
exit(missing.empty? ? 0 : 1)
'
```

预期：无输出，退出 0。该检查只要求当前的直接叶子，不把子目录或外部链接冒充为叶子。

验证 ExecPlan 严格具有且只有 12 个必需二级章节：

```sh
ruby -e '
expected = [
  "Purpose / Big Picture",
  "Progress",
  "Surprises & Discoveries",
  "Decision Log",
  "Outcomes & Retrospective",
  "Context and Orientation",
  "Plan of Work",
  "Concrete Steps",
  "Validation and Acceptance",
  "Idempotence and Recovery",
  "Artifacts and Notes",
  "Interfaces and Dependencies"
]
actual = File.readlines("docs/exec-plans/active/symphoneer-v1.md").map do |line|
  line[/\A## (.+?)\s*\z/, 1]
end.compact
abort("ExecPlan H2 mismatch: #{actual.inspect}") unless actual == expected
puts "ExecPlan H2: 12/12"
'
```

预期：只输出 `ExecPlan H2: 12/12`，退出 0。

汇总并人工审查规范性状态：

```sh
rg -n '^> (Decision status|Implementation evidence|Project adoption|Contract evidence|External source status):' \
  README.md ARCHITECTURE.md docs/design-docs docs/product-specs docs/references docs/exec-plans/active
if rg -n 'Decision status: Proposed|## 尚未决定|实现方式未决定|V1 计划只读' \
  README.md docs/design-docs docs/product-specs docs/references; then exit 1; fi
find . -type f ! -path './.git/*' ! -name '*.md' -print
```

人工通过条件：已确认的 design doc 和 product spec 是 `Accepted`；所有代码、GitHub、Codex、Web / MCP、Phoenix 和定时检查行为是 `Not verified`；参考文档分开外部来源状态、项目采用决定和实施证据；计划中的未来命令没有写成已运行事实。第二个 `rg` 和 `find` 均应无输出并退出 0。

上述检查通过后才建立 Git 基线：

```sh
test ! -e .git
git init -b main
git add -- '*.md'
git diff --cached --name-only
git diff --cached --name-only -z | ruby -e 'paths = STDIN.read.split("\0"); bad = paths.reject { |path| path.end_with?(".md") }; puts bad; exit(bad.empty? ? 0 : 1)'
git commit -m 'docs: establish symphoneer development plan'
git branch --show-current
git diff-tree --root --no-commit-id --name-only -r -z HEAD | ruby -e 'paths = STDIN.read.split("\0"); bad = paths.reject { |path| path.end_with?(".md") }; puts bad; exit(bad.empty? ? 0 : 1)'
git status --short
git remote
```

预期：初始分支为 `main`；提交成功；两个 NUL-safe Ruby 文件类型检查均无输出并退出 0；`git branch --show-current` 输出 `main`；`git status --short` 和 `git remote` 均无输出。如果 `.git` 已存在、暂存区出现非 Markdown、工作树在提交后不干净或 remote 存在，立即停止并调查，不扩大提交范围。

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

`pnpm check` 是合并前的唯一全量入口；`pnpm test` 覆盖当前已存在的确定性单元/集成行为。Phase 4 开发服务存在后再创建 `pnpm dev`；可自动 Web 主流程存在后再创建 `pnpm test:e2e`；Phase 5 再将 MCP 故事加入同一 E2E 入口。这些脚本当前都不存在，状态为 `Not verified`。

### fixture 创建与 Smoke

仅在 Phase 1–5 的本地验收通过后执行：

```sh
gh auth status
gh repo view icho648/symphoneer-fixture
gh repo create icho648/symphoneer-fixture --private
gh label create 'symphony:ready' --repo icho648/symphoneer-fixture
gh label create 'symphony:review' --repo icho648/symphoneer-fixture
```

`gh repo view` 预期在首次创建前报告仓库不存在；如果已存在，停止创建并先核对所有权和内容。创建后用非交互命令推送最小 fixture，再用 `gh issue create` 创建一个边界清晰的 Issue 并加 `symphony:ready`。不在命令行、日志或计划中打印 Token。

真实 Smoke 的通过证据必须同时包含：Issue URL、Attempt ID、Workspace / branch、Codex thread ID、Verification 命令与退出状态、PR URL、`symphony:review` 的 Tracker 复读、人工 Review 决定、Merge / Close 的原生链接以及本地清理结果。

### Phoenix 检查

对一个明确的外部 Phoenix endpoint，分别执行启用和禁用两套 Smoke。禁用或无法连接时，同一核心任务仍必须到达 Human Review；启用时，必须能用 Attempt ID 查到根 span 及 Turn / Verification 子 span，且抽样确认没有 Token、私有代码或未审查 payload。实际启动 Phoenix 服务的命令取决于当时已安装的外部环境，不在本仓库预设容器或部署方式。

## Validation and Acceptance

验收遵循“项目事实 -> 确定性检查 -> Agent 产物 -> 独立 Verification -> 真实外部证据 -> Human Review”。任何一层不能替代其后的层级。

| AC | 验收条件 | 验证方式 | 当前状态 |
|---|---|---|---|
| AC-00 | 初始 Git 提交只包含 Markdown，无 remote、无实现资产，工作树干净 | 本地链接/索引/12 章检查；`git show --name-only HEAD`；`git status --short` | Pass when read from the containing initial commit; product behavior remains Not verified |
| AC-01 | 只有 `open` + `symphony:ready` + not `symphony:review` 的 Issue 可调度 | 表格测试所有标签/状态组合，再用 fixture Smoke | Not verified |
| AC-02 | 同一 Task 没有未定义的并发 Attempt、Workspace 所有者或活跃 Turn | 状态机/并发测试，进程重启对账 Smoke | Not verified |
| AC-03 | Retry、timeout、cancel、失联和重启能对账，不重放已完成外部写入 | fake clock / runner 测试；注入失败的恢复 Smoke | Not verified |
| AC-04 | Agent 声明或 Turn 完成不能把未运行/失败检查升级为通过 | 伪造完成声明与失败检查的集成测试 | Not verified |
| AC-05 | Verification 证据包含命令、退出状态、必要输出、时间和对应版本 | artifact Schema 测试和 fixture 抽查 | Not verified |
| AC-06 | JSONL 可从空投影重放，损坏记录有明确停止/恢复路径 | golden event replay、截断尾记录、未知 Schema 版本测试 | Not verified |
| AC-07 | Web 和 MCP 展示同一投影，实时更新不创建第二套业务状态 | API contract 测试、SSE 断线重连、Web / MCP 对照 | Not verified |
| AC-08 | MCP 变更操作有版本/前置条件、幂等键、状态复读和 Host 确认，且无 Commit / Merge / 权限扩大 | 重复请求、过期版本、取消确认测试；工具列表审计 | Not verified |
| AC-09 | Tracker 与投影冲突时展示来源差异并停止危险推进 | 修改 fixture Issue 模拟竞争写，检查无静默覆盖 | Not verified |
| AC-10 | 真实 fixture 能追溯 Issue -> Attempt -> Workspace -> Codex -> Verification -> PR / Review，人仍负责 Merge / Close | 保留链接和 ID 的真实 E2E Smoke + Human Review | Not verified |
| AC-11 | Phoenix 关闭或失败不阻塞闭环；启用时 Trace 可关联且已脱敏 | disabled / unreachable / enabled 三组 Smoke 和人工抽查 | Not verified |
| AC-12 | Web 主流程具有键盘操作、正确焦点、语义标记和可读对比度 | 自动可访问性检查 + 键盘人工 Smoke | Not verified |

最小测试矩阵：

- 单元：资格判定、状态转换、backoff、幂等、投影 reducer、脱敏。
- 集成：fake tracker / runner / clock、Workspace 所有权、App Server 协议边界、Verification artifact、JSONL 重放、HTTP / SSE、MCP tools。
- 故障注入：进程重启、截断 JSONL、重复请求、Tracker 竞争写、Codex 超时、Verification 超时、Phoenix 不可达。
- 真实 Smoke：私有 GitHub fixture、当前 Codex App Server、Codex MCP App UI、人工 Review、可选 Phoenix。

未实际执行的检查一律不得标记 Pass。自动检查全绿也不能替代 AC-10 和最终产品验收的 Human Review。

## Idempotence and Recovery

- **初始提交：** `git init` 仅在 `.git` 不存在时执行，且只暂存 `.md`。如果在 commit 前失败，保留 Markdown 并检查暂存列表；不使用破坏性 reset。
- **外部资源：** 创建 fixture、标签或 Issue 前先按精确名称查询。已存在时核对所有权和契约，不重复创建或删除未确认资源。
- **调度所有权：** 对 Task 获取带版本的单一活跃所有权。进程重启后先对账 Tracker、Workspace 和 Codex，再决定恢复、结束旧 Attempt 或创建新 Attempt。
- **外部写入：** dispatch、pause、retry、intervention 回答和 Tracker 写回使用幂等键与前置条件。重试前查询原生状态；无法判定是否成功时进入人工介入，不盲目重放。
- **Workspace：** 路径由稳定 Task ID 派生，但重用前检查 repo、branch、HEAD 和所有者。不删除有未提交改动或所有权不明的 Workspace。
- **Codex：** timeout 先请求取消并记录最后已观察事件。重启时通过原生 ID 查询当前状态；不在两个客户端同时继续同一活跃 Turn。
- **Verification：** 每次运行绑定 Attempt、检查 ID 和精确 Git 版本。超时或中断记录为非通过；修复后生成新结果，不覆盖旧 artifact。
- **JSONL：** 只追加完整记录，完成持久化后才更新内存投影。启动时顺序验证 Schema；遇到截断尾记录或未知版本时保留原文件、报告偏移和最后有效 ID，不静默修补。
- **Projection：** 随时可从 JSONL 和 artifact 重建到新目录并对比摘要。重放不执行任何 GitHub、Codex 或 Git 写操作。
- **Phoenix：** exporter 带有界限明确的 timeout 和错误隔离。发送失败可丢弃诊断数据，但不影响核心事件持久化或状态转换。
- **密钥与日志：** Token 只存于进程内存，日志和 artifact 默认脱敏。任何发现凭据泄漏都要停止对外传输，保留受控证据并由人轮换凭据。
- **人工恢复：** 无法证明唯一所有者、外部写入结果或对应 Git 版本时，任务进入显式介入；系统不自动 Merge、Close 或删除有价值的工作区。

## Artifacts and Notes

当前文档基线的最小证据是：

- 本 ExecPlan 及其在 [`index.md`](index.md) 中的 active 索引。
- [`../../design-docs/index.md`](../../design-docs/index.md)、[`../../product-specs/index.md`](../../product-specs/index.md) 和 [`../../references/index.md`](../../references/index.md) 中的 `Accepted` / `Not verified` 状态。
- 初始提交的 `git show --name-only HEAD`、`git status --short` 和无 remote 检查。

代码阶段的默认本地数据根目录计划为 `.symphoneer/`，在第一个实现提交中加入 `.gitignore`，不在当前文档提交中创建。最小布局为：

```text
.symphoneer/
  events.jsonl
  artifacts/
    <attempt-id>/
      verification/<check-id>.json
      logs/<artifact-id>.txt
```

JSONL 事件只包含查询和重放必需的结构化字段；大输出使用内容摘要和相对 artifact 引用。每个 artifact 记录创建时间、内容类型、字节数、摘要和产生者；不包含凭据或无界限的原始供应商 payload。

每个阶段停点在本节追加最小证据摘要：提交或 Diff 引用、执行过的命令、退出状态、直接证据位置、未验证项和下一步。不粘贴无界限日志，也不用一个综合评分代替具体 AC 证据。

## Interfaces and Dependencies

### Repository-owned workflow contract

`WORKFLOW.md` 在 Phase 1 创建时是目标仓库拥有的运行契约。下列形状是已决定的 Symphoneer 扩展方向，不是已运行配置；具体字段必须经固定 SPEC、Schema 和测试确认。

```yaml
tracker:
  kind: github
  provider:
    repo: icho648/symphoneer-fixture
    token: $GITHUB_TOKEN
  active_states: [open]
  terminal_states: [closed]
workspace:
  root: .workspaces
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
    required_labels: [symphony:ready]
    excluded_labels: [symphony:review]
  verification:
    - id: check
      argv: [pnpm, check]
      cwd: .
      timeout_ms: 120000
```

Prompt 和交接策略继续由 repository-owned `WORKFLOW.md` 表达。当 Verification 通过并准备交接时，工作流使用受限的 GitHub 原生工具添加 `symphony:review`；Symphoneer 必须重新读取 Tracker 后才进入等待人工审查状态。

### Shared contracts

`packages/contracts` 只导出下列跨边界契约：Task summary、eligibility result、Attempt snapshot、Workspace reference、Codex event envelope、Verification result、Review decision、Intervention、Symphoneer event envelope、projection version 和 API error。每个契约使用稳定 ID、显式 Schema 版本和来源；内部不跨边界的状态不为了“共享”再造一层 DTO。

### Local HTTP and SSE surface

V1 最小接口族是：

- `GET /api/v1/state`：当前服务与投影版本。
- `GET /api/v1/tasks` 与 `GET /api/v1/tasks/:id`：Task 投影与原生链接。
- `GET /api/v1/attempts/:id`：Attempt、Workspace、Codex、Verification 和 Review 关联。
- `POST /api/v1/refresh`、`/dispatch`、`/pause`、`/retry` 与 `/interventions/:id/respond`：受控操作。
- `GET /api/v1/events`：可从最后已知事件恢复的 SSE 流。

变更接口共享版本/前置条件、幂等键和确认语义。本地服务默认只绑定 loopback；任何 LAN 或远程暴露都需要新的身份认证和威胁模型决定。

### MCP surface

MCP V1 的最小工具是：`list_tasks`、`get_task`、`get_attempt`、`refresh_tasks`、`dispatch_task`、`pause_attempt`、`retry_attempt` 和 `respond_intervention`。UI 资源只渲染 Task 和 Attempt 面板，不保存独立业务状态。

### Dependency policy

依赖在对应阶段才安装并固定版本，不在 Phase 1 一次性为未来阶段搭脚手架：

| 能力 | 默认选择 | 采用边界 |
|---|---|---|
| Runtime / language | Node.js + TypeScript | 两端共享契约；实施开始时记录当前版本 |
| Package manager | pnpm workspace | 只管理三个责任区，不引入额外 monorepo 框架 |
| Boundary validation | Zod | 只用于外部、文件、HTTP 和 MCP 边界 |
| Workflow parsing / templates | 一个 YAML parser + LiquidJS | 只因固定 Symphony SPEC 的配置与模板契约而引入 |
| Server | Node native HTTP / URL / streams | 先使用平台能力；只在已测得复杂度需求时再评估框架 |
| Web | React + Vite + Tailwind + `@openai/apps-sdk-ui` | 用于 Web Dashboard 与 Codex MCP App UI 的共享视觉层 |
| MCP | Model Context Protocol TypeScript SDK + MCP Apps standard | 用于工具契约、Host 桥接与 UI 资源；不替代 App Server 运行事件 |
| Unit / integration tests | Node `node:test` 与小型 fake | 先使用标准库；只在明确缺少能力时引入测试框架 |
| Browser tests | Playwright | 只在 Web 主流程存在时安装 |
| Formatting / static checks | 一个统一工具 | 实施时在已有工具与 Biome 中选最小解法，不叠加 formatter / linter |
| Phoenix | OpenTelemetry / OpenInference TypeScript 客户端 | 仅 Phase 7 安装；Phoenix 服务保持外部可选 sidecar |
| Electron | None in V1 | 只在 Web 闭环已通过且出现桌面分发需求时评估 |

明确不采用数据库、队列、LangGraph、通用 Provider factory 或只有一个实现的接口层。如果标准库、平台能力或已安装依赖已解决问题，不新增包。

外部契约入口：

- [固定 OpenAI Symphony SPEC](../../references/symphony-spec.md)
- [Codex App Server 契约边界](../../references/codex-app-server.md)
- [GitHub Issues 采用边界](../../references/github-issues.md)
- [OpenAI Apps SDK UI](https://github.com/openai/apps-sdk-ui)
- [OpenAI MCP Apps UI 指南](https://developers.openai.com/plugins/build/chatgpt-ui)
- [Arize Phoenix TypeScript API](https://arize.com/docs/phoenix/resources/typescript-api)

外部页面说明了供应方公开契约，不证明本项目已实现或兼容。每次开始相应阶段前都要核对当前官方契约、记录版本并保留差异。

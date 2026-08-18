# Executor 可观测性能力矩阵

> 核验日期：2026-08-14  
> 证据状态：Observed（官方文档与官方源码）；标注项为 Not verified  
> 规范关系：研究输入；支持可选 Trace 与未来 Executor 选型，不自动形成实现决定

## 结论

如果 Executor 直接运行这些 Agent，Symphoneer 都能拿到一定程度的结构化执行事件；但能否得到模型调用级数据，取决于 Agent 自己是否公开该边界，而不是取决于 Executor 是否为子进程。

| Executor | 结构化执行流 | 模型 / Token / Cost | 工具与审批 | 原生 OTel | Phoenix 适配判断 |
|---|---|---|---|---|---|
| Codex CLI / App Server | 强：Thread / Turn / Item 或 `exec --json` JSONL | 模型与 Token 可得；单次 API usage、耗时经 OTel 可得；公开流无 Cost | 调用、参数、状态、结果、审批可得 | 有 logs / traces / metrics | 强；优先直接 OTLP，执行 UI 仍消费公共事件 |
| Claude Code / Agent SDK | 强：SDK / `stream-json` | 模型、Token、Cost 可从结果流与 OTel 获得 | 调用、等待审批、决定、结果可得 | 有，Trace 当前为 beta | 强；SDK 还能自动把 W3C 上下文传给 CLI |
| Cursor Agent CLI | 中：`stream-json` 有会话、消息、工具与结果 | 流中有模型，但官方输出 schema 不含 Token / Cost | 工具 start/completed 与参数/结果可得；print 模式没有通用审批事件契约 | Not verified：未找到官方 OTel 契约 | 中弱；只能由 Runtime 把 CLI 事件转换为自有 spans |
| Pi CLI / SDK | 强：RPC / JSON / SDK 事件 | provider、model、Token、Cost 可得 | 调用 delta、start/update/end、结果可得；Extension 可拦截或阻止 | 有 telemetry span contract，但不自带 exporter | 强，但需要 Symphoneer 提供 OTel/Phoenix adapter |

## Codex

`codex exec --json` 输出 `thread.*`、`turn.*`、`item.*` JSONL；`turn.completed.usage` 包含 input、cached input、cache write、output 和 reasoning output Token。工具项覆盖命令、文件修改、MCP、协作和搜索，但该 JSONL schema 没有 Cost。[非交互 JSONL 文档](https://developers.openai.com/codex/noninteractive/#make-output-machine-readable)；[公开事件类型](https://github.com/openai/codex/blob/main/codex-rs/exec/src/exec_events.rs)

Codex 原生 OTel 可导出 API 请求、SSE、Token、工具审批与结果；配置 schema 还提供独立 `trace_exporter`、`metrics_exporter` 和 log `exporter`。因此 Codex CLI 与 App Server 不需要 Runtime 猜测内部调用，只需让它们直发统一 Collector。[官方 OTel 文档](https://developers.openai.com/codex/config-advanced/#observability-and-telemetry)；[配置 schema](https://github.com/openai/codex/blob/main/codex-rs/core/config.schema.json)

边界：公开事件和 OTel 不提供完整 Provider request/response、隐藏系统 Prompt或隐藏 chain-of-thought；reasoning item 是公开摘要。更细的 App Server Trace 关联边界见 [`2026-08-14-codex-app-server-observability.md`](2026-08-14-codex-app-server-observability.md)。

## Claude Code / Claude Agent SDK

Agent SDK 实际启动 Claude Code CLI 子进程；CLI 自身记录 `claude_code.interaction`、`llm_request`、`tool`、审批等待和执行 spans，并导出 metrics、logs、traces。SDK 会把当前 W3C `TRACEPARENT` / `TRACESTATE` 自动传播给非交互 CLI，因此可以直接挂到 Symphoneer Attempt span 下。[Agent SDK OTel 文档](https://code.claude.com/docs/en/agent-sdk/observability)

模型请求事件包含 model、duration、input/output/cache Token 与估算 Cost；工具事件包含 name、call id、成功、耗时与审批来源。内容默认不导出。[Claude Code Monitoring](https://code.claude.com/docs/en/monitoring-usage)

Claude Code 还支持高风险 opt-in `OTEL_LOG_RAW_API_BODIES`，可导出 Messages API 请求与响应，包括拼装后的 system、messages 和 tools；extended-thinking 始终会被 redacted。这比普通 SDK 事件更完整，但不应作为 Symphoneer 默认设置，因为它会保存源码、会话和工具内容。[敏感内容开关](https://code.claude.com/docs/en/agent-sdk/observability#control-sensitive-data-in-exports)

边界：拿不到被产品隐藏的 chain-of-thought，也不能从事件恢复“为什么选择此工具”的真实因果；只能看到模型返回的 thinking/文字、工具选择事实和审批结果。

## Cursor Agent CLI

`cursor-agent -p --output-format stream-json` 输出 NDJSON：初始化事件含 model/session，消息流含用户输入与助手文本，工具事件含 call id、参数和执行结果，最终 result 含总耗时与 API 耗时。print 模式明确 suppress thinking。[官方输出 schema](https://docs.cursor.com/en/cli/reference/output-format)

官方 stream schema 没有 Token、Cost、Provider request/response 或 OTel exporter；团队 Admin API 虽能事后查询部分按调用的 model、Token 与费用，但这是团队级云端 usage 数据，不是 Executor 当前 run 的事件流。[Cursor Admin API](https://docs.cursor.com/en/account/teams/admin-api)

**Not verified：** 未找到 Cursor CLI 官方 OTel/OTLP 契约；也未确认 Admin API usage event 能与本地 CLI 的 `session_id` / `request_id` 稳定关联。因此当前只能把 Cursor CLI 的执行事件包装为 Symphoneer-owned spans，不能宣称 Phoenix 看到了内部 LLM trace。

## Pi CLI / SDK

Pi 可通过 `--mode rpc` 或 `--mode json` 提供结构化事件；SDK `AgentSession.subscribe()` 提供 agent、turn、message、thinking/text delta、tool execution start/update/end。Assistant message 类型保留 provider、model、usage 和 cost。[RPC 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)；[JSON 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)；[消息类型](https://github.com/earendil-works/pi/blob/main/packages/ai/src/types.ts)

Extension 的 `tool_call` 可检查并阻止工具，`tool_result` 可观察或改写结果；`before_provider_request` 能看到 provider-specific 序列化请求并替换 payload，`after_provider_response` 提供状态和 headers。因而 Pi 能提供四者中最开放的 Provider 边界。[Extension 文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)

Pi telemetry 包定义 vendor-neutral spans，但明确不附带 exporter/backend；Symphoneer 必须给它接 OTel adapter，或消费 RPC/JSON 后生成较浅的 spans。[Telemetry README](https://github.com/earendil-works/pi/blob/main/packages/telemetry/README.md)

边界：`before_provider_request` 能看到的是 Pi 发出的 payload，不保证能看到上游网关改写后的最终请求；`after_provider_response` 也不等于完整原始响应 body。Provider 未返回的隐藏推理仍不可见。

## 对 Symphoneer 的最小策略

1. Executor 公共事件继续作为运行状态与 UI 事实源，不依赖 Phoenix。
2. Codex 与 Claude 直接启用其原生 OTLP，并传播同一个 Attempt trace context。
3. Pi 真正接入时再提供一个最小 OTel adapter；现在不预建通用 telemetry abstraction。
4. Cursor 只投影可观察的 CLI 事件；Token/Cost 标为不可得，不抓私有文件或逆向协议。
5. 默认不记录原始 Prompt、工具内容和 Provider payload；任何 raw-body 模式都应是短时、显式、可审计的诊断开关。

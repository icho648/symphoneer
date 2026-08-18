# Codex App Server 可观测性边界

> 核验日期：2026-08-14  
> 证据状态：Observed（官方文档与 `openai/codex` 固定 commit `a70211249ab5d003836a2bb339f69265df84512c`）  
> 规范关系：研究输入；支持 [`../core-concepts/system-boundaries.md`](../core-concepts/system-boundaries.md) 的可选 Trace 边界，不自动形成采用决定

## 问题与结论

问题是：模型调用发生在 Codex App Server 子进程内，Symphoneer Runtime 中的 Phoenix SDK 看不到内部 Provider 请求时，能否补齐 Token、模型、工具和调用耗时等观测。

**结论：不应让 Runtime SDK 穿透子进程。首选路径是让 Codex App Server 自己通过 OTel 导出到同一 Collector，并由 Symphoneer 在 JSON-RPC 请求中传 W3C Trace Context。** App Server 进程会从自己的 Codex 配置创建 OTel Provider；JSON-RPC request 原生接受 `trace.traceparent` / `trace.tracestate`，并把它设为 App Server request span 的父上下文。这样 Attempt span 与 Codex 内部 API、SSE、工具 span 可以落在同一条分布式 Trace 中。[官方 OTel 配置](https://developers.openai.com/codex/config-advanced/#observability-and-telemetry)；[App Server 创建 OTel Provider](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server/src/lib.rs#L590-L603)；[JSON-RPC Trace 字段](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server-protocol/src/rpc.rs#L44-L55)；[父上下文接线](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server/src/app_server_tracing.rs#L24-L52)

这能解决大部分运行观测，但不能得到完整 Provider payload、隐藏系统 Prompt、模型隐藏推理或“为什么选择这个工具”的真实因果解释。

## 能看到什么

| 关注点 | 官方暴露面 | 边界 |
|---|---|---|
| Turn / 工具 / 命令 | App Server 流式提供 `turn/*`、`item/*`，包括 command、file change、MCP/collab/web search、参数、状态、结果和耗时 | 能确认选了什么工具、输入、执行结果；不等于知道模型为什么选择它。[App Server Items](https://developers.openai.com/codex/app-server/#items) |
| Token | `thread/tokenUsage/updated` 给出累计与最近一次 usage，包括 input、cached input、cache write、output、reasoning output 和 context window | 是 Thread 级公共事件；不应从文本估算。[协议类型](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L1590-L1648) |
| 单次模型调用 usage | OTel `codex.sse_event` 在 `response.completed` 上记录各类 Token、TTFT、service tier 和 reasoning effort | 适合 Phoenix 一类 Trace 展示；Codex 自己发出，不需要 Runtime 截获 HTTP。[OTel 事件实现](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/otel/src/events/session_telemetry.rs#L926-L944) |
| 模型 / Provider | `thread/start` 返回 `model`、`modelProvider`、`serviceTier`；Thread 也保留 Provider；发生服务端改路由时另有 `model/rerouted` | 可以显示请求模型和已报告的改路由；不推断未报告的 Provider 内部路由。[Thread start 类型](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L169-L177)；[模型事件](https://developers.openai.com/codex/app-server/#turn-events) |
| Provider 请求状态和耗时 | OTel `codex.api_request` 含 attempt、HTTP 状态、duration、endpoint、request id 和 error 元数据 | 不含请求或响应正文，也不暴露认证值。[OTel API 事件实现](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/otel/src/events/session_telemetry.rs#L575-L605) |
| Prompt | OTel `codex.user_prompt` 默认只发长度并把文本记为 `[REDACTED]`；`otel.log_user_prompt=true` 才导出原始用户输入 | 这里只是 user prompt，不是 Codex 拼装后的完整 Provider request 或隐藏指令。[官方隐私默认值](https://developers.openai.com/codex/config-advanced/#observability-and-telemetry)；[实现](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/otel/src/events/session_telemetry.rs#L947-L987) |
| 推理 | App Server 可流式提供 reasoning summary；raw reasoning 只在模型实际返回时出现，官方例子指向开源模型 | 不能把 summary 当隐藏 chain-of-thought；`show_raw_agent_reasoning` 也只是“模型 emits it”时显示。[Reasoning items](https://developers.openai.com/codex/app-server/#items)；[配置限制](https://developers.openai.com/codex/config-reference/#show_raw_agent_reasoning) |

## `tool_decision` 的准确含义

`codex.tool_decision` 记录的是工具调用的**审批决定**：tool name、call id、approved/denied 以及决定来自 config 还是 user；它不是“模型为什么选了这个工具”。工具被选中的事实与参数来自 App Server `item/*`，可读的理由最多来自模型主动输出的 reasoning summary、approval reason 或普通消息，不能恢复隐藏决策过程。[官方 OTel 事件目录](https://developers.openai.com/codex/config-advanced/#observability-and-telemetry)；[源码字段](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/otel/src/events/session_telemetry.rs#L990-L1013)

## 不采用的捷径

- `rawResponse/completed` 虽可提供一次上游 completion 的精确 usage，但协议把它标为 internal-only，`experimentalRawEvents` 也明确供 Codex Cloud 等内部用途；Symphoneer 不应把它作为稳定依赖。[协议说明](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server/README.md#L1553-L1563)；[experimental 字段](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server-protocol/src/protocol/v2/thread.rs#L138-L149)
- 外部 Host 没有公开 API 可以 monkey-patch App Server 内部 HTTP client。Codex 支持 `openai_base_url` 或自定义 `model_providers.<id>.base_url`，因此理论上可把兼容 Responses API 的请求显式路由经过受控代理；这会接触认证头和原始 Prompt/响应，应视为高风险调试代理，不是默认观测方案。[官方 Provider 配置](https://developers.openai.com/codex/config-reference/#model_providersidbase_url)
- OTel 事件不包含完整 outbound request body，因此不能据此声称看到了 Codex 隐藏系统 Prompt、全部工具定义或 Provider 原始响应。

## 对 Symphoneer 的最小落点

1. Codex Worker 启动时继续使用用户的 Codex 配置，并让 Codex 的 `[otel]` 指向统一 OTLP Collector；App Server 已原生加载该配置。[App Server 官方 OTel 集成测试](https://github.com/openai/codex/blob/a70211249ab5d003836a2bb339f69265df84512c/codex-rs/app-server/tests/suite/v2/otel.rs#L136-L159)
2. Runtime 为每个 Attempt / Turn 建 span，在 `turn/start` JSON-RPC envelope 的 `trace` 中传当前 W3C context；不要另造 ID 映射协议。
3. UI 继续以 App Server `item/*` 和 `thread/tokenUsage/updated` 展示确定事实；Phoenix 只作为同 trace 下的深层诊断副本，不参与调度、验收或恢复。
4. 默认保持 `otel.log_user_prompt=false`，并沿用“不记录原始 Provider payload”的安全边界。

## Not verified

- 当前 Symphoneer 使用的具体 Codex CLI 版本是否已包含上述 commit 的全部 OTel、trace carrier 与 Token 字段，尚未做版本匹配 Smoke。
- 当前计划中的 Phoenix 部署是否完整接收 Codex 发出的 OTLP logs、traces、metrics，以及如何把 log events 展示为 spans，未在本快照核验。
- App Server 从项目级与用户级配置加载 OTel 的优先级及运行时热更新行为，未在本快照做真实进程验证。

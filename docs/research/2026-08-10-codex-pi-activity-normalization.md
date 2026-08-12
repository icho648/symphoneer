# Codex App Server 与 Pi 的活动归一化边界

> External source status: Official Codex App Server README and Pi SDK/RPC documentation observed 2026-08-10  
> Decision status: Accepted — share only the provider-neutral activity value contract  
> Implementation evidence: `ActivityPayload` and `ActivityOccurrence` are public contracts used by the Codex decoder; Pi adapter does not exist

## Sources

- [Codex App Server README](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
- [Pi SDK documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md)
- [Pi RPC documentation](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)
- [Pi package migration notice](https://pi.dev/news/2026/5/7/pi-has-a-new-home)

## Observed overlap

Both runtimes expose user input, streamed assistant text, reasoning or thinking updates, tool lifecycle events, interruption, and persistent session history. These can be projected into the bounded activity vocabulary already used by Symphoneer: message, reasoning, tool, command, file change, warning, and error.

The provider protocols are not equivalent. Codex is a bidirectional JSON-RPC `Thread / Turn / Item` protocol with native approvals, command execution, file changes, MCP calls, and `turn/steer` or `turn/interrupt`. Pi exposes an `AgentSession` with message, turn, agent, text/thinking delta, generic tool execution, `prompt`, `steer`, `followUp`, and abort lifecycles. Pi deltas need assembly and its completed message is authoritative; Codex retains richer typed execution items and intervention requests.

## Implemented boundary

Share only the activity value vocabulary needed by the current Codex adapter and a future Pi adapter:

1. `ActivityPayload` carries provider-neutral display content.
2. `ActivityOccurrence` adds provider item identity and time.
3. `ExecutionActivity` adds Attempt identity only when Runtime persists the occurrence.

Keep lifecycle and control interfaces separate:

- Attempt execution remains behind `AgentRunner` and owns workspace, interruption, completion, intervention, and Attempt binding.
- The task-orchestration Assistant remains behind `AssistantAdapter` and owns its longer-lived conversational session and Symphoneer tools.
- Codex and Pi each keep a provider-specific decoder. The shared recorder or UI consumes normalized activities; it never parses provider payloads.

Do not create a provider factory, capability registry, universal session object, or exhaustive event union. Input remains plain text at the existing runner seam. The future Pi decoder should emit `ActivityOccurrence`; its provider protocol and session lifecycle remain private to that adapter.

## Expected shape when Pi lands

```text
Codex notification -> Codex decoder --\
                                      -> display activity -> recorder/SSE/UI
Pi session event   -> Pi decoder -----/

execution command -> AgentRunner/Codex lifecycle
assistant message -> AssistantAdapter/Pi lifecycle
```

The real Pi Assistant must run in Runtime/Host, where credentials, tools, and session persistence belong. Web remains a Runtime client and renders the canonical activity stream.

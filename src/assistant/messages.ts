import type { AgentEvent, AgentMessage, Session } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage as PiAssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { AssistantEvent, AssistantMessage } from "../assistant-client/index.ts";

export function normalizeAgentEvent(
  event: AgentEvent,
  credential: string,
): AssistantEvent | undefined {
  if (event.type === "tool_execution_start") {
    return {
      type: "tool_started",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      input: redactCredentialValue(event.args, credential),
    };
  }
  if (event.type === "tool_execution_update") {
    return {
      type: "tool_updated",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      update: redactCredentialValue(event.partialResult, credential),
    };
  }
  if (event.type === "tool_execution_end") {
    return {
      type: "tool_completed",
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      result: redactCredentialValue(event.result, credential),
      isError: event.isError,
    };
  }
  return undefined;
}

export function toAssistantMessage(
  id: string,
  message: AgentMessage,
): AssistantMessage | undefined {
  if (message.role === "user") {
    return {
      id,
      role: "user",
      parts:
        typeof message.content === "string"
          ? [{ type: "text", text: message.content }]
          : message.content.flatMap((part) =>
              part.type === "text" ? [{ type: "text" as const, text: part.text }] : [],
            ),
      timestamp: message.timestamp,
    };
  }
  if (message.role === "toolResult") {
    return {
      id,
      role: "tool",
      parts: [
        {
          type: "tool_result",
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          result: message.details ?? message.content,
          isError: message.isError,
        },
      ],
      timestamp: message.timestamp,
    };
  }
  if (message.role !== "assistant" || !("content" in message)) return undefined;
  const assistant = message as PiAssistantMessage;
  const parts: AssistantMessage["parts"] = [];
  for (const part of assistant.content) {
    if (part.type === "text") parts.push({ type: "text", text: part.text });
    else if (part.type === "toolCall") {
      parts.push({
        type: "tool_call",
        toolCallId: part.id,
        toolName: part.name,
        input: part.arguments,
      });
    }
  }
  return { id, role: "assistant", parts, timestamp: assistant.timestamp };
}

export async function repairInterruptedToolCalls(
  session: Session,
  messages: AgentMessage[],
): Promise<AgentMessage[]> {
  const pending = new Map<string, string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "toolCall") pending.set(part.id, part.name);
      }
    } else if (message.role === "toolResult") pending.delete(message.toolCallId);
  }
  if (pending.size === 0) return messages;

  const repaired = [...messages];
  for (const [toolCallId, toolName] of pending) {
    const result: ToolResultMessage<{ code: "interrupted" }> = {
      role: "toolResult",
      toolCallId,
      toolName,
      content: [{ type: "text", text: "Tool execution was interrupted by Assistant restart" }],
      details: { code: "interrupted" },
      isError: true,
      timestamp: Date.now(),
    };
    await session.appendMessage(result);
    repaired.push(result);
  }
  return repaired;
}

export function redactCredentialText(value: string, credential: string): string {
  return value.replaceAll(credential, "[redacted]");
}

export class CredentialStreamRedactor {
  readonly #credential: string;
  #pending = "";

  constructor(credential: string) {
    this.#credential = credential;
  }

  push(value: string): string {
    this.#pending += value;
    let output = "";
    while (this.#pending) {
      const credentialIndex = this.#pending.indexOf(this.#credential);
      if (credentialIndex >= 0) {
        output += `${this.#pending.slice(0, credentialIndex)}[redacted]`;
        this.#pending = this.#pending.slice(credentialIndex + this.#credential.length);
        continue;
      }
      const heldLength = this.#credentialPrefixSuffixLength();
      output += this.#pending.slice(0, this.#pending.length - heldLength);
      this.#pending = heldLength === 0 ? "" : this.#pending.slice(-heldLength);
      return output;
    }
    return output;
  }

  flush(): string {
    const output = redactCredentialText(this.#pending, this.#credential);
    this.#pending = "";
    return output;
  }

  #credentialPrefixSuffixLength(): number {
    const maximum = Math.min(this.#pending.length, this.#credential.length - 1);
    for (let length = maximum; length > 0; length -= 1) {
      if (this.#pending.endsWith(this.#credential.slice(0, length))) return length;
    }
    return 0;
  }
}

export function sanitizeAgentMessage(message: AgentMessage, credential: string): AgentMessage {
  return redactCredentialValue(message, credential) as AgentMessage;
}

export function redactCredentialValue(value: unknown, credential: string): unknown {
  const serialized = JSON.stringify(value, (_key, nested) =>
    typeof nested === "string" ? redactCredentialText(nested, credential) : nested,
  );
  return serialized === undefined ? undefined : JSON.parse(serialized);
}

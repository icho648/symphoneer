import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import type {
  AssistantAdapter,
  AssistantMessage,
  AssistantSessionInput,
} from "@symphoneer/runtime-tools";

export function createAssistantUiChatModelAdapter(
  assistant: AssistantAdapter,
  getSessionInput: () => AssistantSessionInput = () => ({}),
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const session = await assistant.createOrResumeSession(getSessionInput());
      let text = "";

      for await (const event of session.run({
        messages: toAssistantMessages(messages),
        abortSignal,
      })) {
        if (event.type === "text_delta") {
          text += event.delta;
          yield { content: [{ type: "text" as const, text }] };
          continue;
        }
        if (event.type === "error") throw new Error(event.message);
      }
    },
  };
}

function toAssistantMessages(messages: readonly ThreadMessage[]): AssistantMessage[] {
  const result: AssistantMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("");
    if (text.length > 0) result.push({ role: message.role, text });
  }
  return result;
}

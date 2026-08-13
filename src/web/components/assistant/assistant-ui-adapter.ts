import type {
  ChatModelAdapter,
  CompleteAttachment,
  ThreadAssistantMessagePart,
  ThreadMessage,
  ThreadMessageLike,
  ToolCallMessagePart,
} from "@assistant-ui/react";
import type { AssistantClient, AssistantMessage } from "@symphoneer/assistant-client";

type AssistantRunClient = Pick<AssistantClient, "abort" | "run">;
type AssistantSessionClient = Pick<AssistantClient, "deleteSession" | "openSession">;

export async function discardEmptyReplacedSession(
  client: AssistantSessionClient,
  sessionId: string | null,
): Promise<void> {
  if (!sessionId) return;
  const current = await client.openSession(sessionId);
  if (current.messages.length > 0) return;
  await client.deleteSession(sessionId);
}

export function createAssistantUiChatModelAdapter(
  client: AssistantRunClient,
  sessionId: string,
  onRunFinished?: () => void,
  onRunError?: (message: string) => void,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const prompt = lastUserText(messages);
      const content: ThreadAssistantMessagePart[] = [];
      const tools = new Map<string, number>();
      let text = "";
      const abort = () => void client.abort(sessionId).catch(() => {});
      abortSignal.addEventListener("abort", abort, { once: true });

      try {
        for await (const event of client.run(sessionId, prompt, { signal: abortSignal })) {
          if (event.type === "text_delta") {
            text += event.delta;
            const part = { type: "text" as const, text };
            if (content[0]?.type === "text") content[0] = part;
            else content.unshift(part);
          } else if (event.type === "tool_started") {
            tools.set(event.toolCallId, content.length);
            content.push({
              type: "tool-call",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: asToolArgs(event.input),
              argsText: JSON.stringify(event.input),
            });
          } else if (event.type === "tool_updated") {
            updateTool(content, tools, event.toolCallId, (tool) => ({
              ...tool,
              artifact: event.update,
            }));
          } else if (event.type === "approval_required") {
            updateTool(content, tools, event.toolCallId, (tool) => ({
              ...tool,
              approval: { id: event.approvalId },
            }));
          } else if (event.type === "tool_completed") {
            updateTool(content, tools, event.toolCallId, (tool) => ({
              type: "tool-call",
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              args: tool.args,
              argsText: tool.argsText,
              result: event.result,
              isError: event.isError,
            }));
          } else if (event.type === "error") {
            text += `${text ? "\n\n" : ""}${event.message}`;
            const part = { type: "text" as const, text };
            if (content[0]?.type === "text") content[0] = part;
            else content.unshift(part);
            onRunError?.(event.message);
            yield {
              content: [...content],
              status: { type: "incomplete", reason: "error", error: event.message },
            };
            return;
          } else if (event.type === "aborted") {
            yield { content: [...content], status: { type: "incomplete", reason: "cancelled" } };
            return;
          }

          if (
            event.type === "text_delta" ||
            event.type === "tool_started" ||
            event.type === "tool_updated" ||
            event.type === "tool_completed" ||
            event.type === "approval_required"
          ) {
            yield { content: [...content] };
          }
        }
      } finally {
        abortSignal.removeEventListener("abort", abort);
        onRunFinished?.();
      }
    },
  };
}

export function toAssistantUiMessages(messages: readonly AssistantMessage[]): ThreadMessageLike[] {
  const result: Array<{
    id: string;
    role: "user" | "assistant";
    content: ThreadAssistantMessagePart[];
    createdAt: Date;
    attachments?: CompleteAttachment[];
  }> = [];

  for (const message of messages) {
    if (message.role === "user") {
      const restored = restoreUserMessage(
        message.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
        message.id,
      );
      result.push({
        id: message.id,
        role: "user",
        content: restored.text ? [{ type: "text", text: restored.text }] : [],
        createdAt: new Date(message.timestamp),
        ...(restored.attachments.length ? { attachments: restored.attachments } : {}),
      });
      continue;
    }
    if (message.role === "assistant") {
      const content: ThreadAssistantMessagePart[] = [];
      for (const part of message.parts) {
        if (part.type === "text") content.push({ type: "text", text: part.text });
        else if (part.type === "tool_call") {
          content.push({
            type: "tool-call",
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: asToolArgs(part.input),
            argsText: JSON.stringify(part.input),
          });
        }
      }
      result.push({
        id: message.id,
        role: "assistant",
        content,
        createdAt: new Date(message.timestamp),
      });
      continue;
    }
    for (const part of message.parts) {
      if (part.type !== "tool_result") continue;
      const owner = [...result]
        .reverse()
        .find((candidate) =>
          candidate.content.some(
            (candidatePart) =>
              candidatePart.type === "tool-call" && candidatePart.toolCallId === part.toolCallId,
          ),
        );
      if (!owner) continue;
      owner.content = owner.content.map((candidatePart) =>
        candidatePart.type === "tool-call" && candidatePart.toolCallId === part.toolCallId
          ? { ...candidatePart, result: part.result, isError: part.isError }
          : candidatePart,
      );
    }
  }
  return result;
}

function updateTool(
  content: ThreadAssistantMessagePart[],
  tools: Map<string, number>,
  toolCallId: string,
  update: (tool: ToolCallMessagePart) => ToolCallMessagePart,
): void {
  const index = tools.get(toolCallId);
  const part = index === undefined ? undefined : content[index];
  if (part?.type === "tool-call" && index !== undefined) content[index] = update(part);
}

function asToolArgs(input: unknown): ToolCallMessagePart["args"] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return JSON.parse(JSON.stringify(input)) as ToolCallMessagePart["args"];
}

function lastUserText(messages: readonly ThreadMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    const text = message.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("");
    const attachments = message.attachments
      .flatMap((attachment) => attachment.content)
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n\n");
    return [text, attachments].filter((part) => part.trim()).join("\n\n");
  }
  return "";
}

function restoreUserMessage(
  text: string,
  messageId: string,
): { text: string; attachments: CompleteAttachment[] } {
  const attachments: CompleteAttachment[] = [];
  const prefixed = text.startsWith("<attachment name=") ? `\n\n${text}` : text;
  const visible = prefixed.replace(
    /\n\n<attachment name=([^\n>]+)>\n([\s\S]*?)\n<\/attachment>(?=\n\n<attachment name=|$)/g,
    (marker, name: string, _contents: string) => {
      attachments.push({
        id: `${messageId}:attachment:${attachments.length}`,
        type: "document",
        name,
        contentType: "text/plain",
        status: { type: "complete" },
        content: [{ type: "text", text: marker.slice(2) }],
      });
      return "";
    },
  );
  return { text: visible, attachments };
}

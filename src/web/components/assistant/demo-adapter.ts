import type { ChatModelAdapter, ThreadMessage } from "@assistant-ui/react";
import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

export type DemoAssistantContext = {
  dictionary: Dictionary;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
};

export function createDemoChatModelAdapter(
  getContext: () => DemoAssistantContext,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const reply = buildDemoReply(messages, getContext());
      yield* streamText(reply, abortSignal);
    },
  };
}

function buildDemoReply(messages: readonly ThreadMessage[], context: DemoAssistantContext): string {
  const { dictionary, selectedAttempt, selectedTask } = context;
  const demo = dictionary.board.assistant.demo;
  const prompt = lastUserText(messages).trim();
  const taskLine = selectedTask
    ? `${selectedTask.identifier} · ${selectedTask.title} · ${selectedTask.state}`
    : dictionary.board.assistant.noTask;
  const attemptLine = selectedAttempt
    ? `${dictionary.board.assistant.attempt} ${String(selectedAttempt.sequence).padStart(2, "0")} · ${selectedAttempt.status}`
    : dictionary.board.assistant.noTask;

  const kind = classifyPrompt(prompt, dictionary.board.assistant.suggestions);
  if (kind === "explain") {
    return [
      demo.explainIntro,
      `${demo.taskLine}: ${taskLine}`,
      `${demo.attemptLine}: ${attemptLine}`,
      demo.explainOutro,
    ].join("\n");
  }
  if (kind === "attention") {
    return [demo.attentionIntro, `${demo.taskLine}: ${taskLine}`, demo.attentionOutro].join("\n");
  }
  if (kind === "summary") {
    return [
      demo.summaryIntro,
      `${demo.taskLine}: ${taskLine}`,
      `${demo.attemptLine}: ${attemptLine}`,
      demo.summaryOutro,
    ].join("\n");
  }
  return [
    demo.genericIntro,
    `${demo.taskLine}: ${taskLine}`,
    `${demo.heard}: ${prompt || "—"}`,
    demo.genericOutro,
  ].join("\n");
}

function classifyPrompt(
  prompt: string,
  suggestions: Dictionary["board"]["assistant"]["suggestions"],
): "explain" | "attention" | "summary" | "generic" {
  const normalized = prompt.toLowerCase();
  if (includesAny(normalized, [suggestions.explain, "解释", "explain"])) return "explain";
  if (includesAny(normalized, [suggestions.attention, "待处理", "attention", "block"])) {
    return "attention";
  }
  if (includesAny(normalized, [suggestions.summary, "总结", "summar"])) return "summary";
  return "generic";
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => needle.length > 0 && haystack.includes(needle.toLowerCase()));
}

function lastUserText(messages: readonly ThreadMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "user") continue;
    return message.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

async function* streamText(text: string, abortSignal: AbortSignal) {
  let output = "";
  const chunkSize = 4;
  for (let index = 0; index < text.length; index += chunkSize) {
    if (abortSignal.aborted) return;
    output += text.slice(index, index + chunkSize);
    yield { content: [{ type: "text" as const, text: output }] };
    await delay(12, abortSignal);
  }
}

function delay(ms: number, abortSignal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (abortSignal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    abortSignal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

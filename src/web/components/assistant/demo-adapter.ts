import type { AttemptSnapshot, TaskSummary } from "@symphoneer/contracts";
import type {
  AssistantAdapter,
  AssistantEvent,
  AssistantMessage,
  AssistantSession,
  AssistantSessionInput,
} from "@symphoneer/runtime-tools";
import type { Dictionary } from "../../i18n/index.ts";

export type DemoAssistantContext = {
  dictionary: Dictionary;
  selectedAttempt: AttemptSnapshot | null;
  selectedTask: TaskSummary | null;
};

export function createDemoAssistantAdapter(
  getContext: () => DemoAssistantContext,
): AssistantAdapter {
  return {
    status: () => ({ state: "ready", provider: "demo" }),
    async createOrResumeSession(input: AssistantSessionInput): Promise<AssistantSession> {
      const context = getContext();
      const subject = context.selectedAttempt?.id ?? context.selectedTask?.id ?? "global";
      return {
        id: `assistant:demo:${input.attemptId ?? input.taskId ?? subject}`,
        status: { state: "ready", provider: "demo" },
        summary: "Deterministic Symphoneer Assistant demo session.",
        run: ({ messages, abortSignal }) =>
          streamReply(buildDemoReply(messages, getContext()), abortSignal),
      };
    },
  };
}

function buildDemoReply(
  messages: readonly AssistantMessage[],
  context: DemoAssistantContext,
): string {
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

function lastUserText(messages: readonly AssistantMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "user") return message.text;
  }
  return "";
}

async function* streamReply(text: string, abortSignal: AbortSignal): AsyncIterable<AssistantEvent> {
  const chunkSize = 4;
  for (let index = 0; index < text.length; index += chunkSize) {
    if (abortSignal.aborted) return;
    yield { type: "text_delta", delta: text.slice(index, index + chunkSize) };
    await delay(12, abortSignal);
  }
  if (!abortSignal.aborted) yield { type: "completed" };
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

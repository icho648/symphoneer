export type AssistantStatus =
  | { state: "disabled"; reason: "missing_config" | "invalid_key" | "provider_failure" | "opt_out" }
  | { state: "ready"; provider: string; model?: string };

export interface AssistantSessionInput {
  taskId?: string;
  attemptId?: string;
  locale?: string;
}

export type AssistantMessage = {
  role: "user" | "assistant";
  text: string;
};

export interface AssistantRunInput {
  messages: readonly AssistantMessage[];
  abortSignal: AbortSignal;
}

export type AssistantEvent =
  | { type: "text_delta"; delta: string }
  | { type: "completed" }
  | { type: "error"; message: string };

export interface AssistantSession {
  id: string;
  status: AssistantStatus;
  summary: string;
  run(input: AssistantRunInput): AsyncIterable<AssistantEvent>;
}

export interface AssistantAdapter {
  status(): AssistantStatus;
  createOrResumeSession(input: AssistantSessionInput): Promise<AssistantSession>;
}

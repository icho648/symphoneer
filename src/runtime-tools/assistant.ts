export type AssistantStatus =
  | { state: "disabled"; reason: "missing_config" | "invalid_key" | "provider_failure" | "opt_out" }
  | { state: "ready"; provider: string; model?: string };

export interface AssistantSessionInput {
  taskId?: string;
  attemptId?: string;
  locale?: string;
}

export interface AssistantSession {
  id: string;
  status: AssistantStatus;
  summary: string;
}

export interface AssistantAdapter {
  status(): AssistantStatus;
  createOrResumeSession(input: AssistantSessionInput): Promise<AssistantSession>;
}

export class DisabledAssistantAdapter implements AssistantAdapter {
  readonly #reason: Extract<AssistantStatus, { state: "disabled" }>["reason"];

  constructor(
    reason: Extract<AssistantStatus, { state: "disabled" }>["reason"] = "missing_config",
  ) {
    this.#reason = reason;
  }

  status(): AssistantStatus {
    return { state: "disabled", reason: this.#reason };
  }

  async createOrResumeSession(input: AssistantSessionInput): Promise<AssistantSession> {
    return {
      id: `assistant:disabled:${input.attemptId ?? input.taskId ?? "none"}`,
      status: this.status(),
      summary: "Assistant is disabled until a model provider is configured.",
    };
  }
}

export function createAssistantAdapter(env: NodeJS.ProcessEnv = process.env): AssistantAdapter {
  if (env.SYMPHONEER_ASSISTANT === "0" || env.SYMPHONEER_ASSISTANT === "disabled") {
    return new DisabledAssistantAdapter("opt_out");
  }
  if (!env.SYMPHONEER_ASSISTANT_API_KEY) {
    return new DisabledAssistantAdapter("missing_config");
  }
  if (env.SYMPHONEER_ASSISTANT_API_KEY === "invalid") {
    return new DisabledAssistantAdapter("invalid_key");
  }
  // Pi / provider adapters are optional; without a concrete SDK keep disabled-ready surface.
  return new DisabledAssistantAdapter("missing_config");
}

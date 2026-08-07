import type {
  AssistantAdapter,
  AssistantEvent,
  AssistantSession,
  AssistantSessionInput,
  AssistantStatus,
} from "./assistant-contract.ts";

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
    const summary = "Assistant is disabled until a model provider is configured.";
    return {
      id: `assistant:disabled:${input.attemptId ?? input.taskId ?? "none"}`,
      status: this.status(),
      summary,
      run: async function* (): AsyncIterable<AssistantEvent> {
        yield { type: "error", message: summary };
      },
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
  // Concrete Assistant runtimes (for example Pi SDK) remain optional adapters.
  return new DisabledAssistantAdapter("missing_config");
}

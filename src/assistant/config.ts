import type { Models } from "@earendil-works/pi-ai";
import type { SqliteSessionMetadata } from "@earendil-works/pi-session-backend-sqlite-node";
import type { AssistantSessionMetadata, AssistantStatus } from "../assistant-client/index.ts";

export type AssistantConfig = {
  provider: string;
  model: string;
  apiKey: string;
  thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
};

export function resolveAssistantConfig(
  env: NodeJS.ProcessEnv,
  models?: Models,
): { status: AssistantStatus; config?: AssistantConfig } {
  if (env.SYMPHONEER_ASSISTANT === "0" || env.SYMPHONEER_ASSISTANT === "disabled") {
    return { status: { state: "disabled", reason: "opt_out" } };
  }
  const provider = env.SYMPHONEER_ASSISTANT_PROVIDER?.trim();
  const model = env.SYMPHONEER_ASSISTANT_MODEL?.trim();
  const apiKey = env.SYMPHONEER_ASSISTANT_API_KEY;
  if (!provider || !model || !apiKey) {
    return { status: { state: "disabled", reason: "missing_config" } };
  }
  const thinkingLevel = env.SYMPHONEER_ASSISTANT_THINKING?.trim() || "off";
  if (!isThinkingLevel(thinkingLevel)) {
    return { status: { state: "invalid_config", message: "Invalid Assistant thinking level" } };
  }
  try {
    if (models && !models.getModel(provider, model)) {
      return { status: { state: "invalid_config", message: "Assistant model was not found" } };
    }
  } catch {
    return {
      status: { state: "provider_failure", message: "Assistant provider failed to initialize" },
    };
  }
  return {
    status: { state: "ready", provider, model },
    config: { provider, model, apiKey, thinkingLevel },
  };
}

export function readProductMetadata(metadata: SqliteSessionMetadata): {
  provider: string;
  model: string;
  metadata: AssistantSessionMetadata;
} {
  const value = metadata.metadata ?? {};
  return {
    provider: typeof value.provider === "string" ? value.provider : "unknown",
    model: typeof value.model === "string" ? value.model : "unknown",
    metadata: {
      ...withoutUndefined({
        projectId: typeof value.projectId === "string" ? value.projectId : undefined,
        taskId: typeof value.taskId === "string" ? value.taskId : undefined,
        attemptId: typeof value.attemptId === "string" ? value.attemptId : undefined,
        locale: typeof value.locale === "string" ? value.locale : undefined,
      }),
      createdBy: value.createdBy === "tui" ? "tui" : "web",
      schemaVersion: 1,
    },
  };
}

export function buildSystemPrompt(metadata: AssistantSessionMetadata): string {
  return [
    "You are the optional Symphoneer Assistant.",
    "Use only the supplied Runtime tools. You have no workspace, shell, file, Git, or coding-agent authority.",
    `Selected product context: ${JSON.stringify(metadata)}`,
  ].join("\n");
}

export function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>;
}

function isThinkingLevel(value: string): value is AssistantConfig["thinkingLevel"] {
  return ["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(value);
}

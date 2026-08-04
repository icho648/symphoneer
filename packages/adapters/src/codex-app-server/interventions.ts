import type {
  AgentRunEvent,
  InterventionDetails,
  InterventionQuestion,
  InterventionResponse,
} from "@symphoneer/symphony-core";

import { asRecord, stringField } from "./protocol.ts";
import type { CodexServerMessage, CodexTransport, JsonRpcId } from "./transport.ts";

export type PendingIntervention =
  | { id: JsonRpcId; method: "approval" }
  | { id: JsonRpcId; method: "input"; questionIds: string[] };

export function requestIntervention(
  transport: CodexTransport,
  message: Extract<CodexServerMessage, { kind: "request" }>,
  pending: Map<string, PendingIntervention>,
  emit: (event: AgentRunEvent) => void,
  now: () => Date,
): void {
  const requestRef = `${typeof message.id}:${message.id}`;
  if (
    message.method === "item/commandExecution/requestApproval" ||
    message.method === "item/fileChange/requestApproval"
  ) {
    const details = approvalDetails(message.method, message.params);
    pending.set(requestRef, { id: message.id, method: "approval" });
    emit({
      type: "intervention_requested",
      occurredAt: now().toISOString(),
      requestRef,
      kind: "approval",
      prompt:
        details.action === "command"
          ? "Codex requests approval to run a command."
          : "Codex requests approval to change files.",
      details,
    });
    return;
  }
  if (message.method === "item/tool/requestUserInput") {
    const rawQuestions = asRecord(message.params)?.questions;
    const questions = Array.isArray(rawQuestions)
      ? rawQuestions
          .map(parseInterventionQuestion)
          .filter((question): question is InterventionQuestion => question !== null)
      : [];
    if (questions.length === 0) {
      transportError(message, "Invalid request_user_input payload");
      return;
    }
    pending.set(requestRef, {
      id: message.id,
      method: "input",
      questionIds: questions.map(({ id }) => id),
    });
    emit({
      type: "intervention_requested",
      occurredAt: now().toISOString(),
      requestRef,
      kind: "input",
      prompt: questions.map(({ prompt }) => prompt).join("\n"),
      questionIds: questions.map(({ id }) => id),
      questions,
    });
    return;
  }
  transportError(message, "Unsupported Codex server request");

  function transportError(request: typeof message, error: string) {
    // The caller will keep the Turn paused until Codex acknowledges the protocol error.
    // Do not include the Provider payload in the error response.
    transport.reject(request.id, -32601, error);
  }
}

function approvalDetails(
  method: "item/commandExecution/requestApproval" | "item/fileChange/requestApproval",
  params: unknown,
): InterventionDetails {
  const reason = safeInterventionText(stringField(params, "reason"));
  if (method === "item/commandExecution/requestApproval") {
    return {
      action: "command",
      command: safeInterventionText(stringField(params, "command")) ?? "<command unavailable>",
      cwd: safeInterventionText(stringField(params, "cwd")),
      reason,
    };
  }
  return {
    action: "file_change",
    reason,
    scope: stringField(params, "grantRoot") ? "additional_root" : "workspace",
  };
}

function safeInterventionText(value: string | null): string | null {
  if (value === null) return null;
  const redacted = value
    .replace(/(\b(?:cookie|set-cookie)\s*:\s*)[^\r\n]*/gi, "$1<redacted>")
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,
      "<redacted>",
    )
    .replace(/(\b[A-Za-z][A-Za-z\d+.-]*:\/\/[^/\s:@]+:)[^@\s]+@/g, "$1<redacted>@")
    .replace(
      /((?:(?:[A-Za-z][A-Za-z\d_-]*(?:key|token|secret|password|credential|cookie|authorization)[A-Za-z\d_-]*)|api[_-]?key|token|secret|password|credential|cookie|authorization|set-cookie)\s*[=:]\s*)(?:[A-Za-z]+\s+)?[^\s]+/gi,
      "$1<redacted>",
    );
  return redacted.length > 512 ? `${redacted.slice(0, 509)}...` : redacted;
}

function parseInterventionQuestion(value: unknown): InterventionQuestion | null {
  const id = stringField(value, "id");
  const prompt = stringField(value, "question");
  if (!id || !prompt) return null;
  const rawOptions = asRecord(value)?.options;
  const options = Array.isArray(rawOptions)
    ? rawOptions.flatMap((option) => {
        const label = stringField(option, "label");
        return label ? [{ label, description: stringField(option, "description") }] : [];
      })
    : [];
  return { id, prompt, options };
}

export function approvalDecision(decision: InterventionResponse): "accept" | "cancel" | "decline" {
  if (decision.decision === "approved") return "accept";
  if (decision.decision === "rejected") return "decline";
  if (decision.decision === "canceled") return "cancel";
  throw new Error("Approval interventions require approved, rejected, or canceled");
}

export function inputAnswers(
  questionIds: string[],
  decision: InterventionResponse,
): Record<string, { answers: string[] }> {
  if (decision.decision === "canceled" || decision.decision === "rejected") return {};
  if (decision.decision !== "answered") throw new Error("Input interventions require an answer");
  const responses =
    decision.responses ??
    (decision.response && questionIds.length === 1
      ? { [questionIds[0] as string]: [decision.response] }
      : undefined);
  if (!responses || questionIds.some((id) => !responses[id])) {
    throw new Error("Input intervention answers must cover every Codex question");
  }
  return Object.fromEntries(questionIds.map((id) => [id, { answers: responses[id] as string[] }]));
}

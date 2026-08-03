import {
  CONTRACT_SCHEMA_VERSION,
  type EligibilityReason,
  type EligibilityResult,
  EligibilityResultSchema,
  type TaskSummary,
} from "@symphoneer/contracts";

export interface EligibilityPolicy {
  activeStates: readonly string[];
  terminalStates: readonly string[];
  requiredLabels: readonly string[];
  excludedLabels: readonly string[];
}

const normalize = (value: string) => value.trim().toLowerCase();

export function evaluateEligibility(
  task: TaskSummary,
  policy: EligibilityPolicy,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const state = normalize(task.state);
  const activeStates = new Set(policy.activeStates.map(normalize));
  const terminalStates = new Set(policy.terminalStates.map(normalize));
  const taskLabels = new Set(task.labels.map(normalize));

  if (!task.dispatchable) reasons.push("not_dispatchable");
  if (terminalStates.has(state)) reasons.push("terminal_state");
  else if (!activeStates.has(state)) reasons.push("inactive_state");
  if (!policy.requiredLabels.every((label) => taskLabels.has(normalize(label)))) {
    reasons.push("missing_required_label");
  }
  if (policy.excludedLabels.some((label) => taskLabels.has(normalize(label)))) {
    reasons.push("excluded_label");
  }

  return EligibilityResultSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId: task.id,
    eligible: reasons.length === 0,
    reasons,
  });
}

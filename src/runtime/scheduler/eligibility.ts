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

export const normalizeTrackerValue = (value: string) => value.trim().toLowerCase();

export function evaluateEligibility(
  task: TaskSummary,
  policy: EligibilityPolicy,
): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const state = normalizeTrackerValue(task.state);
  const activeStates = new Set(policy.activeStates.map(normalizeTrackerValue));
  const terminalStates = new Set(policy.terminalStates.map(normalizeTrackerValue));
  const taskLabels = new Set(task.labels.map(normalizeTrackerValue));

  if (!task.dispatchable) reasons.push("not_dispatchable");
  if (terminalStates.has(state)) reasons.push("terminal_state");
  else if (!activeStates.has(state)) reasons.push("inactive_state");
  if (!policy.requiredLabels.every((label) => taskLabels.has(normalizeTrackerValue(label)))) {
    reasons.push("missing_required_label");
  }
  if (policy.excludedLabels.some((label) => taskLabels.has(normalizeTrackerValue(label)))) {
    reasons.push("excluded_label");
  }

  return EligibilityResultSchema.parse({
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    taskId: task.id,
    eligible: reasons.length === 0,
    reasons,
  });
}

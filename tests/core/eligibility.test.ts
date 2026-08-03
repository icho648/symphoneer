import assert from "node:assert/strict";
import test from "node:test";

import { CONTRACT_SCHEMA_VERSION, type TaskSummary } from "../../packages/contracts/src/index.ts";
import { evaluateEligibility } from "../../packages/symphony-core/src/eligibility.ts";

const baseTask: TaskSummary = {
  schemaVersion: CONTRACT_SCHEMA_VERSION,
  id: "task-13",
  identifier: "#13",
  source: {
    kind: "github",
    nativeId: "13",
    url: "https://github.com/icho648/symphoneer/issues/13",
  },
  title: "Build the core",
  state: "open",
  labels: ["symphoneer:ready"],
  dispatchable: true,
};

const policy = {
  activeStates: ["open"],
  terminalStates: ["closed"],
  requiredLabels: ["symphoneer:ready"],
  excludedLabels: ["symphoneer:review"],
};

test("eligibility covers every state, label, and adapter-owned routing gate", () => {
  const cases: Array<[string, Partial<TaskSummary>, boolean, string[]]> = [
    ["eligible", {}, true, []],
    ["case-insensitive", { state: " OPEN ", labels: [" Symphoneer:Ready "] }, true, []],
    ["terminal", { state: "closed" }, false, ["terminal_state"]],
    ["inactive", { state: "backlog" }, false, ["inactive_state"]],
    ["missing label", { labels: [] }, false, ["missing_required_label"]],
    [
      "excluded label",
      { labels: ["symphoneer:ready", "symphoneer:review"] },
      false,
      ["excluded_label"],
    ],
    ["adapter gate", { dispatchable: false }, false, ["not_dispatchable"]],
  ];

  for (const [name, task, eligible, reasons] of cases) {
    const result = evaluateEligibility({ ...baseTask, ...task }, policy);
    assert.equal(result.eligible, eligible, name);
    assert.deepEqual(result.reasons, reasons, name);
  }
});

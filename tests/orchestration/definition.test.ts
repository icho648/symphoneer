import assert from "node:assert/strict";
import test from "node:test";

import {
  bindOrchestrationDefinition,
  hashOrchestrationDefinition,
  OrchestrationDefinitionSchema,
} from "@symphoneer/contracts";
import { loadOrchestrationDefinitionSync } from "../../src/runtime/orchestration/index.ts";
import { loadProjectProfile } from "../../src/runtime/workflow/index.ts";

test("ProjectProfile loads WORKFLOW.md without treating it as orchestration", async () => {
  const profile = await loadProjectProfile({ workspaceRoot: "/tmp/symphoneer-workspaces" });
  assert.ok(profile.promptTemplate.includes("Implement"));
  assert.equal(profile.config.tracker.kind, "github");
  assert.doesNotThrow(() =>
    OrchestrationDefinitionSchema.parse({
      id: "x",
      version: 1,
      nodes: [{ id: "a", kind: "agent" }],
      edges: [{ from: "START", to: "a" }],
    }),
  );
  assert.throws(() =>
    OrchestrationDefinitionSchema.parse({
      path: profile.path,
      promptTemplate: profile.promptTemplate,
      config: profile.config,
    }),
  );
});

test("OrchestrationDefinition JSON IR loads with stable hash binding", () => {
  const loaded = loadOrchestrationDefinitionSync();
  assert.equal(loaded.definition.id, "plan-implement-review");
  assert.equal(loaded.binding.definitionId, "plan-implement-review");
  assert.equal(loaded.binding.definitionVersion, 1);
  assert.match(loaded.binding.definitionHash, /^[a-f0-9]{64}$/);
  assert.equal(
    loaded.binding.definitionHash,
    hashOrchestrationDefinition(loaded.definition),
  );
  const rebound = bindOrchestrationDefinition(loaded.definition);
  assert.deepEqual(rebound, loaded.binding);
});

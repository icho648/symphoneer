import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  loadWorkflow,
  renderPrompt,
  WorkflowError,
} from "../../packages/symphony-core/src/workflow/index.ts";

test("the repository .symphoneer/WORKFLOW.md loads into a validated effective config", async () => {
  const workflow = await loadWorkflow();

  assert.equal(workflow.path, resolve(".symphoneer/WORKFLOW.md"));
  assert.equal(workflow.config.tracker.kind, "github");
  assert.deepEqual(workflow.config.symphoneer.eligibility.requiredLabels, ["symphoneer:ready"]);
  assert.deepEqual(workflow.config.symphoneer.eligibility.excludedLabels, ["symphoneer:review"]);
  assert.equal(workflow.config.agent.maxConcurrentAgents, 1);
  assert.equal(workflow.config.workspace.root, resolve(".symphoneer/workspaces"));
  assert.equal(workflow.config.hooks.timeoutMs, 60_000);
  assert.match(workflow.promptTemplate, /\{\{ issue\.identifier \}\}/);
});

test("workflow validation returns typed errors and keeps adapter config provider-owned", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "symphoneer-workflow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(
    loadWorkflow({ cwd: directory }),
    (error) => error instanceof WorkflowError && error.code === "missing_workflow_file",
  );

  const configDirectory = resolve(directory, ".symphoneer");
  await mkdir(configDirectory);
  const path = resolve(configDirectory, "WORKFLOW.md");
  await writeFile(path, "---\n- not\n- a map\n---\nprompt\n");
  await assert.rejects(
    loadWorkflow({ path }),
    (error) => error instanceof WorkflowError && error.code === "workflow_front_matter_not_a_map",
  );

  await writeFile(
    path,
    "---\ntracker:\n  kind: github\n  active_states: [open]\n  terminal_states: [closed]\n---\nprompt\n",
  );
  const defaulted = await loadWorkflow({ path });
  assert.equal(defaulted.config.workspace.root, resolve(configDirectory, "workspaces"));

  await writeFile(
    path,
    `---
tracker:
  kind: github
  provider:
    opaque_setting: keep-me
  active_states: [Open]
  terminal_states: [Closed]
workspace:
  root: $SYMPHONEER_TEST_WORKSPACE
agent:
  max_concurrent_agents_by_state:
    " Open ": 2
    closed: 0
    invalid: nope
hooks:
  after_create: echo created
  before_run: echo running
  after_run: echo finished
  before_remove: echo removing
  timeout_ms: 1234
---
{{ issue.identifier }} attempt={{ attempt }}
`,
  );
  const workflow = await loadWorkflow({
    path,
    env: { SYMPHONEER_TEST_WORKSPACE: resolve(directory, "workspaces") },
  });

  assert.equal(workflow.config.tracker.provider.opaque_setting, "keep-me");
  assert.deepEqual(workflow.config.agent.maxConcurrentAgentsByState, { open: 2 });
  assert.equal(workflow.config.workspace.root, resolve(directory, "workspaces"));
  assert.deepEqual(workflow.config.hooks, {
    afterCreate: "echo created",
    beforeRun: "echo running",
    afterRun: "echo finished",
    beforeRemove: "echo removing",
    timeoutMs: 1234,
  });
});

test("prompt rendering is strict and exposes only issue plus attempt", async () => {
  const workflow = await loadWorkflow();
  const rendered = await renderPrompt(workflow, {
    issue: { identifier: "#13", title: "Build the core" },
    attempt: 2,
  });

  assert.match(rendered, /Implement #13: Build the core/);
  await assert.rejects(
    renderPrompt({ ...workflow, promptTemplate: "{{ unknown }}" }, { issue: {}, attempt: null }),
    (error) => error instanceof WorkflowError && error.code === "template_render_error",
  );
});

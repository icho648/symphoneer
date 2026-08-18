import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { loadWorkflow, renderPrompt, WorkflowError } from "../../src/runtime/workflow/index.ts";

test("a managed project's .symphoneer/WORKFLOW.md loads into a validated effective config", async () => {
  const workspaceRoot = resolve(tmpdir(), "symphoneer-host-workspaces");
  const projectRoot = resolve("tests/fixtures/project");
  const workflow = await loadWorkflow({ cwd: projectRoot, workspaceRoot });

  assert.equal(workflow.path, resolve(projectRoot, ".symphoneer", "WORKFLOW.md"));
  assert.equal(workflow.config.tracker.kind, "github");
  assert.deepEqual(workflow.config.symphoneer.eligibility.requiredLabels, ["symphoneer:ready"]);
  assert.deepEqual(workflow.config.symphoneer.eligibility.excludedLabels, ["symphoneer:review"]);
  assert.equal(workflow.config.agent.maxConcurrentAgents, 1);
  assert.equal(workflow.config.agent.maxAttempts, 3);
  assert.equal(workflow.config.agent.executor, "codex-app-server");
  assert.equal(workflow.config.workspace.root, workspaceRoot);
  assert.equal(workflow.config.hooks.timeoutMs, 60_000);
  assert.match(workflow.promptTemplate, /\{\{ issue\.identifier \}\}/);
});

test("Claude Code workflow selection is explicit and fails closed", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "symphoneer-claude-workflow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configDirectory = resolve(directory, ".symphoneer");
  await mkdir(configDirectory);
  const path = resolve(configDirectory, "WORKFLOW.md");
  const workflow = (agent: string, claude = "") => `---
tracker:
  kind: github
  active_states: [open]
  terminal_states: [closed]
agent:
${agent}
${claude}
---
prompt
`;

  await writeFile(
    path,
    workflow(
      "  executor: claude-code",
      "claude:\n  command: claude\n  argv: [--no-chrome]\n  model: sonnet\n  permission_mode: acceptEdits",
    ),
  );
  const configured = await loadWorkflow({ cwd: directory });
  assert.equal(configured.config.agent.executor, "claude-code");
  assert.deepEqual(configured.config.claude, {
    command: "claude",
    argv: ["--no-chrome"],
    model: "sonnet",
    permissionMode: "acceptEdits",
    turnTimeoutMs: 3_600_000,
    stallTimeoutMs: 300_000,
  });

  for (const source of [
    workflow("  executor: unknown"),
    workflow("  executor: claude-code", "claude:\n  permission_mode: invalid"),
    workflow("  executor: claude-code", 'claude:\n  command: ""\n  permission_mode: acceptEdits'),
    workflow("  executor: claude-code", "claude:\n  command: claude"),
  ]) {
    await writeFile(path, source);
    await assert.rejects(
      loadWorkflow({ cwd: directory }),
      (error) => error instanceof WorkflowError && error.code === "workflow_validation_error",
    );
  }
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
    loadWorkflow({ cwd: directory }),
    (error) => error instanceof WorkflowError && error.code === "workflow_front_matter_not_a_map",
  );

  await writeFile(
    path,
    "---\ntracker:\n  kind: github\n  active_states: [open]\n  terminal_states: [closed]\n---\nprompt\n",
  );
  const defaulted = await loadWorkflow({ cwd: directory });
  assert.equal(defaulted.config.workspace.root, resolve(tmpdir(), "symphony_workspaces"));

  for (const [root, expected] of [
    ["relative-workspaces", resolve(configDirectory, "relative-workspaces")],
    ["~/symphoneer-workspaces", resolve(homedir(), "symphoneer-workspaces")],
  ]) {
    await writeFile(
      path,
      `---\ntracker:\n  kind: github\n  active_states: [open]\n  terminal_states: [closed]\nworkspace:\n  root: ${root}\n---\nprompt\n`,
    );
    assert.equal((await loadWorkflow({ cwd: directory })).config.workspace.root, expected);
  }

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
  const relativeEnvironment = await loadWorkflow({
    cwd: directory,
    env: { SYMPHONEER_TEST_WORKSPACE: "relative-env-workspaces" },
  });
  assert.equal(
    relativeEnvironment.config.workspace.root,
    resolve(configDirectory, "relative-env-workspaces"),
  );

  const configured = await loadWorkflow({
    cwd: directory,
    env: { SYMPHONEER_TEST_WORKSPACE: resolve(directory, "workspaces") },
  });
  assert.equal(configured.config.workspace.root, resolve(directory, "workspaces"));

  const workspaceRoot = resolve(directory, "application-workspaces");
  const workflow = await loadWorkflow({
    cwd: directory,
    env: { SYMPHONEER_TEST_WORKSPACE: resolve(directory, "ignored-workspaces") },
    workspaceRoot,
  });

  assert.equal(workflow.config.tracker.provider.opaque_setting, "keep-me");
  assert.deepEqual(workflow.config.agent.maxConcurrentAgentsByState, { open: 2 });
  assert.equal(workflow.config.workspace.root, workspaceRoot);
  assert.deepEqual(workflow.config.hooks, {
    afterCreate: "echo created",
    beforeRun: "echo running",
    afterRun: "echo finished",
    beforeRemove: "echo removing",
    timeoutMs: 1234,
  });

  await assert.rejects(
    loadWorkflow({ cwd: directory, workspaceRoot: "relative-workspaces" }),
    (error) =>
      error instanceof WorkflowError &&
      error.code === "workflow_validation_error" &&
      error.message.includes("absolute path"),
  );
});

test("workflow loading ignores a root WORKFLOW.md", async (t) => {
  const directory = await mkdtemp(resolve(tmpdir(), "symphoneer-workflow-location-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(resolve(directory, ".symphoneer"));
  const valid =
    "---\ntracker:\n  kind: github\n  active_states: [open]\n  terminal_states: [closed]\n---\nprompt\n";
  await writeFile(resolve(directory, ".symphoneer", "WORKFLOW.md"), valid);

  await writeFile(resolve(directory, "WORKFLOW.md"), "---\n- invalid\n---\nprompt\n");
  const loaded = await loadWorkflow({ cwd: directory });
  assert.equal(loaded.path, resolve(directory, ".symphoneer", "WORKFLOW.md"));
  assert.equal(loaded.promptTemplate, "prompt");
});

test("prompt rendering is strict and exposes only issue plus attempt", async () => {
  const workflow = await loadWorkflow({ cwd: resolve("tests/fixtures/project") });
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

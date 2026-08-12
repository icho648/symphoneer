import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RuntimeHttpServer, RuntimeService } from "@symphoneer/runtime";
import { RuntimeError } from "../../src/runtime/errors.ts";
import {
  assertAllowedOrigin,
  parseGitRemoteOutput,
  redactSecrets,
  resolveGitHubToken,
  resolveRuntimeHostConfig,
} from "../../src/runtime/host/index.ts";

test("Host turns GitHub remotes into selectable repository candidates", () => {
  assert.deepEqual(
    parseGitRemoteOutput(
      [
        "origin\tgit@github.com:icho648/symphoneer-fixtures.git (fetch)",
        "origin\tgit@github.com:icho648/symphoneer-fixtures.git (push)",
        "upstream\thttps://github.com/octo/example (fetch)",
      ].join("\n"),
    ),
    [
      { trackerKind: "github", repository: "icho648/symphoneer-fixtures", remote: "origin" },
      { trackerKind: "github", repository: "octo/example", remote: "upstream" },
    ],
  );
});

test("Host reuses the authenticated GitHub CLI token without persisting it", async () => {
  assert.equal(
    await resolveGitHubToken({
      env: {},
      readCliToken: async () => "cli-token-from-keychain\n",
    }),
    "cli-token-from-keychain",
  );
});

test("Host config writes session token and validates loopback transport", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-host-"));
  const cacheDir = join(dataDir, "..", "cache");
  const logDir = join(dataDir, "..", "logs");
  const workspaceRoot = join(dataDir, "..", "workspaces");
  const config = await resolveRuntimeHostConfig({
    dataDir,
    cacheDir,
    logDir,
    workspaceRoot,
    sessionToken: "test-session-token-123456",
    host: "127.0.0.1",
    port: 0,
  });
  assert.equal(config.credentials.sessionToken, "test-session-token-123456");
  assert.equal(config.transport.kind, "http");
  assert.equal(config.cacheDir, cacheDir);
  assert.equal(config.logDir, logDir);
  assert.equal(config.workspaceRoot, workspaceRoot);
  assert.equal(
    await readFile(join(dataDir, "runtime-token"), "utf8"),
    "test-session-token-123456\n",
  );
  await assert.rejects(readFile(join(dataDir, "project-id"), "utf8"), { code: "ENOENT" });
});

test("Origin checks reject non-loopback browsers", () => {
  assert.doesNotThrow(() => assertAllowedOrigin(undefined));
  assert.doesNotThrow(() => assertAllowedOrigin("http://127.0.0.1:3000"));
  assert.throws(
    () => assertAllowedOrigin("https://evil.example"),
    (error: unknown) => error instanceof RuntimeError && error.code === "invalid_request",
  );
});

test("redactSecrets strips token-like values", () => {
  const redacted = redactSecrets({
    authorization: "Bearer abcdefghijklmnopqrstuvwxyz012345",
    ok: "hello",
  });
  assert.equal(redacted.ok, "hello");
  assert.equal(redacted.authorization, "[redacted]");
});

test("static UI serves assets immutably and SPA fallback without covering API", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-ui-"));
  const uiDistDir = join(dataDir, "ui");
  await mkdir(join(uiDistDir, "assets"), { recursive: true });
  await writeFile(join(uiDistDir, "index.html"), "<html><head></head><body>app</body></html>");
  await writeFile(join(uiDistDir, "assets", "app.js"), "console.log(1)");
  const token = "ui-token-abcdefghijklmnopqrstuv";
  const service = new RuntimeService({ dataDir });
  const server = new RuntimeHttpServer(service, {
    uiDistDir,
    sessionToken: token,
  });
  const endpoint = await server.listen();
  try {
    const asset = await fetch(`${endpoint.url}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

    const spa = await fetch(`${endpoint.url}/tasks/demo`);
    assert.equal(spa.status, 200);
    const html = await spa.text();
    assert.match(html, /__SYMPHONEER_RUNTIME__/);
    assert.match(html, /ui-token-abcdefghijklmnopqrstuv/);

    for (const path of ["/", "/index.html"] as const) {
      const root = await fetch(`${endpoint.url}${path}`);
      assert.equal(root.status, 200);
      const rootHtml = await root.text();
      assert.match(rootHtml, /__SYMPHONEER_RUNTIME__/);
      assert.match(rootHtml, /ui-token-abcdefghijklmnopqrstuv/);
      assert.equal(root.headers.get("cache-control"), "no-store");
    }

    const api = await fetch(`${endpoint.url}/v1/snapshot`);
    assert.equal(api.status, 400);

    const ok = await fetch(`${endpoint.url}/v1/snapshot`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(ok.status, 200);

    const health = await fetch(`${endpoint.url}/healthz`);
    assert.equal(health.status, 200);
  } finally {
    await server.close();
  }
});

test("Runtime exposes project groups with add and delete operations", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-projects-"));
  const token = "projects-token-abcdefghijklmnop";
  const project = {
    id: "project-alpha",
    trackerKind: "github",
    repository: "icho648/symphoneer-fixtures",
    projectRoot: "/tmp/fixtures",
    workspaceRoot: "/tmp/workspaces/project-alpha",
    repositorySource: "selected" as const,
  };
  const addedProject = {
    ...project,
    id: "project-bravo",
    repository: "icho648/symphoneer-hub",
    projectRoot: "/tmp/hub",
    workspaceRoot: "/tmp/workspaces/project-bravo",
  };
  let projects = [project];
  let addCalls = 0;
  let removedProjectId = "";
  const service = new RuntimeService({ dataDir });
  const server = new RuntimeHttpServer(service, {
    sessionToken: token,
    projects: async () => projects,
    addProject: async () => {
      addCalls += 1;
      projects = [...projects, addedProject];
      return addedProject;
    },
    removeProject: async (projectId) => {
      removedProjectId = projectId;
      projects = projects.filter((candidate) => candidate.id !== projectId);
      return projects;
    },
  });
  const endpoint = await server.listen();
  try {
    const headers = { Authorization: `Bearer ${token}` };
    const listed = await fetch(`${endpoint.url}/v1/projects`, { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual(await listed.json(), [project]);

    const added = await fetch(`${endpoint.url}/v1/projects`, {
      method: "POST",
      headers,
    });
    assert.equal(added.status, 200);
    assert.deepEqual(await added.json(), addedProject);
    assert.equal(addCalls, 1);

    const removed = await fetch(`${endpoint.url}/v1/projects/${addedProject.id}`, {
      method: "DELETE",
      headers,
    });
    assert.equal(removed.status, 200);
    assert.deepEqual(await removed.json(), [project]);
    assert.equal(removedProjectId, addedProject.id);
  } finally {
    await server.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

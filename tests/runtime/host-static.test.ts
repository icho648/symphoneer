import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { RuntimeHttpServer, RuntimeService } from "@symphoneer/runtime";
import {
  assertAllowedOrigin,
  redactSecrets,
  resolveRuntimeHostConfig,
} from "../../src/runtime/host/index.ts";
import { RuntimeError } from "../../src/runtime/errors.ts";

test("Host config writes session token and validates loopback transport", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "symphoneer-host-"));
  const config = await resolveRuntimeHostConfig({
    dataDir,
    sessionToken: "test-session-token-123456",
    host: "127.0.0.1",
    port: 0,
  });
  assert.equal(config.credentials.sessionToken, "test-session-token-123456");
  assert.equal(config.transport.kind, "http");
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

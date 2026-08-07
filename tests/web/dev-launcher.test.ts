import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  readStoredRuntimeToken,
  resolveDevSessionToken,
  runtimeIsHealthy,
} from "../../scripts/dev.ts";

test("root dev recognizes a healthy Runtime before spawning a duplicate", async () => {
  const healthy = await runtimeIsHealthy("http://127.0.0.1:4318", async () =>
    Response.json({
      schemaVersion: 2,
      status: "ok",
      runtime: { status: "online" },
      process: { status: "running" },
    }),
  );
  const otherService = await runtimeIsHealthy("http://127.0.0.1:4318", async () =>
    Response.json({ status: "ok" }),
  );

  assert.equal(healthy, true);
  assert.equal(otherService, false);
});

test("reuse path reads the stored Runtime token instead of inventing a new one", async () => {
  const stored = "existing-runtime-token-abcdefgh";
  const token = await resolveDevSessionToken({
    dataDir: "/tmp/symphoneer-runtime",
    reuseHealthyRuntime: true,
    readStoredToken: async () => stored,
    createToken: () => "should-not-be-used-xxxxxxxxxx",
  });
  assert.equal(token, stored);
});

test("reuse path fails closed when a healthy Runtime has no discoverable token", async () => {
  await assert.rejects(
    () =>
      resolveDevSessionToken({
        dataDir: path.join(os.tmpdir(), "symphoneer-runtime-missing-token"),
        reuseHealthyRuntime: true,
        readStoredToken: async () => undefined,
        createToken: () => "should-not-be-used-xxxxxxxxxx",
      }),
    /session token was not found/,
  );
});

test("readStoredRuntimeToken loads Runtime's persisted token file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "symphoneer-dev-token-"));
  const stored = "persisted-runtime-token-xyz123";
  await writeFile(path.join(dir, "runtime-token"), `${stored}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  assert.equal(await readStoredRuntimeToken(dir), stored);
});

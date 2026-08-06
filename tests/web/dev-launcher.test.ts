import assert from "node:assert/strict";
import { test } from "node:test";
import { runtimeIsHealthy } from "../../scripts/dev.ts";

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

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { runtimeIsHealthy } from "../../scripts/dev.mjs";

const webPackage = JSON.parse(
  readFileSync(resolve(process.cwd(), "apps/web/package.json"), "utf8"),
) as { scripts?: { dev?: string } };
const rootPackage = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8")) as {
  scripts?: { dev?: string };
};

test("web dev uses polling to avoid monorepo watcher EMFILE", () => {
  assert.equal(webPackage.scripts?.dev, "WATCHPACK_POLLING=true next dev");
});

test("root dev starts the complete Runtime and Web process pair", () => {
  assert.equal(rootPackage.scripts?.dev, "node scripts/dev.mjs");
});

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

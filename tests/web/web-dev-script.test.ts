import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

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

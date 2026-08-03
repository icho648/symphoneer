import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTRACT_SCHEMA_VERSION,
  VerificationResultSchema,
} from "../../packages/contracts/src/index.ts";

test("Verification cannot claim pass without an independent zero exit status", () => {
  const result = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    id: "verification-13",
    attemptId: "attempt-13",
    checkId: "check",
    status: "passed",
    argv: ["pnpm", "check"],
    cwd: ".",
    gitHead: "33ebe0568f053266f7ad9b8de082be8c57b1b949",
    startedAt: "2026-08-02T12:00:00.000Z",
    finishedAt: "2026-08-02T12:01:00.000Z",
    exitCode: 0,
    artifactRef: "artifacts/attempt-13/check.json",
  };

  assert.equal(VerificationResultSchema.parse(result).status, "passed");
  assert.throws(() => VerificationResultSchema.parse({ ...result, exitCode: 1 }));
  assert.throws(() =>
    VerificationResultSchema.parse({ ...result, finishedAt: "2026-08-02T11:59:59.000Z" }),
  );
  assert.equal(
    VerificationResultSchema.parse({
      ...result,
      status: "not_verified",
      finishedAt: null,
      exitCode: null,
      artifactRef: null,
    }).status,
    "not_verified",
  );
});

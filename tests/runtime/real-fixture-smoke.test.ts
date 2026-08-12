import assert from "node:assert/strict";
import test from "node:test";

import { fixtureOutcome } from "../../scripts/real-fixture-smoke.ts";

test("fixture Smoke waits through a finished Attempt while the Task remains dispatchable", () => {
  assert.equal(
    fixtureOutcome(
      { dispatchable: true, labels: ["symphoneer:ready"] },
      { status: "failed", finishedAt: "2026-08-12T10:00:00.000Z" },
    ),
    null,
  );
  assert.equal(
    fixtureOutcome(
      { dispatchable: false, labels: ["symphoneer:review"] },
      { status: "succeeded", finishedAt: "2026-08-12T10:00:01.000Z" },
    ),
    "passed",
  );
  assert.equal(
    fixtureOutcome(
      { dispatchable: true, labels: ["symphoneer:review"] },
      { status: "failed", finishedAt: "2026-08-12T10:00:02.000Z" },
    ),
    "failed",
  );
});

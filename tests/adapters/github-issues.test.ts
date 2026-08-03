import assert from "node:assert/strict";
import test from "node:test";

import { GitHubAdapterError, GitHubIssuesAdapter } from "../../packages/adapters/src/index.ts";

const issue = {
  id: 2_345_678,
  number: 14,
  html_url: "https://github.com/icho648/symphoneer/issues/14",
  title: "Connect the execution boundaries",
  state: "open",
  labels: [{ name: "Symphoneer:Ready" }],
  created_at: "2026-08-02T12:00:00Z",
  updated_at: "2026-08-03T12:00:00Z",
};

const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

test("GitHub adapter preserves native identity and applies the exact dispatch gate", async () => {
  const requests: Array<{ url: string; authorization: string | null }> = [];
  const adapter = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "secret-token",
    fetch: (async (input, init) => {
      requests.push({
        url: String(input),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return response(issue, 200, { etag: '"issue-v2"' });
    }) as typeof fetch,
  });

  const snapshot = await adapter.getIssue(14);
  assert.equal(snapshot.task.id, "github:icho648/symphoneer:2345678");
  assert.equal(snapshot.task.source.nativeId, "2345678");
  assert.equal(snapshot.task.source.url, issue.html_url);
  assert.equal(snapshot.task.dispatchable, true);
  assert.equal(snapshot.etag, '"issue-v2"');
  assert.deepEqual(requests, [
    {
      url: "https://api.github.com/repos/icho648/symphoneer/issues/14",
      authorization: "Bearer secret-token",
    },
  ]);

  for (const payload of [
    { ...issue, state: "closed" },
    { ...issue, labels: [] },
    { ...issue, labels: ["symphoneer:ready", "symphoneer:review"] },
  ]) {
    const gated = new GitHubIssuesAdapter({
      repository: "icho648/symphoneer",
      token: "token",
      fetch: (async () => response(payload)) as typeof fetch,
    });
    assert.equal((await gated.getIssue(14)).task.dispatchable, false);
  }
});

test("GitHub adapter makes conflicts and boundary failures explicit without response bodies", async () => {
  const changed = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "token",
    fetch: (async () => response(issue)) as typeof fetch,
  });
  await assert.rejects(
    changed.getIssue(14, { expectedUpdatedAt: "2026-08-02T12:00:00Z" }),
    (error) => error instanceof GitHubAdapterError && error.code === "tracker_conflict",
  );

  const denied = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "token",
    fetch: (async () => response({ secret: "must-not-leak" }, 403)) as typeof fetch,
  });
  await assert.rejects(
    denied.getIssue(14),
    (error) =>
      error instanceof GitHubAdapterError &&
      error.code === "not_authorized" &&
      !error.message.includes("must-not-leak"),
  );

  for (const [status, headers] of [
    [429, {}],
    [403, { "retry-after": "60" }],
    [403, { "x-ratelimit-remaining": "0" }],
  ] as const) {
    const rateLimited = new GitHubIssuesAdapter({
      repository: "icho648/symphoneer",
      token: "token",
      fetch: (async () => response({}, status, headers)) as typeof fetch,
    });
    await assert.rejects(
      rateLimited.getIssue(14),
      (error) =>
        error instanceof GitHubAdapterError && error.code === "rate_limited" && error.retryable,
    );
  }

  for (const malformed of [
    { ...issue, labels: [{ name: 14 }] },
    { ...issue, updated_at: "not-a-timestamp" },
  ]) {
    const invalid = new GitHubIssuesAdapter({
      repository: "icho648/symphoneer",
      token: "token",
      fetch: (async () => response(malformed)) as typeof fetch,
    });
    await assert.rejects(
      invalid.getIssue(14),
      (error) => error instanceof GitHubAdapterError && error.code === "invalid_response",
    );
  }
});

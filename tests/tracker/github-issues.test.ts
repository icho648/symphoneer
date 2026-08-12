import assert from "node:assert/strict";
import test from "node:test";

import { GitHubAdapterError, GitHubIssuesAdapter } from "../../src/runtime/tracker/index.ts";

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

  const snapshot = await adapter.getTask("14");
  assert.equal(snapshot.task.id, "github:icho648/symphoneer:2345678");
  assert.equal(snapshot.task.source.nativeId, "14");
  assert.equal(snapshot.task.source.url, issue.html_url);
  assert.equal(snapshot.task.dispatchable, true);
  assert.equal(snapshot.versionToken, '"issue-v2"');
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
    assert.equal((await gated.getTask("14")).task.dispatchable, false);
  }
});

test("GitHub adapter lists every Issue page and excludes Pull Requests", async () => {
  const pullRequest = {
    ...issue,
    id: 2_345_680,
    number: 15,
    html_url: "https://github.com/icho648/symphoneer/pull/15",
    pull_request: { url: "https://api.github.com/repos/icho648/symphoneer/pulls/15" },
  };
  let calls = 0;
  const adapter = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer-fixtures",
    token: "secret-token",
    fetch: (async (input) => {
      calls += 1;
      assert.match(String(input), /issues\?state=all&per_page=100&page=/);
      return calls === 1
        ? response([issue, pullRequest], 200, {
            etag: '"page-1"',
            link: '<https://api.github.com/repos/icho648/symphoneer-fixtures/issues?page=2>; rel="next"',
          })
        : response([], 200, { etag: '"page-2"' });
    }) as typeof fetch,
  });

  const first = await adapter.listTasks();
  assert.equal(first.tasks.length, 1);
  assert.equal(first.tasks[0]?.task.identifier, "#14");
  assert.equal(first.nextCursor, "2");
  const second = await adapter.listTasks({ cursor: first.nextCursor ?? undefined });
  assert.equal(second.tasks.length, 0);
  assert.equal(second.nextCursor, null);
});

test("GitHub adapter enables dispatch by adding the ready label and re-reading the Issue", async () => {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const adapter = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "secret-token",
    fetch: (async (input, init) => {
      requests.push({
        method: init?.method ?? "GET",
        url: String(input),
        ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}),
      });
      return requests.length === 1
        ? response([{ name: "symphoneer:ready" }])
        : response(issue, 200, { etag: '"issue-ready"' });
    }) as typeof fetch,
  });

  const snapshot = await adapter.enableTaskDispatch("14");

  assert.equal(snapshot.task.dispatchable, true);
  assert.deepEqual(requests, [
    {
      method: "POST",
      url: "https://api.github.com/repos/icho648/symphoneer/issues/14/labels",
      body: { labels: ["symphoneer:ready"] },
    },
    {
      method: "GET",
      url: "https://api.github.com/repos/icho648/symphoneer/issues/14",
    },
  ]);
});

test("GitHub adapter makes conflicts and boundary failures explicit without response bodies", async () => {
  const changed = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "token",
    fetch: (async () => response(issue)) as typeof fetch,
  });
  await assert.rejects(
    changed.getTask("14", { expectedUpdatedAt: "2026-08-02T12:00:00Z" }),
    (error) => error instanceof GitHubAdapterError && error.code === "tracker_conflict",
  );

  const denied = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "token",
    fetch: (async () => response({ secret: "must-not-leak" }, 403)) as typeof fetch,
  });
  await assert.rejects(
    denied.getTask("14"),
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
      rateLimited.getTask("14"),
      (error) =>
        error instanceof GitHubAdapterError && error.code === "rate_limited" && error.retryable,
    );
  }

  const secondaryRateLimited = new GitHubIssuesAdapter({
    repository: "icho648/symphoneer",
    token: "token",
    fetch: (async () =>
      response({ message: "You have exceeded a secondary rate limit." }, 403)) as typeof fetch,
  });
  await assert.rejects(
    secondaryRateLimited.getTask("14"),
    (error) =>
      error instanceof GitHubAdapterError && error.code === "rate_limited" && error.retryable,
  );

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
      invalid.getTask("14"),
      (error) => error instanceof GitHubAdapterError && error.code === "invalid_response",
    );
  }
});

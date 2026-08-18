import { CONTRACT_SCHEMA_VERSION, TaskSummarySchema } from "@symphoneer/contracts";

import { type TaskSnapshot, type Tracker, TrackerError } from "./tracker.ts";

export class GitHubAdapterError extends TrackerError {
  constructor(code: TrackerError["code"], retryable: boolean, message: string) {
    super(code, retryable, message);
    this.name = "GitHubAdapterError";
  }
}

/** @deprecated Prefer TaskSnapshot; kept as a GitHub-facing alias. */
export type GitHubIssueSnapshot = TaskSnapshot;

interface GitHubIssuePayload {
  id: number;
  number: number;
  html_url: string;
  title: string;
  body?: string | null;
  state: string;
  labels: Array<string | { name?: string | null }>;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

function parseIssuePayload(value: unknown): GitHubIssuePayload {
  if (!isRecord(value)) throw invalidResponse();
  const labels = value.labels;
  if (
    !Number.isInteger(value.id) ||
    !Number.isInteger(value.number) ||
    typeof value.html_url !== "string" ||
    typeof value.title !== "string" ||
    (value.body !== undefined && value.body !== null && typeof value.body !== "string") ||
    typeof value.state !== "string" ||
    !Array.isArray(labels) ||
    typeof value.created_at !== "string" ||
    typeof value.updated_at !== "string"
  ) {
    throw invalidResponse();
  }
  return value as unknown as GitHubIssuePayload;
}

const invalidResponse = () =>
  new GitHubAdapterError("invalid_response", false, "GitHub returned an invalid Issue payload");

function toTaskSnapshot(
  repository: string,
  payload: GitHubIssuePayload,
  versionToken: string | null,
): TaskSnapshot {
  const labels = payload.labels.map((label) => {
    if (typeof label === "string") return label;
    if (!isRecord(label) || typeof label.name !== "string") throw invalidResponse();
    return label.name;
  });
  if (labels.some((label) => !label.trim())) throw invalidResponse();
  const normalizedLabels = labels.map((label) => label.trim().toLowerCase());
  const dispatchable =
    payload.state.toLowerCase() === "open" &&
    normalizedLabels.includes("symphoneer:ready") &&
    !normalizedLabels.includes("symphoneer:review");
  try {
    return {
      task: TaskSummarySchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        id: `github:${repository}:${payload.id}`,
        identifier: `#${payload.number}`,
        source: {
          kind: "github",
          nativeId: String(payload.number),
          url: payload.html_url,
        },
        title: payload.title,
        ...(payload.body === undefined ? {} : { body: payload.body }),
        state: payload.state,
        labels,
        dispatchable,
        createdAt: payload.created_at,
        updatedAt: payload.updated_at,
      }),
      versionToken,
    };
  } catch {
    throw invalidResponse();
  }
}

export class GitHubIssuesAdapter implements Tracker {
  readonly kind = "github";
  readonly #repository: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: { repository: string; token: string; fetch?: typeof fetch }) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repository)) {
      throw new GitHubAdapterError(
        "invalid_response",
        false,
        "GitHub repository must be owner/name",
      );
    }
    if (!options.token.trim()) {
      throw new GitHubAdapterError("not_authorized", false, "GitHub token is required");
    }
    this.#repository = options.repository;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  async getTask(
    nativeId: string,
    options: { expectedUpdatedAt?: string; signal?: AbortSignal } = {},
  ): Promise<TaskSnapshot> {
    // GitHub's mutable Issue route is keyed by the repository-local number.
    if (!/^[1-9]\d*$/.test(nativeId)) throw invalidResponse();
    return this.#readIssue(Number(nativeId), options);
  }

  /** @deprecated Prefer getTask(String(issueNumber)). */
  async getIssue(
    issueNumber: number,
    options: { expectedUpdatedAt?: string; signal?: AbortSignal } = {},
  ): Promise<TaskSnapshot> {
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw invalidResponse();
    return this.#readIssue(issueNumber, options);
  }

  async listTasks(
    options: { cursor?: string; signal?: AbortSignal } = {},
  ): Promise<{ tasks: TaskSnapshot[]; nextCursor: string | null }> {
    const page = options.cursor === undefined ? 1 : Number(options.cursor);
    if (!Number.isInteger(page) || page < 1) throw invalidResponse();
    let response: Response;
    try {
      response = await this.#fetch(
        `https://api.github.com/repos/${this.#repository}/issues?state=all&per_page=100&page=${page}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.#token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
    } catch {
      throw new GitHubAdapterError("network_error", true, "GitHub Issue list failed");
    }
    if (!response.ok) throw await this.#httpError(response);
    let payloads: unknown;
    try {
      payloads = await response.json();
    } catch {
      throw invalidResponse();
    }
    if (!Array.isArray(payloads)) throw invalidResponse();
    const versionToken = response.headers.get("etag");
    const tasks = payloads
      .map((value) => parseIssuePayload(value))
      .filter((payload) => payload.pull_request === undefined)
      .map((payload) => toTaskSnapshot(this.#repository, payload, versionToken));
    const nextCursor = /<[^>]+>;\s*rel="next"/i.test(response.headers.get("link") ?? "")
      ? String(page + 1)
      : null;
    return { tasks, nextCursor };
  }

  async enableTaskDispatch(
    nativeId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<TaskSnapshot> {
    if (!/^[1-9]\d*$/.test(nativeId)) throw invalidResponse();
    const issueNumber = Number(nativeId);
    let response: Response;
    try {
      response = await this.#fetch(
        `https://api.github.com/repos/${this.#repository}/issues/${issueNumber}/labels`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.#token}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({ labels: ["symphoneer:ready"] }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
    } catch {
      throw new GitHubAdapterError("network_error", true, "GitHub Issue label update failed");
    }
    if (!response.ok) throw await this.#httpError(response);
    return this.#readIssue(issueNumber, options);
  }

  async findReviewUrl(
    nativeId: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<string | null> {
    if (!/^[1-9]\d*$/.test(nativeId)) throw invalidResponse();
    const issueNumber = Number(nativeId);
    const snapshot = await this.#readIssue(issueNumber, options);
    const fromBody = linkedPullRequestUrl(snapshot.task.body, this.#repository);
    if (fromBody) return fromBody;

    const comments = await this.#getJson(
      `https://api.github.com/repos/${this.#repository}/issues/${issueNumber}/comments?per_page=100`,
      options.signal,
    );
    if (Array.isArray(comments)) {
      for (const comment of comments) {
        const body = isRecord(comment) && typeof comment.body === "string" ? comment.body : null;
        const fromComment = linkedPullRequestUrl(body, this.#repository);
        if (fromComment) return fromComment;
      }
    }

    const fromTimeline = pullUrlFromTimeline(
      await this.#getJson(
        `https://api.github.com/repos/${this.#repository}/issues/${issueNumber}/timeline?per_page=100`,
        options.signal,
      ),
      this.#repository,
    );
    if (fromTimeline) return fromTimeline;

    const owner = this.#repository.split("/")[0];
    const pulls = await this.#getJson(
      `https://api.github.com/repos/${this.#repository}/pulls?state=all&head=${owner}:symphoneer/issue-${issueNumber}&per_page=5`,
      options.signal,
    );
    if (Array.isArray(pulls) && isRecord(pulls[0]) && typeof pulls[0].html_url === "string") {
      return linkedPullRequestUrl(pulls[0].html_url, this.#repository);
    }
    return null;
  }

  async #readIssue(
    issueNumber: number,
    options: { expectedUpdatedAt?: string; signal?: AbortSignal },
  ): Promise<TaskSnapshot> {
    let response: Response;
    try {
      response = await this.#fetch(
        `https://api.github.com/repos/${this.#repository}/issues/${issueNumber}`,
        {
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${this.#token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        },
      );
    } catch {
      throw new GitHubAdapterError("network_error", true, "GitHub Issue read failed");
    }
    if (!response.ok) throw await this.#httpError(response);

    let payload: GitHubIssuePayload;
    try {
      payload = parseIssuePayload(await response.json());
    } catch (error) {
      if (error instanceof GitHubAdapterError) throw error;
      throw invalidResponse();
    }
    if (payload.pull_request !== undefined || payload.number !== issueNumber) {
      throw invalidResponse();
    }
    if (options.expectedUpdatedAt && options.expectedUpdatedAt !== payload.updated_at) {
      throw new GitHubAdapterError(
        "tracker_conflict",
        true,
        "GitHub Issue changed after the caller's observed version",
      );
    }

    return toTaskSnapshot(this.#repository, payload, response.headers.get("etag"));
  }

  async #getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    let response: Response;
    try {
      response = await this.#fetch(url, {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${this.#token}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(signal === undefined ? {} : { signal }),
      });
    } catch {
      throw new GitHubAdapterError("network_error", true, "GitHub Issue read failed");
    }
    if (!response.ok) throw await this.#httpError(response);
    try {
      return await response.json();
    } catch {
      throw invalidResponse();
    }
  }

  async #httpError(response: Response): Promise<GitHubAdapterError> {
    if (response.status === 404) {
      return new GitHubAdapterError("not_found", false, "GitHub Issue was not found");
    }
    const secondaryRateLimit =
      response.status === 403 &&
      /secondary rate limit/i.test(
        await response
          .clone()
          .text()
          .catch(() => ""),
      );
    if (
      response.status === 429 ||
      (response.status === 403 &&
        (response.headers.get("x-ratelimit-remaining") === "0" ||
          response.headers.has("retry-after"))) ||
      secondaryRateLimit
    ) {
      return new GitHubAdapterError("rate_limited", true, "GitHub API rate limit was exhausted");
    }
    if (response.status === 401 || response.status === 403) {
      return new GitHubAdapterError(
        "not_authorized",
        false,
        "GitHub Issue read was not authorized",
      );
    }
    return new GitHubAdapterError(
      "unavailable",
      response.status >= 500,
      `GitHub Issue read failed with status ${response.status}`,
    );
  }
}

function linkedPullRequestUrl(text: string | null | undefined, repository: string): string | null {
  if (!text) return null;
  const matches = text.matchAll(/https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/gi);
  for (const match of matches) {
    if (`${match[1]}/${match[2]}`.toLowerCase() === repository.toLowerCase()) {
      return `https://github.com/${match[1]}/${match[2]}/pull/${match[3]}`;
    }
  }
  return null;
}

function pullUrlFromTimeline(events: unknown, repository: string): string | null {
  if (!Array.isArray(events)) return null;
  let found: string | null = null;
  for (const event of events) {
    if (!isRecord(event) || event.event !== "cross-referenced") continue;
    const source = isRecord(event.source) ? event.source : null;
    const issue = source && isRecord(source.issue) ? source.issue : null;
    if (!issue?.pull_request || typeof issue.html_url !== "string") continue;
    const url = linkedPullRequestUrl(issue.html_url, repository);
    if (url) found = url;
  }
  return found;
}

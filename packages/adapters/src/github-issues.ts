import {
  CONTRACT_SCHEMA_VERSION,
  type TaskSummary,
  TaskSummarySchema,
} from "@symphoneer/contracts";

export class GitHubAdapterError extends Error {
  readonly code:
    | "invalid_response"
    | "network_error"
    | "not_authorized"
    | "not_found"
    | "rate_limited"
    | "tracker_conflict"
    | "unavailable";
  readonly retryable: boolean;

  constructor(code: GitHubAdapterError["code"], retryable: boolean, message: string) {
    super(message);
    this.name = "GitHubAdapterError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface GitHubIssueSnapshot {
  task: TaskSummary;
  etag: string | null;
}

interface GitHubIssuePayload {
  id: number;
  number: number;
  html_url: string;
  title: string;
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

export class GitHubIssuesAdapter {
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

  async getIssue(
    issueNumber: number,
    options: { expectedUpdatedAt?: string; signal?: AbortSignal } = {},
  ): Promise<GitHubIssueSnapshot> {
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw invalidResponse();
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
    let task: TaskSummary;
    try {
      task = TaskSummarySchema.parse({
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        id: `github:${this.#repository}:${payload.id}`,
        identifier: `#${payload.number}`,
        source: {
          kind: "github",
          nativeId: String(payload.id),
          url: payload.html_url,
        },
        title: payload.title,
        state: payload.state,
        labels,
        dispatchable,
        createdAt: payload.created_at,
        updatedAt: payload.updated_at,
      });
    } catch {
      throw invalidResponse();
    }
    return { task, etag: response.headers.get("etag") };
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

import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import {
  CONTRACT_SCHEMA_VERSION,
  type VerificationResult,
  VerificationResultSchema,
} from "@symphoneer/contracts";
import { readWorktreeFingerprint } from "../workspace/fingerprint/index.ts";
import { assertArtifactAbsent, publishArtifact, resolveArtifactRoot } from "./artifacts.ts";
import { VerificationError } from "./errors.ts";
import { readGitHead } from "./git.ts";
import { execute } from "./process.ts";

export { VerificationError } from "./errors.ts";

export interface VerificationRunInput {
  attemptId: string;
  checkId: string;
  argv: string[];
  cwd: string;
  workspacePath: string;
  timeoutMs: number;
}

export interface VerificationRunOutput {
  result: VerificationResult;
  artifactPath: string;
}

export class VerificationRunner {
  readonly #artifactRoot: string;
  readonly #toolVersion: string;
  readonly #now: () => Date;

  constructor(options: { artifactRoot: string; toolVersion?: string; now?: () => Date }) {
    this.#artifactRoot = resolve(options.artifactRoot);
    this.#toolVersion = options.toolVersion ?? `0.0.0+${process.version}`;
    this.#now = options.now ?? (() => new Date());
  }

  async run(input: VerificationRunInput): Promise<VerificationRunOutput> {
    if (input.argv.length === 0 || input.argv.some((argument) => argument.length === 0)) {
      throw new VerificationError("process_failed", "Verification argv must not be empty");
    }
    if (!Number.isInteger(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new VerificationError("process_failed", "Verification timeout must be positive");
    }
    const workspace = await realpath(input.workspacePath);
    const requestedCwd = resolve(workspace, input.cwd);
    const cwd = await realpath(requestedCwd);
    const child = relative(workspace, cwd);
    if (child.startsWith("..") || isAbsolute(child)) {
      throw new VerificationError("invalid_workspace", "Verification cwd escapes its Workspace");
    }
    const gitHead = await readGitHead(workspace);
    const worktreeFingerprint = await readWorktreeFingerprint(workspace);
    const inputFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          attemptId: input.attemptId,
          checkId: input.checkId,
          argv: input.argv,
          cwd: child || ".",
          gitHead,
          worktreeFingerprint,
          toolVersion: this.#toolVersion,
        }),
      )
      .digest("hex");
    const artifactName = `${createHash("sha256")
      .update(`${input.attemptId}\0${input.checkId}\0${inputFingerprint}`)
      .digest("hex")}.json`;
    const artifactRef = `artifacts/${artifactName}`;
    const artifactPath = resolve(
      await resolveArtifactRoot(this.#artifactRoot, workspace),
      artifactName,
    );
    await assertArtifactAbsent(artifactPath);
    const startedAt = this.#now().toISOString();
    const execution = await execute(input.argv, cwd, input.timeoutMs);
    const finishedAt = this.#now().toISOString();
    let gitHeadAfter: string | null = null;
    let worktreeFingerprintAfter: string | null = null;
    let observationError: "git_observation_failed" | null = null;
    try {
      gitHeadAfter = await readGitHead(workspace);
      worktreeFingerprintAfter = await readWorktreeFingerprint(workspace);
    } catch {
      observationError = "git_observation_failed";
    }
    const revisionMatched =
      observationError === null &&
      gitHeadAfter === gitHead &&
      worktreeFingerprintAfter === worktreeFingerprint;
    const status = execution.timedOut
      ? "timed_out"
      : execution.exitCode === 0 && revisionMatched
        ? "passed"
        : "failed";
    const result = VerificationResultSchema.parse({
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      id: verificationId(input.attemptId, input.checkId),
      attemptId: input.attemptId,
      checkId: input.checkId,
      status,
      argv: [basename(input.argv[0] as string), ...input.argv.slice(1).map(() => "<redacted>")],
      cwd: child || ".",
      gitHead,
      worktreeFingerprint,
      tool: { name: "symphoneer-verification", version: this.#toolVersion },
      inputFingerprint,
      startedAt,
      finishedAt,
      exitCode: execution.exitCode,
      artifactRef,
    });
    await publishArtifact(
      artifactPath,
      `${JSON.stringify(
        {
          ...result,
          gitHeadAfter,
          worktreeFingerprintAfter,
          revisionMatched,
          observationError,
          startFailed: execution.startFailed,
          output: {
            stdoutBytes: execution.stdoutBytes,
            stdoutSha256: execution.stdoutSha256,
            stderrBytes: execution.stderrBytes,
            stderrSha256: execution.stderrSha256,
          },
        },
        null,
        2,
      )}\n`,
    );
    return { result, artifactPath };
  }
}

function verificationId(attemptId: string, checkId: string): string {
  return `verification:${encodeURIComponent(attemptId)}:${encodeURIComponent(checkId)}`;
}

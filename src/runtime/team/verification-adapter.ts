import { readFile } from "node:fs/promises";

import { type TeamVerificationOutcome, TeamVerificationOutcomeSchema } from "@symphoneer/contracts";
import { type VerificationRunInput, VerificationRunner } from "../verification/index.ts";
import type { TeamVerificationAdapter, TeamVerificationRequest } from "./fake-verification.ts";

export class VerificationRunnerAdapter implements TeamVerificationAdapter {
  readonly #runner: VerificationRunner;
  readonly #check: Pick<VerificationRunInput, "checkId" | "argv" | "cwd" | "timeoutMs">;

  constructor(options: {
    artifactRoot: string;
    checkId?: string;
    argv?: string[];
    cwd?: string;
    timeoutMs?: number;
    toolVersion?: string;
  }) {
    this.#runner = new VerificationRunner({
      artifactRoot: options.artifactRoot,
      ...(options.toolVersion ? { toolVersion: options.toolVersion } : {}),
    });
    this.#check = {
      checkId: options.checkId ?? "workflow-check",
      argv: options.argv ?? ["pnpm", "check"],
      cwd: options.cwd ?? ".",
      timeoutMs: options.timeoutMs ?? 300_000,
    };
  }

  async run(request: TeamVerificationRequest): Promise<TeamVerificationOutcome> {
    try {
      const output = await this.#runner.run({
        ...this.#check,
        attemptId: request.attemptId,
        workspacePath: request.workspace.path,
      });
      const artifact = await readFile(output.artifactPath, "utf8");
      return TeamVerificationOutcomeSchema.parse({
        status: output.result.status === "passed" ? "passed" : "failed",
        checkId: output.result.checkId,
        argv: output.result.argv,
        cwd: output.result.cwd,
        gitHead: output.result.gitHead,
        worktreeFingerprint: output.result.worktreeFingerprint,
        tool: output.result.tool,
        inputFingerprint: output.result.inputFingerprint,
        startedAt: output.result.startedAt,
        finishedAt: output.result.finishedAt,
        exitCode: output.result.exitCode ?? 1,
        artifact,
      });
    } catch {
      return TeamVerificationOutcomeSchema.parse({
        status: "failed",
        checkId: this.#check.checkId,
        argv: this.#check.argv,
        cwd: this.#check.cwd,
        gitHead: "0".repeat(40),
        worktreeFingerprint: "0".repeat(64),
        tool: { name: "symphoneer-verification", version: "unavailable" },
        inputFingerprint: "0".repeat(64),
        startedAt: request.now,
        finishedAt: request.now,
        exitCode: 1,
        artifact: JSON.stringify({ status: "failed", reason: "verification_unavailable" }),
      });
    }
  }
}

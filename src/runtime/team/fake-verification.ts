import {
  type FakeTeamScenario,
  type TeamVerificationOutcome,
  TeamVerificationOutcomeSchema,
  type WorkspaceReference,
} from "@symphoneer/contracts";

export interface TeamVerificationRequest {
  teamRunId: string;
  attemptId: string;
  workspace: WorkspaceReference;
  now: string;
  scenario: FakeTeamScenario;
}

export interface TeamVerificationAdapter {
  run(request: TeamVerificationRequest): TeamVerificationOutcome | Promise<TeamVerificationOutcome>;
}

export class FakeVerificationAdapter implements TeamVerificationAdapter {
  async run(request: TeamVerificationRequest): Promise<TeamVerificationOutcome> {
    const status = request.scenario.verification;
    return TeamVerificationOutcomeSchema.parse({
      status,
      checkId: `fake-team:${request.teamRunId}`,
      argv: ["fake-verification", "--team-run", request.teamRunId],
      cwd: "fake",
      gitHead: "0".repeat(40),
      worktreeFingerprint: "0".repeat(64),
      tool: { name: "fake-verification", version: "1" },
      inputFingerprint: "1".repeat(64),
      startedAt: request.now,
      finishedAt: request.now,
      exitCode: status === "passed" ? 0 : 1,
      artifact: JSON.stringify({ provider: "fake", teamRunId: request.teamRunId, status }),
    });
  }
}

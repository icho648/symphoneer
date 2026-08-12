import type {
  AttemptSnapshot,
  CodexModel,
  CodexReasoningEffort,
  CodexSandbox,
  ExecutionSession,
  ReviewDecision,
  RuntimeCommand,
  TaskSummary,
} from "@symphoneer/contracts";
import type { InterventionResponse } from "../executor/agent-runner.ts";
import type { EventLog } from "../service/event-log.ts";

export interface OrchestrationMode {
  tick?(input: { tasks: readonly TaskSummary[]; log: EventLog }): Promise<void>;
  listModels?(): Promise<CodexModel[]>;
  start(input: {
    task: TaskSummary;
    command: Extract<RuntimeCommand, { kind: "start_run" }>;
    log: EventLog;
  }): Promise<void>;
  respond?(input: {
    interventionId: string;
    requestRef: string;
    decision: InterventionResponse;
  }): Promise<void>;
  review?(input: { review: ReviewDecision; log: EventLog }): Promise<void>;
  pause?(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void>;
  retry?(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void>;
  input?(input: {
    attempt: AttemptSnapshot;
    prompt: string;
    model?: string;
    sandbox?: CodexSandbox;
    effort?: CodexReasoningEffort;
    log: EventLog;
  }): Promise<void>;
  handoff?(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void>;
  returnControl?(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void>;
  sync?(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<ExecutionSession | null>;
  delete?(input: { attempt: AttemptSnapshot; log: EventLog }): Promise<void>;
}

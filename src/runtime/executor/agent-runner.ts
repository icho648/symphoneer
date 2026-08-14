import type {
  ActivityOccurrence,
  ExecutionSession,
  ExecutorModel,
  ExecutorReasoningEffort,
  ExecutorSandbox,
  TaskSummary,
  WorkspaceReference,
} from "@symphoneer/contracts";

export interface AgentWorkerRequest {
  attemptId: string;
  task: TaskSummary;
  workspace: WorkspaceReference;
  model?: string;
  sandbox?: ExecutorSandbox;
  effort?: ExecutorReasoningEffort;
  sessionId?: string;
}

export interface AgentTurnRequest {
  prompt: string;
  threadId?: string;
}

/** @deprecated Use AgentWorkerRequest plus AgentTurnRequest. */
export interface AgentRunRequest extends AgentWorkerRequest, AgentTurnRequest {
  continuation: boolean;
}

export type InterventionDetails =
  | {
      action: "command";
      command: string;
      cwd: string | null;
      reason: string | null;
    }
  | {
      action: "file_change";
      reason: string | null;
      scope: "workspace" | "additional_root";
    };

export interface InterventionQuestion {
  id: string;
  prompt: string;
  options: Array<{ label: string; description: string | null }>;
}

export type AgentRunEvent =
  | {
      type: "session_started";
      occurredAt: string;
      threadId: string;
      turnId: string;
      provider: {
        name: "codex-app-server" | "claude-code" | "fake";
        version: string;
        schema: string;
        inputFingerprint: string;
        model?: string;
        permissionMode?: string;
      };
    }
  | {
      type: "intervention_requested";
      occurredAt: string;
      requestRef: string;
      kind: "approval" | "input";
      prompt: string;
      details?: InterventionDetails;
      questionIds?: string[];
      questions?: InterventionQuestion[];
    }
  | {
      type: "notification";
      occurredAt: string;
      message: string;
    }
  | ({ type: "activity" } & ActivityOccurrence);

export interface InterventionResponse {
  decision: "approved" | "rejected" | "answered" | "canceled";
  response?: string;
  responses?: Record<string, string[]>;
}

export interface AgentRunCompletion {
  outcome: "completed" | "failed" | "interrupted";
  error?: string;
}

export interface RunHandle {
  events: AsyncIterable<AgentRunEvent>;
  interrupt(): Promise<void>;
  steer(prompt: string): Promise<void>;
  respondToIntervention(requestRef: string, decision: InterventionResponse): Promise<void>;
  completion: Promise<AgentRunCompletion>;
}

export interface AttemptWorker {
  readonly processIdentity: { pid: number | null; toolVersion: string };
  startTurn(request: AgentTurnRequest): Promise<RunHandle>;
  readSession(threadId: string, capturedAt: string): Promise<ExecutionSession | null>;
  close(): Promise<void>;
}

export interface AgentRunner {
  openWorker(request: AgentWorkerRequest): Promise<AttemptWorker>;
  listModels?(): Promise<ExecutorModel[]>;
  readSession?(
    threadId: string,
    attemptId: string,
    capturedAt: string,
  ): Promise<ExecutionSession | null>;
}

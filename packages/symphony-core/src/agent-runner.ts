import type { TaskSummary, WorkspaceReference } from "@symphoneer/contracts";

export interface AgentRunRequest {
  attemptId: string;
  task: TaskSummary;
  workspace: WorkspaceReference;
  prompt: string;
  continuation: boolean;
  threadId?: string;
}

export type AgentRunEvent =
  | {
      type: "session_started";
      occurredAt: string;
      threadId: string;
      turnId: string;
      provider: {
        name: "codex-app-server" | "fake";
        version: string;
        schema: string;
        inputFingerprint: string;
      };
    }
  | {
      type: "intervention_requested";
      occurredAt: string;
      requestRef: string;
      kind: "approval" | "input";
      prompt: string;
    }
  | {
      type: "notification";
      occurredAt: string;
      message: string;
    };

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
  respondToIntervention(requestRef: string, decision: InterventionResponse): Promise<void>;
  completion: Promise<AgentRunCompletion>;
}

export interface AgentRunner {
  startOrContinue(request: AgentRunRequest): Promise<RunHandle>;
}

import type {
  CodexModel,
  RuntimeAttemptDetail,
  RuntimeCommandResult,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeSnapshot,
} from "@symphoneer/contracts";

/** Public Runtime surface consumed by HTTP, independent of single- or multi-project hosting. */
export interface RuntimeControlPlane {
  start(): Promise<void>;
  stop(): Promise<void>;
  setEndpoint(endpoint: string): void;
  health(): RuntimeHealth;
  listModels(projectId?: string): Promise<CodexModel[]>;
  snapshot(): RuntimeSnapshot;
  events(afterSequence?: number): RuntimeEvent[];
  attemptDetail(attemptId: string): Promise<RuntimeAttemptDetail | null>;
  reviewTarget(taskId: string, projectId?: string): Promise<{ url: string }>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  execute(commandInput: unknown): Promise<RuntimeCommandResult>;
}

import { CONTRACT_SCHEMA_VERSION, ExecutionSessionSchema } from "@symphoneer/contracts";
import type {
  AgentRunCompletion,
  AgentRunEvent,
  AgentRunner,
  AgentRunRequest,
  AgentWorkerRequest,
  AttemptWorker,
  InterventionResponse,
  RunHandle,
} from "../../src/runtime/executor/agent-runner.ts";

export class FakeAgentRunner implements AgentRunner {
  readonly requests: AgentRunRequest[] = [];
  readonly responses: Array<{ requestRef: string; decision: InterventionResponse }> = [];
  readonly steers: string[] = [];
  interruptCount = 0;
  openWorkerCount = 0;
  closeWorkerCount = 0;
  readonly #plans: Array<{
    events: readonly AgentRunEvent[];
    completion: AgentRunCompletion;
  }>;

  constructor(plans: Array<{ events: readonly AgentRunEvent[]; completion: AgentRunCompletion }>) {
    this.#plans = [...plans];
  }

  async openWorker(context: AgentWorkerRequest): Promise<AttemptWorker> {
    this.openWorkerCount += 1;
    const runner = this;
    let closed = false;
    return {
      processIdentity: { pid: null, toolVersion: "fake" },
      startTurn(request) {
        if (closed) throw new Error("Fake Attempt Worker is closed");
        return runner.startOrContinue({
          ...context,
          ...request,
          continuation: request.threadId !== undefined,
        });
      },
      async readSession(threadId, capturedAt) {
        return ExecutionSessionSchema.parse({
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          attemptId: context.attemptId,
          provider: "fake",
          threadId,
          turns: [],
          capturedAt,
        });
      },
      async close() {
        if (closed) return;
        closed = true;
        runner.closeWorkerCount += 1;
      },
    };
  }

  async startOrContinue(request: AgentRunRequest): Promise<RunHandle> {
    const plan = this.#plans.shift();
    if (!plan) throw new Error("FakeAgentRunner has no remaining plan");
    this.requests.push(structuredClone(request));
    const runner = this;

    return {
      events: {
        async *[Symbol.asyncIterator]() {
          for (const event of plan.events) yield structuredClone(event);
        },
      },
      completion: Promise.resolve(structuredClone(plan.completion)),
      async interrupt() {
        runner.interruptCount += 1;
      },
      async steer(prompt) {
        runner.steers.push(prompt);
      },
      async respondToIntervention(requestRef, decision) {
        runner.responses.push({ requestRef, decision: structuredClone(decision) });
      },
    };
  }
}

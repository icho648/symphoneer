import type {
  AgentRunCompletion,
  AgentRunEvent,
  AgentRunner,
  AgentRunRequest,
  InterventionResponse,
  RunHandle,
} from "../../packages/symphony-core/src/agent-runner.ts";

export class FakeAgentRunner implements AgentRunner {
  readonly requests: AgentRunRequest[] = [];
  readonly responses: Array<{ requestRef: string; decision: InterventionResponse }> = [];
  interruptCount = 0;
  readonly #plans: Array<{
    events: readonly AgentRunEvent[];
    completion: AgentRunCompletion;
  }>;

  constructor(plans: Array<{ events: readonly AgentRunEvent[]; completion: AgentRunCompletion }>) {
    this.#plans = [...plans];
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
      async respondToIntervention(requestRef, decision) {
        runner.responses.push({ requestRef, decision: structuredClone(decision) });
      },
    };
  }
}

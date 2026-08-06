import { Annotation, END, interrupt, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type {
  AgentRunSnapshot,
  FakeTeamScenario,
  TaskSummary,
  TeamHumanInput,
  TeamProcessEvent,
  TeamProvider,
  TeamRunStatus,
  TeamVerificationOutcome,
  WorkspaceReference,
} from "@symphoneer/contracts";
import type { TeamAgentRunner } from "./fake-agent-runner.ts";
import type { TeamVerificationAdapter } from "./fake-verification.ts";

export const TeamStateAnnotation = Annotation.Root({
  teamRunId: Annotation<string>(),
  attemptId: Annotation<string>(),
  task: Annotation<TaskSummary>(),
  workspace: Annotation<WorkspaceReference>(),
  prompt: Annotation<string>(),
  createdAt: Annotation<string>(),
  provider: Annotation<TeamProvider>(),
  status: Annotation<TeamRunStatus>(),
  currentNode: Annotation<string>(),
  reviewRound: Annotation<number>(),
  revision: Annotation<number>(),
  planDecision: Annotation<"approve" | "reject" | "revise" | null>(),
  reviewDecision: Annotation<"approve" | "request_changes" | "uncertain" | null>(),
  verificationStatus: Annotation<"passed" | "failed" | null>(),
  verification: Annotation<TeamVerificationOutcome | null>(),
  finalDecision: Annotation<"accept" | "stop" | null>(),
  pendingHumanInput: Annotation<TeamHumanInput | null>(),
  scenario: Annotation<FakeTeamScenario>(),
  agentRuns: Annotation<AgentRunSnapshot[]>(),
  processEvents: Annotation<TeamProcessEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  nextRoute: Annotation<"implement" | "verify" | "stop" | null>(),
});

export type TeamGraphState = typeof TeamStateAnnotation.State;
export const WorkflowStateAnnotation = TeamStateAnnotation;
export type WorkflowGraphState = TeamGraphState;

const PLAN_INPUT: TeamHumanInput = {
  kind: "plan_approval",
  prompt: "Approve the Planner's plan?",
  options: ["approve", "revise", "reject"],
};

const REVIEW_INPUT: TeamHumanInput = {
  kind: "review_input",
  prompt: "The Reviewer needs a human decision before the workflow can continue.",
  options: ["approve", "request_changes", "stop"],
};

const FINAL_INPUT: TeamHumanInput = {
  kind: "final_decision",
  prompt: "Review the independent Verification result and choose the final decision.",
  options: ["accept", "stop"],
};

export function buildTeamGraph(options: {
  checkpointer?: BaseCheckpointSaver;
  agentRunner: TeamAgentRunner;
  verification: TeamVerificationAdapter;
  now: () => string;
}) {
  const plan = async (state: TeamGraphState) => {
    const result = await options.agentRunner.run({
      teamRunId: state.teamRunId,
      attemptId: state.attemptId,
      task: state.task,
      workspace: state.workspace,
      prompt: state.prompt,
      continuation: false,
      role: "planner",
      reviewRound: 0,
      eventIndex: state.processEvents.length,
      now: options.now(),
      scenario: state.scenario,
    });
    return {
      revision: state.revision + 1,
      status: "awaiting_plan_approval" as const,
      currentNode: "approve_plan",
      pendingHumanInput: PLAN_INPUT,
      agentRuns: upsertAgent(state.agentRuns, result.agentRun),
      processEvents: result.events,
    };
  };

  const approvePlan = (state: TeamGraphState) => {
    const decision = interrupt<TeamHumanInput, "approve" | "reject" | "revise" | "stop">(
      PLAN_INPUT,
    );
    if (decision === "reject" || decision === "stop") {
      return {
        revision: state.revision + 1,
        planDecision: "reject" as const,
        pendingHumanInput: null,
        nextRoute: "stop" as const,
        currentNode: "stop",
        status: "stopped" as const,
      };
    }
    return {
      revision: state.revision + 1,
      planDecision: decision,
      pendingHumanInput: null,
      nextRoute: "implement" as const,
      currentNode: decision === "revise" ? "plan" : "implement",
      status: decision === "revise" ? ("planning" as const) : ("implementing" as const),
    };
  };

  const implement = async (state: TeamGraphState) => {
    const threadId = state.agentRuns.find(
      (agent) => agent.role === "implementer" && agent.reviewRound === state.reviewRound - 1,
    )?.providerSession?.threadId;
    const result = await options.agentRunner.run({
      teamRunId: state.teamRunId,
      attemptId: state.attemptId,
      task: state.task,
      workspace: state.workspace,
      prompt: state.prompt,
      continuation: state.reviewRound > 0,
      ...(threadId ? { threadId } : {}),
      role: "implementer",
      reviewRound: state.reviewRound,
      eventIndex: state.processEvents.length,
      now: options.now(),
      scenario: state.scenario,
    });
    return {
      revision: state.revision + 1,
      status: "reviewing" as const,
      currentNode: "review",
      agentRuns: upsertAgent(state.agentRuns, result.agentRun),
      processEvents: result.events,
    };
  };

  const review = async (state: TeamGraphState) => {
    const result = await options.agentRunner.run({
      teamRunId: state.teamRunId,
      attemptId: state.attemptId,
      task: state.task,
      workspace: state.workspace,
      prompt: state.prompt,
      continuation: false,
      role: "reviewer",
      reviewRound: state.reviewRound,
      eventIndex: state.processEvents.length,
      now: options.now(),
      scenario: state.scenario,
    });
    return {
      revision: state.revision + 1,
      status:
        result.reviewDecision === "uncertain" ||
        (result.reviewDecision === "request_changes" && state.reviewRound >= 2)
          ? ("awaiting_human_input" as const)
          : ("reviewing" as const),
      currentNode: "route_review",
      pendingHumanInput:
        result.reviewDecision === "uncertain" ||
        (result.reviewDecision === "request_changes" && state.reviewRound >= 2)
          ? REVIEW_INPUT
          : null,
      reviewDecision: result.reviewDecision ?? null,
      agentRuns: upsertAgent(state.agentRuns, result.agentRun),
      processEvents: result.events,
    };
  };

  const routeReview = (state: TeamGraphState) => {
    if (state.reviewDecision === "uncertain" || state.reviewRound >= 2) {
      const decision = interrupt<TeamHumanInput, "approve" | "request_changes" | "stop">(
        REVIEW_INPUT,
      );
      return reviewRoute(decision, state.reviewRound, state.revision);
    }
    return reviewRoute(state.reviewDecision ?? "approve", state.reviewRound, state.revision);
  };

  const verify = async (state: TeamGraphState) => {
    const verification = await options.verification.run({
      teamRunId: state.teamRunId,
      attemptId: state.attemptId,
      workspace: state.workspace,
      now: options.now(),
      scenario: state.scenario,
    });
    return {
      revision: state.revision + 1,
      status: "awaiting_human_decision" as const,
      currentNode: "final_decision",
      pendingHumanInput: FINAL_INPUT,
      verificationStatus: verification.status,
      verification,
    };
  };

  const finalDecision = (state: TeamGraphState) => {
    const decision = interrupt<TeamHumanInput, "accept" | "stop">(FINAL_INPUT);
    return {
      revision: state.revision + 1,
      finalDecision: decision,
      pendingHumanInput: null,
      currentNode: "final_decision",
      status: decision === "accept" ? ("completed" as const) : ("stopped" as const),
    };
  };

  return new StateGraph(TeamStateAnnotation)
    .addNode("plan", plan)
    .addNode("approve_plan", approvePlan)
    .addNode("implement", implement)
    .addNode("review", review)
    .addNode("route_review", routeReview)
    .addNode("verify", verify)
    .addNode("final_decision", finalDecision)
    .addNode("stop", (state) => ({
      revision: state.revision + 1,
      status: "stopped" as const,
      currentNode: "stop",
    }))
    .addEdge(START, "plan")
    .addConditionalEdges("approve_plan", (state) => state.planDecision ?? "reject", {
      approve: "implement",
      revise: "plan",
      reject: "stop",
    })
    .addEdge("plan", "approve_plan")
    .addEdge("implement", "review")
    .addEdge("review", "route_review")
    .addConditionalEdges("route_review", (state) => state.nextRoute ?? "stop", {
      implement: "implement",
      verify: "verify",
      stop: "stop",
    })
    .addEdge("verify", "final_decision")
    .addEdge("final_decision", END)
    .addEdge("stop", END)
    .compile({ ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}) });
}

export const buildWorkflowGraph = buildTeamGraph;

function reviewRoute(
  decision: "approve" | "request_changes" | "stop",
  reviewRound: number,
  revision: number,
) {
  if (decision === "request_changes" && reviewRound < 2) {
    return {
      revision: revision + 1,
      reviewRound: reviewRound + 1,
      nextRoute: "implement" as const,
      currentNode: "implement",
      status: "implementing" as const,
      pendingHumanInput: null,
    };
  }
  if (decision === "stop") {
    return {
      revision: revision + 1,
      nextRoute: "stop" as const,
      currentNode: "stop",
      status: "stopped" as const,
      pendingHumanInput: null,
    };
  }
  return {
    revision: revision + 1,
    nextRoute: "verify" as const,
    currentNode: "verify",
    status: "verifying" as const,
    pendingHumanInput: null,
  };
}

function upsertAgent(agents: AgentRunSnapshot[], next: AgentRunSnapshot): AgentRunSnapshot[] {
  return [...agents.filter((agent) => agent.id !== next.id), next];
}

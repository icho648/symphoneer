import type { TeamRunSnapshot } from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

const workflowNodes = [
  "plan",
  "plan_approval",
  "implement",
  "review",
  "verify",
  "human_decision",
] as const;

type WorkflowNode = (typeof workflowNodes)[number];

export function WorkflowMap({
  dictionary,
  workflow,
  compact = false,
}: {
  dictionary: Dictionary;
  workflow: TeamRunSnapshot;
  compact?: boolean;
}) {
  const activeNode = visibleNode(workflow);
  const activeIndex = workflowNodes.indexOf(activeNode);
  const complete = workflow.status === "completed";
  const looped = workflow.reviewRound > 0 || workflow.reviewDecision === "request_changes";

  return (
    <ol className={compact ? "workflow-map workflow-map-compact" : "workflow-map"}>
      {workflowNodes.map((node, index) => {
        const current = node === activeNode;
        const finished = complete || index < activeIndex;
        return (
          <li
            className={
              "workflow-map-node " +
              (current ? "is-current " : "") +
              (finished ? "is-finished " : "") +
              (node === "implement" || node === "review" ? "is-loop-node" : "")
            }
            key={node}
          >
            <span className="workflow-map-dot" aria-hidden="true">
              {finished ? "✓" : index + 1}
            </span>
            <span className="workflow-map-label">{dictionary.workflow.nodes[node]}</span>
            {index < workflowNodes.length - 1 && (
              <span className="workflow-map-line" aria-hidden="true" />
            )}
            {node === "review" && looped && (
              <span className="workflow-map-loop" aria-hidden="true">
                ↶
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function visibleNode(workflow: TeamRunSnapshot): WorkflowNode {
  if (workflow.currentNode === "approve_plan" || workflow.status === "awaiting_plan_approval") {
    return "plan_approval";
  }
  if (workflow.currentNode === "plan" || workflow.status === "planning") return "plan";
  if (workflow.currentNode === "implement" || workflow.status === "implementing") {
    return "implement";
  }
  if (
    workflow.currentNode === "review" ||
    workflow.currentNode === "route_review" ||
    workflow.status === "reviewing" ||
    workflow.status === "awaiting_human_input"
  ) {
    return "review";
  }
  if (workflow.currentNode === "verify" || workflow.status === "verifying") return "verify";
  return "human_decision";
}

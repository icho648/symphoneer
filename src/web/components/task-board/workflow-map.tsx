import type { TeamRunSnapshot } from "@symphoneer/contracts";
import type { Dictionary } from "../../i18n/index.ts";

const workflowNodes = ["plan", "implement", "review", "verify", "final_decision"] as const;

export function WorkflowMap({
  dictionary,
  workflow,
  compact = false,
}: {
  dictionary: Dictionary;
  workflow: TeamRunSnapshot;
  compact?: boolean;
}) {
  const activeNode = visibleNode(workflow.currentNode);
  const activeIndex = workflowNodes.indexOf(activeNode);
  const complete = workflow.status === "completed";

  return (
    <ol className={compact ? "workflow-map workflow-map-compact" : "workflow-map"}>
      {workflowNodes.map((node, index) => {
        const current = node === activeNode;
        const finished = complete || index < activeIndex;
        return (
          <li
            className={`workflow-map-node ${current ? "is-current" : ""} ${finished ? "is-finished" : ""}`}
            key={node}
          >
            <span className="workflow-map-dot" aria-hidden="true">
              {finished ? "✓" : index + 1}
            </span>
            <span className="workflow-map-label">{dictionary.workflow.nodes[node]}</span>
            {index < workflowNodes.length - 1 && (
              <span className="workflow-map-line" aria-hidden="true" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function visibleNode(currentNode: string): (typeof workflowNodes)[number] {
  if (currentNode === "approve_plan" || currentNode === "plan") return "plan";
  if (currentNode === "implement") return "implement";
  if (currentNode === "review" || currentNode === "route_review") return "review";
  if (currentNode === "verify") return "verify";
  return "final_decision";
}

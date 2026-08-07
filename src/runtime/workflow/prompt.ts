import { Liquid } from "liquidjs";

import { WorkflowError } from "./error.ts";
import type { ProjectProfile } from "./load.ts";

const promptEngine = new Liquid({ strictFilters: true, strictVariables: true });

export async function renderPrompt(
  workflow: Pick<ProjectProfile, "promptTemplate">,
  input: { issue: Record<string, unknown>; attempt: number | null },
): Promise<string> {
  if (!workflow.promptTemplate) return "You are working on an issue from the configured tracker.";
  try {
    return await promptEngine.parseAndRender(workflow.promptTemplate, input);
  } catch (error) {
    throw new WorkflowError("template_render_error", "Cannot render WORKFLOW.md prompt", {
      cause: error,
    });
  }
}

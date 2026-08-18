import { parseDocument } from "yaml";

import { WorkflowError } from "./error.ts";

export function parseFrontMatter(source: string): {
  config: unknown;
  promptTemplate: string;
} {
  if (!source.startsWith("---")) return { config: {}, promptTemplate: source.trim() };

  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new WorkflowError("workflow_parse_error", "Unclosed YAML front matter");

  const document = parseDocument(match[1] ?? "");
  if (document.errors.length > 0) {
    throw new WorkflowError("workflow_parse_error", document.errors[0]?.message ?? "Invalid YAML");
  }
  const config = document.toJS();
  if (config === null || Array.isArray(config) || typeof config !== "object") {
    throw new WorkflowError(
      "workflow_front_matter_not_a_map",
      ".symphoneer/WORKFLOW.md front matter must be a map",
    );
  }
  return { config, promptTemplate: (match[2] ?? "").trim() };
}

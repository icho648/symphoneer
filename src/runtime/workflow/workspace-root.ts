import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, resolve } from "node:path";

import { WorkflowError } from "./error.ts";

export function resolveWorkspaceRoot(
  value: string | undefined,
  workflowPath: string,
  env: Readonly<Record<string, string | undefined>>,
  hostRoot?: string,
): string {
  if (hostRoot !== undefined) {
    const root = hostRoot.trim();
    if (!isAbsolute(root)) {
      throw new WorkflowError(
        "workflow_validation_error",
        "Host workspace root must be an absolute path",
      );
    }
    return resolve(root);
  }
  if (value === undefined) return resolve(tmpdir(), "symphony_workspaces");

  let configuredRoot = value;
  const variable = configuredRoot.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
  if (variable) {
    const expanded = env[variable];
    if (!expanded) {
      throw new WorkflowError(
        "workflow_validation_error",
        `workspace.root references missing environment variable ${variable}`,
      );
    }
    configuredRoot = expanded;
  }
  if (configuredRoot === "~" || configuredRoot.startsWith("~/")) {
    return resolve(homedir(), configuredRoot.slice(2));
  }
  return resolve(dirname(workflowPath), configuredRoot);
}

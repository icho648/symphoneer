import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

import { WorkflowError } from "./error.ts";

export function resolveWorkspaceRoot(
  value: string,
  workflowPath: string,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const variable = value.match(/^\$([A-Za-z_][A-Za-z0-9_]*)$/)?.[1];
  if (variable) {
    const resolved = env[variable];
    if (!resolved) {
      throw new WorkflowError(
        "workflow_validation_error",
        `workspace.root references missing environment variable ${variable}`,
      );
    }
    return resolve(resolved);
  }
  if (value === "~" || value.startsWith("~/")) {
    return resolve(homedir(), value.slice(2));
  }
  return resolve(dirname(workflowPath), value);
}

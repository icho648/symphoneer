export type WorkflowErrorCode =
  | "missing_workflow_file"
  | "workflow_parse_error"
  | "workflow_front_matter_not_a_map"
  | "workflow_validation_error"
  | "template_render_error";

export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "WorkflowError";
    this.code = code;
  }
}

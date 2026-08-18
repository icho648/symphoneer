import type { ExecutionActivity } from "@symphoneer/contracts";
import { ChevronDownIcon } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { CodeBlock } from "@/components/ai-elements/code-block";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  Plan,
  PlanAction,
  PlanContent,
  PlanDescription,
  PlanHeader,
  PlanTitle,
  PlanTrigger,
} from "@/components/ai-elements/plan";
import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalStatus,
  TerminalTitle,
} from "@/components/ai-elements/terminal";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { Dictionary, Locale } from "../../i18n/index.ts";
import { providerPresentation } from "../../lib/provider-presentation.ts";
import { selectSelectedTask, useWorkbench } from "../../stores/workbench.ts";
import { ExecutionComposer } from "./execution-composer.tsx";
import { ProviderIdentity } from "./provider-identity.tsx";

export function ExecutionActivityFeed() {
  const { detail, dictionary, locale, selectedTask } = useWorkbench(
    useShallow((state) => ({
      detail: state.detail,
      dictionary: state.dictionary,
      locale: state.locale,
      selectedTask: selectSelectedTask(state),
    })),
  );
  if (!selectedTask) return null;
  const attemptFinished = detail?.attempt.finishedAt != null;
  const attemptFailure = attemptFinished ? detail?.attempt.failure : null;
  const blockedReason = attemptFinished ? null : (selectedTask.blocked?.reason ?? null);
  const activities = detail?.activities ?? [];
  const provider = detail?.session?.provider ?? detail?.attempt.providerSession?.provider ?? null;
  const providerKind = providerPresentation(provider).kind;
  const pendingIntervention = detail?.interventions.find(
    (intervention) => intervention.state === "pending",
  );
  return (
    <section
      className="task-activity-pane"
      data-provider={providerKind}
      aria-labelledby="task-activity-title"
    >
      <div className="task-activity-scroll">
        <header className="task-activity-heading">
          <div>
            <ProviderIdentity dictionary={dictionary} provider={provider} />
            <h2 id="task-activity-title">{dictionary.detail.activity.title}</h2>
          </div>
          <span>{activities.length}</span>
        </header>

        {blockedReason && (
          <div className="task-alert task-alert-danger" role="alert">
            <span className="task-alert-mark" aria-hidden="true">
              !
            </span>
            <span>{blockedReason}</span>
          </div>
        )}

        {attemptFailure && (
          <div className="task-alert border-line-strong bg-panel-raised text-muted" role="status">
            <span>
              <strong>{dictionary.detail.activity.attemptResult}</strong>
              {` · ${attemptFailure}`}
            </span>
          </div>
        )}

        {pendingIntervention && (
          <div className="task-alert task-alert-warning" role="status">
            <span className="task-alert-mark" aria-hidden="true">
              !
            </span>
            <span>
              <strong>{dictionary.taskCard.humanAction}</strong>
              {` · ${pendingIntervention.prompt}`}
            </span>
          </div>
        )}

        {activities.length === 0 ? (
          <div className="task-activity-empty">
            <strong>{dictionary.detail.activity.emptyTitle}</strong>
            <p>
              {detail
                ? dictionary.detail.activity.legacyEmpty
                : dictionary.detail.activity.notStarted}
            </p>
          </div>
        ) : (
          <ol className="task-activity-list">
            {activities.map((activity) => (
              <li className={`task-activity-item is-${activity.status}`} key={activity.id}>
                <div className="task-activity-meta">
                  <span className="task-activity-dot" aria-hidden="true" />
                  <strong>
                    {activity.kind === "message" && activity.details.role === "user"
                      ? dictionary.detail.activity.input
                      : dictionary.detail.activity.kinds[activity.kind]}
                  </strong>
                  <span>{dictionary.detail.activity.states[activity.status]}</span>
                  <time dateTime={activity.occurredAt}>
                    {formatActivityTime(activity.occurredAt, locale)}
                  </time>
                </div>
                <ActivityContent
                  activity={activity}
                  dictionary={dictionary}
                  workspacePath={detail?.workspace?.path ?? null}
                />
              </li>
            ))}
          </ol>
        )}
      </div>
      <ExecutionComposer />
    </section>
  );
}

function ActivityContent({
  activity,
  dictionary,
  workspacePath,
}: {
  activity: ExecutionActivity;
  dictionary: Dictionary;
  workspacePath: string | null;
}) {
  if (activity.kind === "message" || activity.kind === "reasoning") {
    const isUserMessage = activity.kind === "message" && activity.details.role === "user";
    return (
      <Message
        className={isUserMessage ? undefined : "max-w-full"}
        from={isUserMessage ? "user" : "assistant"}
      >
        <MessageContent
          className={
            isUserMessage
              ? "text-ink group-[.is-user]:bg-zinc-200/80 dark:group-[.is-user]:bg-zinc-800"
              : "text-ink"
          }
        >
          <MessageResponse>{activity.content ?? activity.title}</MessageResponse>
        </MessageContent>
      </Message>
    );
  }
  if (activity.kind === "plan") {
    const steps = activity.details.steps;
    return (
      <Plan className="task-ai-plan" defaultOpen isStreaming={activity.status === "running"}>
        <PlanHeader className="px-3 py-3">
          <div className="min-w-0">
            <PlanTitle>{activity.title}</PlanTitle>
            {activity.content && <PlanDescription>{activity.content}</PlanDescription>}
          </div>
          <PlanAction>
            <PlanTrigger />
          </PlanAction>
        </PlanHeader>
        <PlanContent className="px-3 pb-3">
          {Array.isArray(steps) ? (
            <ol className="task-plan-steps">
              {steps.map((step, index) => {
                const value = asRecord(step);
                const status =
                  activity.status === "interrupted" && value?.status === "inProgress"
                    ? "interrupted"
                    : String(value?.status ?? "pending");
                return (
                  <li key={`${String(value?.text)}-${index}`}>
                    <span className={`is-${status}`} />
                    {String(value?.text ?? "")}
                  </li>
                );
              })}
            </ol>
          ) : (
            <MessageResponse>{activity.content ?? activity.title}</MessageResponse>
          )}
        </PlanContent>
      </Plan>
    );
  }
  if (activity.kind === "command") {
    return (
      <Collapsible defaultOpen={activity.status === "running" || activity.status === "failed"}>
        <Terminal
          className="task-ai-terminal"
          isStreaming={activity.status === "running"}
          output={stringDetail(activity, "output")}
        >
          <TerminalHeader className="px-3 py-2">
            <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left">
              <TerminalTitle className="min-w-0 flex-1 truncate">{activity.title}</TerminalTitle>
              <ChevronDownIcon className="size-4 shrink-0 text-zinc-400 transition-transform data-[state=open]:rotate-180" />
            </CollapsibleTrigger>
            <TerminalActions>
              <TerminalStatus>{dictionary.detail.activity.states[activity.status]}</TerminalStatus>
              <TerminalCopyButton />
            </TerminalActions>
          </TerminalHeader>
          <CollapsibleContent>
            <TerminalContent className="max-h-72 p-3 text-xs" />
          </CollapsibleContent>
        </Terminal>
      </Collapsible>
    );
  }
  if (activity.kind === "file_change") {
    const changes = activity.details.changes;
    return (
      <div className="task-file-changes">
        <strong>{activity.title}</strong>
        {Array.isArray(changes) &&
          changes.map((change, index) => {
            const value = asRecord(change);
            const path = relativePath(String(value?.path ?? `change-${index + 1}`), workspacePath);
            const diff = typeof value?.diff === "string" ? value.diff : "";
            return (
              <details key={`${path}-${index}`}>
                <summary>{path}</summary>
                {diff && <CodeBlock code={diff} language="diff" />}
              </details>
            );
          })}
      </div>
    );
  }
  if (activity.kind === "tool") {
    const state =
      activity.status === "running"
        ? "input-available"
        : activity.status === "interrupted"
          ? "output-interrupted"
          : activity.status === "failed"
            ? "output-error"
            : activity.status === "declined"
              ? "output-denied"
              : "output-available";
    return (
      <Tool className="task-ai-tool" defaultOpen={activity.status === "failed"}>
        <ToolHeader state={state} toolName={activity.title} type="dynamic-tool" />
        <ToolContent>
          <ActivityCode label={dictionary.detail.activity.input} value={activity.details.input} />
          <ActivityCode label={dictionary.detail.activity.output} value={activity.details.output} />
          {activity.content && <MessageResponse>{activity.content}</MessageResponse>}
        </ToolContent>
      </Tool>
    );
  }
  return (
    <div className="task-activity-note">
      <strong>{activity.title}</strong>
      {activity.content && <MessageResponse>{activity.content}</MessageResponse>}
    </div>
  );
}

function relativePath(path: string, workspacePath: string | null): string {
  return workspacePath && path.startsWith(`${workspacePath}/`)
    ? path.slice(workspacePath.length + 1)
    : path;
}

function ActivityCode({ label, value }: { label: string; value: unknown }) {
  if (typeof value !== "string" || !value) return null;
  return (
    <div className="grid gap-2">
      <strong className="text-[10px] uppercase tracking-[0.08em] text-faint">{label}</strong>
      <CodeBlock code={value} language="json" />
    </div>
  );
}

function stringDetail(activity: ExecutionActivity, key: string): string {
  const value = activity.details[key];
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function formatActivityTime(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

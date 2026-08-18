import type {
  AttemptSnapshot,
  CodexModel,
  RuntimeAttemptDetail,
  RuntimeProject,
  RuntimeSnapshot,
  TaskSummary,
  WorkflowStatus,
} from "@symphoneer/contracts";
import type { DefaultRuntimeClient } from "@symphoneer/runtime-client";
import { create } from "zustand";
import {
  type Dictionary,
  defaultLocale,
  getDictionary,
  interpolate,
  type Locale,
} from "../i18n/index.ts";
import { taskReviewHref } from "../lib/task-column.ts";
import {
  buildCommand,
  type CodexRunSettings,
  type CommandIntent,
  requiresAttempt,
} from "./runtime-commands.ts";

type WorkbenchState = {
  activeAttemptId: string | null;
  addProject: () => Promise<void>;
  assistantOpen: boolean;
  closeTask: () => void;
  codexModels: CodexModel[];
  connect: () => () => void;
  connection: RuntimeSnapshot["runtime"]["status"];
  deleteProject: (project: RuntimeProject) => Promise<void>;
  detail: RuntimeAttemptDetail | null;
  dictionary: Dictionary;
  locale: Locale;
  loadCodexModels: (projectId?: string) => Promise<void>;
  notice: string;
  openReview: (task: TaskSummary) => Promise<void>;
  openTask: (task: TaskSummary, attempt: AttemptSnapshot | null) => void;
  pendingStartTaskId: string | null;
  projects: RuntimeProject[];
  refresh: () => Promise<void>;
  selectAttempt: (attempt: AttemptSnapshot) => void;
  selectedTaskId: string | null;
  sendCommand: (intent: CommandIntent) => Promise<void>;
  setSnapshot: (snapshot: RuntimeSnapshot) => void;
  setTaskStatus: (task: TaskSummary, status: WorkflowStatus) => Promise<void>;
  snapshot: RuntimeSnapshot | null;
  startWorkflow: (task: TaskSummary, settings?: CodexRunSettings) => void;
  taskOpen: boolean;
  toggleAssistant: () => void;
};

let runtimeClient: DefaultRuntimeClient | null = null;

export const useWorkbench = create<WorkbenchState>()((set, get) => {
  const dictionary = getDictionary(defaultLocale);
  const loadActiveAttempt = async () => {
    const attemptId = get().activeAttemptId;
    if (!attemptId) {
      set({ detail: null });
      return;
    }
    set((state) => ({
      detail: state.detail?.attempt.id === attemptId ? state.detail : null,
    }));
    try {
      const detail = await getRuntimeClient().getAttempt(attemptId);
      if (get().activeAttemptId === attemptId) set({ detail });
    } catch {
      if (get().activeAttemptId === attemptId) set({ detail: null });
    }
  };

  const selectedTask = () =>
    get().snapshot?.tasks.find((task) => task.id === get().selectedTaskId) ?? null;

  return {
    activeAttemptId: null,
    assistantOpen: true,
    connection: "offline",
    codexModels: [],
    detail: null,
    dictionary,
    locale: defaultLocale,
    notice: dictionary.board.waitingRuntime,
    pendingStartTaskId: null,
    projects: [],
    selectedTaskId: null,
    snapshot: null,
    taskOpen: false,

    loadCodexModels: async (projectId) => {
      set({ codexModels: [] });
      try {
        const codexModels = await getRuntimeClient().listModels(projectId);
        if (selectedTask()?.projectId === projectId) set({ codexModels });
      } catch {
        if (selectedTask()?.projectId === projectId) set({ codexModels: [] });
      }
    },

    connect: () => {
      let disposed = false;
      void get().refresh();
      const subscription = getRuntimeClient().subscribe({
        afterSequence: get().snapshot?.runtime.lastEventSequence ?? 0,
      });
      void (async () => {
        for await (const event of subscription.events) {
          if (disposed) break;
          if (event.kind === "error") {
            set({ connection: "offline" });
          } else if (event.kind === "snapshot") {
            get().setSnapshot(event.snapshot);
            set({
              connection: "online",
              notice: get().dictionary.board.projectionSynchronized,
            });
          } else if (event.kind === "domain") {
            void get().refresh();
          }
        }
      })();

      const syncTaskFromUrl = () => {
        const params = new URLSearchParams(window.location.search);
        const taskId = params.get("task");
        set({
          ...(taskId ? { selectedTaskId: taskId } : {}),
          taskOpen: taskId !== null,
          activeAttemptId: params.get("attempt"),
        });
        void loadActiveAttempt();
      };
      syncTaskFromUrl();
      window.addEventListener("popstate", syncTaskFromUrl);

      return () => {
        disposed = true;
        subscription.close();
        window.removeEventListener("popstate", syncTaskFromUrl);
      };
    },

    refresh: async () => {
      try {
        const [health, snapshot, projects] = await Promise.all([
          getRuntimeClient().health(),
          getRuntimeClient().snapshot(),
          getRuntimeClient().listProjects(),
        ]);
        set({ connection: health.runtime.status, projects });
        get().setSnapshot(snapshot);
        set({ notice: get().dictionary.board.projectionSynchronized });
      } catch (error) {
        set({
          connection: "offline",
          notice:
            error instanceof Error ? error.message : get().dictionary.board.runtimeUnavailable,
        });
      }
    },

    setSnapshot: (snapshot) => {
      const current = get();
      const selectedTaskId = current.selectedTaskId ?? snapshot.tasks[0]?.id ?? null;
      const pendingAttempt = current.pendingStartTaskId
        ? latestAttempt(snapshot.attempts, current.pendingStartTaskId)
        : null;
      set({
        snapshot,
        selectedTaskId,
        ...(pendingAttempt ? { activeAttemptId: pendingAttempt.id, pendingStartTaskId: null } : {}),
      });
      if (pendingAttempt) {
        replaceUrl({ task: pendingAttempt.taskId, attempt: pendingAttempt.id });
      }
      void loadActiveAttempt();
    },

    openReview: async (task) => {
      try {
        const href =
          taskReviewHref(task) ??
          (await getRuntimeClient().reviewTarget(task.id, task.projectId)).url;
        window.open(href, "_blank", "noopener,noreferrer");
      } catch (error) {
        set({
          notice: error instanceof Error ? error.message : get().dictionary.board.commandFailed,
        });
        window.open(task.source.url, "_blank", "noopener,noreferrer");
      }
    },

    openTask: (task, attempt) => {
      set({
        activeAttemptId: attempt?.id ?? null,
        selectedTaskId: task.id,
        taskOpen: true,
      });
      replaceUrl({ task: task.id, attempt: attempt?.id ?? null });
      set({
        notice: interpolate(get().dictionary.board.selectedTask, {
          identifier: task.identifier,
        }),
      });
      void loadActiveAttempt();
    },

    closeTask: () => {
      set({ activeAttemptId: null, detail: null, taskOpen: false });
      replaceUrl({ task: null, attempt: null });
    },

    selectAttempt: (attempt) => {
      const task = selectedTask();
      if (!task) return;
      set({ activeAttemptId: attempt.id });
      replaceUrl({ task: task.id, attempt: attempt.id });
      void loadActiveAttempt();
    },

    sendCommand: async (intent) => {
      const state = get();
      if (!state.snapshot) return;
      const task =
        intent.kind === "enable_task_dispatch" && intent.task ? intent.task : selectedTask();
      const attempt = state.detail?.attempt;
      const isStart = intent.kind === "start_run";
      const isDispatchUpdate = intent.kind === "enable_task_dispatch";
      if (!isStart && !isDispatchUpdate && (!attempt || attempt.id !== state.activeAttemptId))
        return;
      if (isDispatchUpdate && !task) return;
      if (requiresAttempt(intent) && !attempt) return;
      if (
        intent.kind === "delete_attempt" &&
        !window.confirm(get().dictionary.detail.deleteAttemptConfirm)
      )
        return;

      try {
        const projectId = isStart ? intent.task.projectId : task?.projectId;
        const common = {
          expectedEventSequence: state.snapshot.runtime.lastEventSequence,
          idempotencyKey: `web:${intent.kind}:${crypto.randomUUID()}`,
          ...(projectId ? { projectId } : {}),
        };
        const command = buildCommand(intent, common, attempt, task);
        if (!command) return;
        const body = await getRuntimeClient().execute(command);
        get().setSnapshot(body.snapshot);
        if (
          intent.kind === "handoff_attempt" &&
          attempt?.providerSession &&
          (attempt.providerSession.provider ?? "codex-app-server") === "codex-app-server"
        ) {
          await getRuntimeClient().openCodexThread(attempt.providerSession.threadId);
        }
        if (intent.kind === "delete_attempt") {
          const nextAttempt = latestAttempt(body.snapshot.attempts, task?.id);
          set({ activeAttemptId: nextAttempt?.id ?? null });
          replaceUrl({ task: task?.id ?? null, attempt: nextAttempt?.id ?? null });
          void loadActiveAttempt();
        } else if (intent.kind === "retry_attempt" && task) {
          const nextAttempt = latestAttempt(body.snapshot.attempts, task.id);
          set({
            activeAttemptId: nextAttempt?.id ?? null,
            pendingStartTaskId: nextAttempt ? null : task.id,
          });
          replaceUrl({ task: task.id, attempt: nextAttempt?.id ?? null });
          void loadActiveAttempt();
        } else if (isStart) {
          const nextAttempt = body.snapshot.attempts.find((item) => item.taskId === intent.task.id);
          set({
            activeAttemptId: nextAttempt?.id ?? null,
            pendingStartTaskId: nextAttempt ? null : intent.task.id,
            selectedTaskId: intent.task.id,
            taskOpen: true,
          });
          replaceUrl({ task: intent.task.id, attempt: nextAttempt?.id ?? null });
          void loadActiveAttempt();
        }
        set({ notice: get().dictionary.board.commandAccepted });
      } catch (error) {
        set({
          notice: error instanceof Error ? error.message : get().dictionary.board.commandFailed,
        });
      }
    },

    startWorkflow: (task, settings = {}) => {
      void get().sendCommand({ kind: "start_run", mode: "single-agent", task, ...settings });
    },

    setTaskStatus: async (task, workflowStatus) => {
      const snapshot = get().snapshot;
      if (!snapshot) return;
      try {
        const body = await getRuntimeClient().setTaskStatus({
          ...(task.projectId ? { projectId: task.projectId } : {}),
          taskId: task.id,
          workflowStatus,
          expectedEventSequence: snapshot.runtime.lastEventSequence,
          idempotencyKey: `web:set_task_status:${task.id}:${workflowStatus}:${crypto.randomUUID()}`,
        });
        get().setSnapshot(body.snapshot);
        set({ notice: get().dictionary.board.commandAccepted });
      } catch (error) {
        set({
          notice: error instanceof Error ? error.message : get().dictionary.board.commandFailed,
        });
      }
    },

    addProject: async () => {
      try {
        set({ notice: get().dictionary.board.config.selectingPath });
        await getRuntimeClient().addProject();
        set({ notice: get().dictionary.board.config.syncing });
        const [projects, snapshot] = await Promise.all([
          getRuntimeClient().listProjects(),
          getRuntimeClient().snapshot(),
        ]);
        set({ projects, taskOpen: false });
        get().setSnapshot(snapshot);
        set({ notice: get().dictionary.board.config.synced });
      } catch (error) {
        set({
          notice: error instanceof Error ? error.message : get().dictionary.board.commandFailed,
        });
      }
    },

    deleteProject: async (project) => {
      if (
        !window.confirm(
          interpolate(get().dictionary.board.config.deleteConfirm, {
            repository: project.repository,
          }),
        )
      )
        return;
      try {
        set({ notice: get().dictionary.board.config.deleting });
        const projects = await getRuntimeClient().removeProject(project.id);
        const snapshot = await getRuntimeClient().snapshot();
        const selectedTaskId =
          get().selectedTaskId && snapshot.tasks.some((task) => task.id === get().selectedTaskId)
            ? get().selectedTaskId
            : (snapshot.tasks[0]?.id ?? null);
        set({ projects, selectedTaskId, taskOpen: false });
        get().setSnapshot(snapshot);
        set({ notice: get().dictionary.board.config.deleted });
      } catch (error) {
        set({
          notice: error instanceof Error ? error.message : get().dictionary.board.commandFailed,
        });
      }
    },

    toggleAssistant: () => set((state) => ({ assistantOpen: !state.assistantOpen })),
  };
});

export function connectWorkbench(client: DefaultRuntimeClient) {
  runtimeClient = client;
  return useWorkbench.getState().connect();
}

export function configureWorkbench(dictionary: Dictionary, locale: Locale) {
  useWorkbench.setState({ dictionary, locale });
}

export function selectSelectedTask(state: WorkbenchState): TaskSummary | null {
  return state.snapshot?.tasks.find((task) => task.id === state.selectedTaskId) ?? null;
}

export function selectSelectedAttempts(state: WorkbenchState): AttemptSnapshot[] {
  return (
    state.snapshot?.attempts
      .filter((attempt) => attempt.taskId === state.selectedTaskId)
      .sort((a, b) => b.sequence - a.sequence) ?? []
  );
}

export function selectActiveAttempt(state: WorkbenchState): AttemptSnapshot | null {
  return (
    state.snapshot?.attempts.find(
      (attempt) => attempt.taskId === state.selectedTaskId && attempt.id === state.activeAttemptId,
    ) ?? null
  );
}

function getRuntimeClient(): DefaultRuntimeClient {
  if (!runtimeClient) throw new Error("Workbench Runtime is not connected");
  return runtimeClient;
}

function latestAttempt(attempts: readonly AttemptSnapshot[], taskId?: string | null) {
  if (!taskId) return null;
  return attempts
    .filter((attempt) => attempt.taskId === taskId)
    .sort((a, b) => b.sequence - a.sequence)[0];
}

function replaceUrl(values: Record<"task" | "attempt", string | null>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (query ? `?${query}` : ""));
}

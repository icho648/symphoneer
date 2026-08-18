#!/usr/bin/env node

import { PiAssistantService } from "../assistant/index.ts";
import {
  ApplicationData,
  DesktopRuntimeHost,
  discoverGitRepositories,
  GitHubIssuesAdapter,
  loadProjectProfile,
  openCodexThread,
  RealSingleAgentOrchestration,
  RuntimeHttpServer,
  RuntimeService,
  resolveGitHubToken,
  resolveRuntimeHostConfig,
  selectDirectoryInFinder,
  WorkflowError,
} from "./index.ts";

export async function runServer(
  options: {
    dataDir?: string;
    cacheDir?: string;
    logDir?: string;
    workspaceRoot?: string;
    host?: "127.0.0.1" | "localhost" | "::1";
    port?: number;
    uiDistDir?: string;
    sessionToken?: string;
    stdout?: NodeJS.WritableStream;
  } = {},
): Promise<void> {
  const stdout = options.stdout ?? process.stdout;
  const hostConfig = await resolveRuntimeHostConfig({
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
    ...(options.cacheDir ? { cacheDir: options.cacheDir } : {}),
    ...(options.logDir ? { logDir: options.logDir } : {}),
    ...(options.workspaceRoot ? { workspaceRoot: options.workspaceRoot } : {}),
    ...(options.host ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.uiDistDir ? { uiDistDir: options.uiDistDir } : {}),
    ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
  });
  const applicationData = new ApplicationData({
    dataDir: hostConfig.dataDir,
    cacheDir: hostConfig.cacheDir,
    logDir: hostConfig.logDir,
    workspaceRoot: hostConfig.workspaceRoot,
  });
  const githubToken = await resolveGitHubToken();
  const assistant = new PiAssistantService({ dataDir: hostConfig.dataDir });
  const runtime = new DesktopRuntimeHost({
    applicationData,
    maxConcurrentAgents: hostConfig.maxConcurrentAgents,
    ...(process.env.SYMPHONEER_RUNTIME_ID ? { runtimeId: process.env.SYMPHONEER_RUNTIME_ID } : {}),
    createRuntime: async ({ project, layout, executionCapacity }) => {
      const profile = project.projectRoot
        ? await loadLocalProjectProfile(project.projectRoot, project.workspaceRoot)
        : undefined;
      const tracker =
        githubToken && project.trackerKind === "github"
          ? new GitHubIssuesAdapter({ repository: project.repository, token: githubToken })
          : undefined;
      const orchestration =
        tracker && project.projectRoot
          ? new RealSingleAgentOrchestration({
              dataDir: layout.root,
              tracker,
              projectRoot: project.projectRoot,
              workspaceRoot: project.workspaceRoot,
              operatorLogPath: layout.operatorLogPath,
              executionCapacity,
            })
          : undefined;
      return {
        runtime: new RuntimeService({
          dataDir: layout.root,
          ...(tracker ? { tracker } : {}),
          ...(orchestration
            ? {
                defaultOrchestration: orchestration,
                sessionHistory: (attempt) => orchestration.readSession(attempt),
              }
            : {}),
        }),
        ...(tracker ? { pollingIntervalMs: profile?.config.polling.intervalMs ?? 30_000 } : {}),
      };
    },
  });
  const server = new RuntimeHttpServer(runtime, {
    host: hostConfig.transport.host,
    port: hostConfig.transport.port,
    sessionToken: hostConfig.credentials.sessionToken,
    projects: () => runtime.listProjects(),
    addProject: async () => {
      const selectedPath = await selectDirectoryInFinder();
      if (!selectedPath) throw new Error("Project selection was canceled");
      const repositories = await discoverGitRepositories(selectedPath);
      const repository =
        repositories.find((candidate) => candidate.remote === "origin") ?? repositories[0];
      if (!repository) throw new Error("The selected directory has no GitHub remote");
      return runtime.addProject({
        trackerKind: "github",
        repository: repository.repository,
        projectRoot: selectedPath,
      });
    },
    removeProject: (projectId) => runtime.removeProject(projectId),
    openCodexThread,
    assistantHandler: assistant.handle,
    ...(hostConfig.uiDistDir ? { uiDistDir: hostConfig.uiDistDir } : {}),
  });
  const stopped = Promise.withResolvers<void>();
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void assistant
      .close()
      .then(() => server.close())
      .then(stopped.resolve, stopped.reject);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  const endpoint = await server.listen();
  assistant.connectRuntime({
    baseUrl: endpoint.url,
    ...(hostConfig.credentials.sessionToken ? { token: hostConfig.credentials.sessionToken } : {}),
  });
  stdout.write(`Runtime running at ${endpoint.url} (pid ${process.pid})\n`);
  try {
    await stopped.promise;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}

async function loadLocalProjectProfile(projectRoot: string, workspaceRoot: string) {
  try {
    return await loadProjectProfile({ cwd: projectRoot, workspaceRoot });
  } catch (error) {
    if (error instanceof WorkflowError && error.code === "missing_workflow_file") return undefined;
    throw error;
  }
}

if (import.meta.main) {
  runServer().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Runtime serve failed"}\n`);
    process.exitCode = 1;
  });
}

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  type RuntimeProject,
  type RuntimeProjectConfig,
  RuntimeProjectConfigSchema,
  RuntimeProjectSchema,
} from "@symphoneer/contracts";
import { z } from "zod";

const ProjectIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const ProjectRegistrySchema = z.object({
  projectIds: z.array(ProjectIdSchema),
});
const LegacyProjectRegistrySchema = z.object({
  projects: z.array(RuntimeProjectSchema),
});
const execFileAsync = promisify(execFile);

export interface ProjectDataLayout {
  root: string;
  configPath: string;
  eventsRoot: string;
  artifactsRoot: string;
  checkpointPath: string;
  workspaceRoot: string;
  operatorLogPath: string;
}

export interface RegisterProjectInput {
  trackerKind: string;
  repository: string;
  projectRoot: string;
}

/** Owns the application project catalog and every persistent project path convention. */
export class ApplicationData {
  readonly #dataDir: string;
  readonly #logDir: string;
  readonly #cacheDir: string;
  readonly #workspaceRoot: string;
  readonly #idFactory: () => string;
  #projectIds: string[] = [];
  #initialized = false;

  constructor(options: {
    dataDir: string;
    logDir: string;
    cacheDir: string;
    workspaceRoot?: string;
    idFactory?: () => string;
  }) {
    this.#dataDir = resolve(options.dataDir);
    this.#logDir = resolve(options.logDir);
    this.#cacheDir = resolve(options.cacheDir);
    this.#workspaceRoot = resolve(options.workspaceRoot ?? resolve(this.#dataDir, "workspaces"));
    this.#idFactory = options.idFactory ?? (() => `project-${randomUUID()}`);
  }

  async initialize(): Promise<void> {
    if (this.#initialized) return;
    await Promise.all([
      mkdir(resolve(this.#dataDir, "projects"), { recursive: true }),
      mkdir(this.#logDir, { recursive: true }),
      mkdir(this.#cacheDir, { recursive: true }),
      mkdir(this.#workspaceRoot, { recursive: true }),
    ]);
    this.#projectIds = await this.#readRegistry();
    for (const projectId of this.#projectIds) await this.#ensureProject(projectId);
    this.#initialized = true;
  }

  async listProjects(): Promise<RuntimeProject[]> {
    await this.initialize();
    return Promise.all(this.#projectIds.map((projectId) => this.#readProject(projectId)));
  }

  async registerProject(input: RegisterProjectInput): Promise<RuntimeProject> {
    await this.initialize();
    const checkout = await inspectGitCheckout(input.projectRoot);
    const projects = await this.listProjects();
    const existing = projects.find(
      (project) =>
        project.projectRoot === checkout.projectRoot ||
        (project.gitCommonDir !== undefined && project.gitCommonDir === checkout.gitCommonDir),
    );
    if (existing) return existing;
    const id = this.#allocateProjectId();
    const project = RuntimeProjectSchema.parse({
      id,
      trackerKind: input.trackerKind,
      repository: input.repository,
      projectRoot: checkout.projectRoot,
      gitCommonDir: checkout.gitCommonDir,
      workspaceRoot: this.project(id).workspaceRoot,
      repositorySource: "selected",
    });
    await this.#writeProject(project);
    this.#projectIds = [...this.#projectIds, id];
    await this.#writeRegistry(this.#projectIds);
    return project;
  }

  async removeProject(projectId: string): Promise<RuntimeProject[]> {
    await this.initialize();
    const id = ProjectIdSchema.parse(projectId);
    if (!this.#projectIds.includes(id)) throw new Error(`Project ${id} was not found`);
    this.#projectIds = this.#projectIds.filter((candidate) => candidate !== id);
    await this.#writeRegistry(this.#projectIds);
    return this.listProjects();
  }

  async rebindProject(projectId: string, projectRoot: string): Promise<RuntimeProject> {
    await this.initialize();
    const id = ProjectIdSchema.parse(projectId);
    if (!this.#projectIds.includes(id)) throw new Error(`Project ${id} was not found`);
    const checkout = await inspectGitCheckout(projectRoot);
    const projects = await this.listProjects();
    const conflict = projects.find(
      (project) =>
        project.id !== id &&
        (project.projectRoot === checkout.projectRoot ||
          (project.gitCommonDir !== undefined && project.gitCommonDir === checkout.gitCommonDir)),
    );
    if (conflict) throw new Error(`Project path already belongs to ${conflict.id}`);
    const current = projects.find((project) => project.id === id);
    if (!current) throw new Error(`Project ${id} was not found`);
    const rebound = RuntimeProjectSchema.parse({
      ...current,
      projectRoot: checkout.projectRoot,
      gitCommonDir: checkout.gitCommonDir,
    });
    await this.#writeProject(rebound);
    return rebound;
  }

  project(projectId: string): ProjectDataLayout {
    const id = ProjectIdSchema.parse(projectId);
    const root = resolve(this.#dataDir, "projects", id);
    return {
      root,
      configPath: resolve(root, "config.json"),
      eventsRoot: root,
      artifactsRoot: root,
      checkpointPath: resolve(root, "orchestration", "checkpoints.sqlite"),
      workspaceRoot: resolve(this.#workspaceRoot, id),
      operatorLogPath: resolve(this.#logDir, id, "operator.jsonl"),
    };
  }

  async #readRegistry(): Promise<string[]> {
    const path = this.#registryPath();
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      const registry = ProjectRegistrySchema.safeParse(value);
      if (registry.success) return unique(registry.data.projectIds);
      const legacy = LegacyProjectRegistrySchema.safeParse(value);
      if (!legacy.success) throw new Error(`Project registry is invalid: ${path}`);
      for (const project of legacy.data.projects) await this.#writeProject(project);
      const projectIds = unique(legacy.data.projects.map((project) => project.id));
      await this.#writeRegistry(projectIds);
      return projectIds;
    } catch (error) {
      if (!isMissing(error)) throw error;
      const migrated = await this.#migrateSingletonProject();
      await this.#writeRegistry(migrated);
      return migrated;
    }
  }

  async #migrateSingletonProject(): Promise<string[]> {
    try {
      const id = ProjectIdSchema.parse(
        (await readFile(resolve(this.#dataDir, "project-id"), "utf8")).trim(),
      );
      await this.#readProject(id);
      return [id];
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }

  async #readProject(projectId: string): Promise<RuntimeProject> {
    const layout = this.project(projectId);
    const config = RuntimeProjectConfigSchema.parse(
      JSON.parse(await readFile(layout.configPath, "utf8")),
    );
    return RuntimeProjectSchema.parse({ id: projectId, ...config });
  }

  async #writeProject(projectInput: RuntimeProject): Promise<void> {
    const project = RuntimeProjectSchema.parse(projectInput);
    await this.#ensureProject(project.id);
    const config: RuntimeProjectConfig = RuntimeProjectConfigSchema.parse(project);
    await atomicWrite(this.project(project.id).configPath, config);
  }

  async #ensureProject(projectId: string): Promise<void> {
    const layout = this.project(projectId);
    await Promise.all([
      mkdir(resolve(layout.root, "events"), { recursive: true }),
      mkdir(resolve(layout.root, "artifacts"), { recursive: true }),
      mkdir(dirname(layout.checkpointPath), { recursive: true }),
      mkdir(layout.workspaceRoot, { recursive: true }),
    ]);
  }

  async #writeRegistry(projectIds: string[]): Promise<void> {
    await atomicWrite(this.#registryPath(), ProjectRegistrySchema.parse({ projectIds }));
  }

  #allocateProjectId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = ProjectIdSchema.parse(this.#idFactory());
      if (!this.#projectIds.includes(id)) return id;
    }
    throw new Error("Could not allocate a unique project ID");
  }

  #registryPath(): string {
    return resolve(this.#dataDir, "projects", "index.json");
  }
}

async function canonicalDirectory(path: string): Promise<string> {
  const canonical = await realpath(resolve(path));
  if (!(await stat(canonical)).isDirectory())
    throw new Error(`Project path is not a directory: ${path}`);
  return canonical;
}

async function inspectGitCheckout(path: string): Promise<{
  projectRoot: string;
  gitCommonDir: string;
}> {
  const directory = await canonicalDirectory(path);
  try {
    const { stdout } = await execFileAsync(
      "git",
      [
        "-C",
        directory,
        "rev-parse",
        "--path-format=absolute",
        "--show-toplevel",
        "--git-common-dir",
      ],
      { encoding: "utf8" },
    );
    const [topLevel, commonDir] = stdout.trim().split("\n");
    if (!topLevel || !commonDir) throw new Error("Git returned incomplete checkout identity");
    return {
      projectRoot: await canonicalDirectory(topLevel),
      gitCommonDir: await realpath(resolve(commonDir)),
    };
  } catch (error) {
    throw new Error(`Project path is not a Git checkout: ${path}`, { cause: error });
  }
}

async function atomicWrite(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = resolve(dirname(path), `.${randomUUID()}.tmp`);
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, path);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => ProjectIdSchema.parse(value)))];
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

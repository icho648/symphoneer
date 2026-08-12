import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  type RuntimeRepositoryCandidate,
  RuntimeRepositoryCandidateSchema,
} from "@symphoneer/contracts";

const execFileAsync = promisify(execFile);

export async function resolveGitHubToken(
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    readCliToken?: () => Promise<string>;
  } = {},
): Promise<string | undefined> {
  const env = options.env ?? process.env;
  const configured = env.GITHUB_TOKEN?.trim() || env.GH_TOKEN?.trim();
  if (configured) return configured;
  try {
    const readCliToken =
      options.readCliToken ??
      (async () => {
        const { stdout } = await execFileAsync(
          "gh",
          ["auth", "token", "--hostname", "github.com"],
          { encoding: "utf8", maxBuffer: 16 * 1024 },
        );
        return String(stdout);
      });
    return (await readCliToken()).trim() || undefined;
  } catch {
    return undefined;
  }
}

export function parseGitRemoteOutput(output: string): RuntimeRepositoryCandidate[] {
  const candidates: RuntimeRepositoryCandidate[] = [];
  const seen = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\(fetch\)$/);
    if (!match) continue;
    const remoteUrl = match[2];
    if (!remoteUrl) continue;
    const repository = parseGitHubRepository(remoteUrl);
    if (!repository || seen.has(repository)) continue;
    seen.add(repository);
    candidates.push(
      RuntimeRepositoryCandidateSchema.parse({
        trackerKind: "github",
        repository,
        remote: match[1],
      }),
    );
  }
  return candidates;
}

export async function discoverGitRepositories(
  projectRoot: string,
): Promise<RuntimeRepositoryCandidate[]> {
  try {
    const { stdout } = await execFileAsync("git", ["-C", projectRoot, "remote", "-v"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024,
    });
    return parseGitRemoteOutput(String(stdout));
  } catch {
    return [];
  }
}

function parseGitHubRepository(remoteUrl: string): string | undefined {
  const match = remoteUrl.match(/github\.com[:/]([^/\s:]+)\/([^/\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

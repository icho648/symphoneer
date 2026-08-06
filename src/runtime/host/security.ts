import type { IncomingMessage } from "node:http";
import { RuntimeError } from "../errors.ts";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function assertLoopbackHost(hostHeader: string | undefined): void {
  if (!hostHeader) throw new RuntimeError("invalid_request", "Host header is required");
  const hostname = hostHeader.replace(/:\d+$/, "").replace(/^\[(.*)\]$/, "$1");
  if (!LOOPBACK_HOSTS.has(hostname) && hostname !== "127.0.0.1") {
    throw new RuntimeError("invalid_request", "Runtime only accepts loopback Host headers");
  }
}

export function assertAllowedOrigin(
  origin: string | undefined,
  options: { requireOrigin?: boolean } = {},
): void {
  if (!origin) {
    if (options.requireOrigin) {
      throw new RuntimeError("invalid_request", "Origin header is required for browser requests");
    }
    return;
  }
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new RuntimeError("invalid_request", "Origin is invalid");
  }
  if (url.protocol !== "http:") {
    throw new RuntimeError("invalid_request", "Origin must use HTTP on loopback");
  }
  const hostname = url.hostname.replace(/^\[(.*)\]$/, "$1");
  if (!LOOPBACK_HOSTS.has(hostname)) {
    throw new RuntimeError("invalid_request", "Origin must be loopback");
  }
}

export function assertSessionToken(
  request: IncomingMessage,
  expectedToken: string | undefined,
): void {
  if (!expectedToken) return;
  const header = request.headers.authorization;
  const token =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length).trim()
      : undefined;
  if (!token || token !== expectedToken) {
    throw new RuntimeError("invalid_request", "Runtime session token is required");
  }
}

export function redactSecrets<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "string" && looksLikeSecret(nested)) return "[redacted]";
      return nested;
    }),
  ) as T;
}

function looksLikeSecret(value: string): boolean {
  return (
    /^(Bearer\s+)?[A-Za-z0-9_-]{24,}$/.test(value) ||
    /api[_-]?key|secret|token|authorization/i.test(value)
  );
}

import { createHttpAssistantClient } from "@symphoneer/assistant-client";
import {
  createHttpRuntimeClient,
  type DefaultRuntimeClient,
  RuntimeClient,
} from "@symphoneer/runtime-client";
import { createContext, type ReactNode, useContext, useMemo } from "react";

type Bootstrap = {
  token?: string;
  baseUrl?: string;
};

declare global {
  interface Window {
    __SYMPHONEER_RUNTIME__?: Bootstrap;
  }
}

const RuntimeContext = createContext<DefaultRuntimeClient | null>(null);

export function createBrowserRuntimeClient(): DefaultRuntimeClient {
  const boot = window.__SYMPHONEER_RUNTIME__;
  const baseUrl = boot?.baseUrl || window.location.origin;
  const token = boot?.token;
  return createHttpRuntimeClient({
    baseUrl,
    ...(token ? { token } : {}),
  });
}

export function createBrowserAssistantClient() {
  const boot = window.__SYMPHONEER_RUNTIME__;
  const baseUrl = boot?.baseUrl || window.location.origin;
  const token = boot?.token;
  return createHttpAssistantClient({ baseUrl, ...(token ? { token } : {}) });
}

export function RuntimeProvider({
  children,
  client,
}: {
  children: ReactNode;
  client?: DefaultRuntimeClient;
}) {
  const value = useMemo(() => client ?? createBrowserRuntimeClient(), [client]);
  return <RuntimeContext.Provider value={value}>{children}</RuntimeContext.Provider>;
}

export function useRuntimeClient(): DefaultRuntimeClient {
  const client = useContext(RuntimeContext);
  if (!client) throw new Error("RuntimeProvider is missing");
  return client;
}

export { RuntimeClient };

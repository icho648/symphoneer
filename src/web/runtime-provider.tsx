import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  createHttpRuntimeClient,
  DefaultRuntimeClient,
  RuntimeClient,
} from "@symphoneer/runtime-client";

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
  const token = boot?.token || import.meta.env.VITE_RUNTIME_TOKEN || undefined;
  return createHttpRuntimeClient({
    baseUrl,
    ...(token ? { token } : {}),
  });
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

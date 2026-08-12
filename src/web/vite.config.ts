import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(root, "../.."), "");
  const runtimeUrl = env.SYMPHONEER_RUNTIME_URL ?? "http://127.0.0.1:4318";
  const token = env.SYMPHONEER_RUNTIME_TOKEN ?? env.VITE_RUNTIME_TOKEN ?? "";

  return {
    root,
    publicDir: path.join(root, "public"),
    plugins: [react()],
    resolve: {
      alias: {
        "@": root,
        "@symphoneer/contracts": path.resolve(root, "../contracts/index.ts"),
        "@symphoneer/runtime-client": path.resolve(root, "../runtime-client/index.ts"),
        "@symphoneer/runtime-tools": path.resolve(root, "../runtime-tools/index.ts"),
      },
    },
    define: {
      "import.meta.env.VITE_RUNTIME_TOKEN": JSON.stringify(token),
    },
    server: {
      host: env.SYMPHONEER_WEB_HOST ?? "127.0.0.1",
      port: Number(env.SYMPHONEER_WEB_PORT ?? 3000),
      proxy: {
        "/healthz": { target: runtimeUrl, changeOrigin: true },
        "/v1": {
          target: runtimeUrl,
          changeOrigin: true,
          configure: (proxy) => {
            if (!token) return;
            proxy.on("proxyReq", (proxyReq) => {
              if (!proxyReq.getHeader("authorization")) {
                proxyReq.setHeader("Authorization", `Bearer ${token}`);
              }
            });
          },
        },
      },
    },
    build: {
      outDir: path.join(root, "dist"),
      emptyOutDir: true,
      sourcemap: true,
    },
  };
});

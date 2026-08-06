/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RUNTIME_TOKEN?: string;
  readonly VITE_RUNTIME_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

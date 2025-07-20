/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NEO4J_CONNECTION_URI: string;
  // Add other environment variables here if needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
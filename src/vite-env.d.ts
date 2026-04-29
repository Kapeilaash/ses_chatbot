/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OLLAMA_URL?: string
  readonly VITE_OLLAMA_MODEL?: string
  /** If set, chat POST goes here instead of VITE_OLLAMA_URL (e.g. your FastAPI public URL). */
  readonly VITE_CHAT_BACKEND_URL?: string
  /** Path on that host, default `/api/chat` (Ollama-compatible streaming NDJSON). */
  readonly VITE_CHAT_PATH?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

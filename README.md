# SES Chat UI

A lightweight web chat UI for **SES AI Assistant**, built with **React + TypeScript + Vite**.  
It streams responses from an **Ollama-compatible** `/api/chat` endpoint (NDJSON streaming).

## Features

- **Streaming chat**: token-by-token updates for assistant messages.
- **Chat sidebar**: create, rename, pin, archive, and delete chats.
- **Branding + identity**: the app injects a system prompt so “Who are you?” answers stay **SES AI Assistant** (no base-model disclosure).
- **Thinking animation**: ChatGPT-style animated dots while waiting for the first token.
- **Tailwind v4** styling via the Vite plugin.

## Requirements

- **Node.js**: `>= 20.19.0` (see `package.json` `engines.node`)
- An Ollama server or gateway that supports **Ollama chat streaming**:
  - `POST /api/chat`
  - NDJSON chunks that include `message.content`
  - A final chunk with `done: true`

## Getting started (local)

1) Install dependencies

```bash
npm install
```

2) Start Ollama (example)

```bash
ollama serve
```

3) Run the dev server

```bash
npm run dev
```

### Dev proxy (no CORS pain)

In development, Vite proxies requests from `'/ollama'` to `http://127.0.0.1:11434` (see `vite.config.ts`).  
So the UI can talk to Ollama without needing browser CORS configuration.

## Configuration (environment variables)

This is a Vite app, so variables must be prefixed with `VITE_`.

- **`VITE_OLLAMA_MODEL`**: Model name to send in the request.  
  Default: `qwen2.5:0.5b`
- **`VITE_OLLAMA_URL`**: Base URL for Ollama (direct).  
  Default: dev uses `'/ollama'` (Vite proxy), prod uses `http://127.0.0.1:11434`
- **`VITE_CHAT_BACKEND_URL`**: Base URL for a gateway (e.g., FastAPI) that exposes an Ollama-compatible chat endpoint.  
  If set, it is used for chat requests instead of `VITE_OLLAMA_URL`.
- **`VITE_CHAT_PATH`**: Path for chat streaming.  
  Default: `/api/chat`

### Example `.env.local`

```bash
# Use a gateway in dev/prod (optional)
VITE_CHAT_BACKEND_URL=http://127.0.0.1:8000

# If your gateway mounts chat somewhere else (optional)
VITE_CHAT_PATH=/api/chat

# Choose the model name the backend expects
VITE_OLLAMA_MODEL=qwen2.5:0.5b
```

## Scripts

- **`npm run dev`**: Start Vite dev server.
- **`npm run build`**: Type-check (`tsc -b`) then build for production (`vite build`).
- **`npm run preview`**: Preview the production build locally.
- **`npm run start`**: Serve the `dist/` folder (uses `serve -s dist`).
- **`npm run lint`**: Run ESLint.

## Production

Build:

```bash
npm run build
```

Serve the static build:

```bash
npm run start
```

If deploying behind a gateway, set `VITE_CHAT_BACKEND_URL` at build time (or via your platform’s Vite env injection) so the frontend posts to your gateway instead of local Ollama.

## How streaming works (high level)

The UI sends a chat request shaped like Ollama:

```json
{
  "model": "your-model",
  "messages": [
    { "role": "system", "content": "..." },
    { "role": "user", "content": "Hello" }
  ],
  "stream": true
}
```

It then parses NDJSON lines and accumulates `message.content` until the backend emits a chunk with `done: true`.

## Troubleshooting

### I get “Request failed” or a non-200 error

- Ensure the backend URL/path is correct (`VITE_CHAT_BACKEND_URL`, `VITE_CHAT_PATH`).
- If you are calling Ollama directly, confirm it’s reachable at `VITE_OLLAMA_URL` (or the default `http://127.0.0.1:11434` in production).
- In dev, confirm the Vite proxy is active and Ollama is running.

### The assistant doesn’t stream (it returns all at once)

Your backend must support streaming and emit NDJSON chunks progressively. If it buffers the response, the UI won’t receive tokens until the end.

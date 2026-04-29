/**
 * Chat streaming: Ollama-style POST + NDJSON (`message.content`, `done`).
 * - Local dev: Vite proxies `/ollama` → Ollama unless you set VITE_CHAT_BACKEND_URL.
 * - Production: set VITE_CHAT_BACKEND_URL to your FastAPI URL if it proxies Ollama
 *   and keeps the same request/response shape; or set VITE_OLLAMA_URL to call Ollama directly.
 */

export function getOllamaBaseUrl(): string {
  const fromEnv = import.meta.env.VITE_OLLAMA_URL?.replace(/\/$/, '')
  if (fromEnv) return fromEnv
  if (import.meta.env.DEV) return '/ollama'
  return 'http://127.0.0.1:11434'
}

/** Base URL used only for chat POST (FastAPI gateway or Ollama). */
export function getChatBackendBaseUrl(): string {
  const gateway = import.meta.env.VITE_CHAT_BACKEND_URL?.replace(/\/$/, '')
  if (gateway) return gateway
  return getOllamaBaseUrl()
}

/** Path for chat streaming, default Ollama `/api/chat`. */
export function getChatPath(): string {
  const raw = import.meta.env.VITE_CHAT_PATH?.trim()
  if (!raw) return '/api/chat'
  return raw.startsWith('/') ? raw : `/${raw}`
}

export function getOllamaModel(): string {
  return import.meta.env.VITE_OLLAMA_MODEL?.trim() || 'qwen2.5:0.5b'
}

export async function streamOllamaChat(
  messages: { role: 'user' | 'assistant'; content: string }[],
  onToken: (accumulated: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const base = getChatBackendBaseUrl()
  const path = getChatPath()
  const model = getOllamaModel()
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(text || `${res.status} ${res.statusText}`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let accumulated = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let chunk: { done?: boolean; message?: { content?: string } }
      try {
        chunk = JSON.parse(trimmed) as typeof chunk
      } catch {
        continue
      }
      if (chunk.done) {
        onToken(accumulated)
        return
      }
      const piece = chunk.message?.content
      if (typeof piece === 'string' && piece.length > 0) {
        accumulated += piece
        onToken(accumulated)
      }
    }
  }

  if (buffer.trim()) {
    try {
      const chunk = JSON.parse(buffer.trim()) as { done?: boolean; message?: { content?: string } }
      if (!chunk.done) {
        const piece = chunk.message?.content
        if (typeof piece === 'string') accumulated += piece
      }
    } catch {
      /* ignore trailing garbage */
    }
  }
  onToken(accumulated)
}

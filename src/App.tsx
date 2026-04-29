import { useEffect, useMemo, useRef, useState } from 'react'
import sesLogo from './assets/ses-logo.png'
import { getOllamaModel, streamOllamaChat } from './ollama'

type Message = { id: string; role: 'user' | 'assistant'; content: string }
type Chat = {
  id: string
  title: string
  messages: Message[]
  pinned?: boolean
  archived?: boolean
}

function stripMarkdown(input: string): string {
  // Goal: keep the content readable while removing common Markdown syntax
  // (headings/bold/lists/code fences) so the UI shows "plain text".
  let text = input ?? ''

  // Fenced code blocks: keep inner content (remove ``` wrapper).
  text = text.replace(/```[a-zA-Z0-9_-]*\n([\s\S]*?)```/g, '$1')
  text = text.replace(/```([\s\S]*?)```/g, '$1')

  // Inline code: remove backticks.
  text = text.replace(/`([^`]+)`/g, '$1')

  // Links/images: keep label/alt text.
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '$1')
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')

  // Headings: remove leading #.
  text = text.replace(/^#{1,6}\s+/gm, '')

  // Blockquotes: remove leading >.
  text = text.replace(/^>\s?/gm, '')

  // Bold/italic/strikethrough.
  text = text.replace(/\*\*([^*]+)\*\*/g, '$1')
  text = text.replace(/__([^_]+)__/g, '$1')
  text = text.replace(/~~([^~]+)~~/g, '$1')

  // Unordered list markers.
  text = text.replace(/^(\s*)[-*+]\s+/gm, '$1')
  // Common "bullet" character.
  text = text.replace(/^(\s*)•\s+/gm, '$1')
  // Ordered list markers.
  text = text.replace(/^(\s*)\d+\.\s+/gm, '$1')

  // Horizontal rules: remove the line.
  text = text.replace(/^\s*(?:-{3,}|_{3,}|\*{3,})\s*$/gm, '')

  // Remove any remaining emphasis wrappers conservatively.
  text = text.replace(/\B_([^_\n]+)_\B/g, '$1')

  return text
}

function App() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [input, setInput] = useState('')
  const [search, setSearch] = useState('')
  const [chatMenuOpenId, setChatMenuOpenId] = useState<string | null>(null)

  const starterMessages: Message[] = useMemo(
    () => [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Hi! I’m SES Chat. Start a new chat anytime from the sidebar.',
      },
    ],
    [],
  )

  const [chats, setChats] = useState<Chat[]>(() => [
    { id: crypto.randomUUID(), title: 'SES Chat UI', messages: starterMessages },
  ])
  const [activeChatId, setActiveChatId] = useState<string>(() => chats[0]?.id ?? '')
  const [sending, setSending] = useState(false)
  const sendAbortRef = useRef<AbortController | null>(null)

  const listRef = useRef<HTMLDivElement | null>(null)

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? chats[0],
    [activeChatId, chats],
  )
  const messages = activeChat?.messages ?? []

  const canSend = input.trim().length > 0 && Boolean(activeChat) && !sending
  const accent = useMemo(() => ({ color: 'var(--ses-teal)' }), [])
  const accentBg = useMemo(() => ({ background: 'rgba(6, 153, 153, 0.08)' }), [])
  const accentBorder = useMemo(() => ({ borderColor: 'rgba(6, 153, 153, 0.28)' }), [])

  useEffect(() => {
    function syncSidebar() {
      // Mobile-first: start collapsed on smaller screens
      setSidebarOpen(window.innerWidth >= 1024)
    }
    syncSidebar()
    window.addEventListener('resize', syncSidebar)
    return () => window.removeEventListener('resize', syncSidebar)
  }, [])

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [messages.length])

  useEffect(() => {
    function closeMenu() {
      setChatMenuOpenId(null)
    }
    window.addEventListener('pointerdown', closeMenu)
    return () => window.removeEventListener('pointerdown', closeMenu)
  }, [])

  const visibleChats = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = chats.filter((c) => !c.archived)
    const filtered = !q ? base : base.filter((c) => c.title.toLowerCase().includes(q))
    return filtered.sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)))
  }, [chats, search])

  function createNewChat() {
    const newChat: Chat = {
      id: crypto.randomUUID(),
      title: 'New chat',
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: 'Hi! How can I help you today?',
        },
      ],
    }

    setChats((prev) => [newChat, ...prev])
    setActiveChatId(newChat.id)
    setInput('')
    setSearch('')
  }

  function renameChat(chatId: string) {
    const current = chats.find((c) => c.id === chatId)?.title ?? 'Chat'
    const next = window.prompt('Rename chat', current)?.trim()
    if (!next) return
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: next } : c)))
  }

  function togglePin(chatId: string) {
    setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, pinned: !c.pinned } : c)))
  }

  function archiveChat(chatId: string) {
    setChats((prev) =>
      prev.map((c) => (c.id === chatId ? { ...c, archived: true, pinned: false } : c)),
    )
    setChatMenuOpenId(null)
    if (activeChatId === chatId) {
      const next = chats.find((c) => c.id !== chatId && !c.archived)?.id
      if (next) setActiveChatId(next)
    }
  }

  function deleteChat(chatId: string) {
    const ok = window.confirm('Delete this chat?')
    if (!ok) return
    setChats((prev) => prev.filter((c) => c.id !== chatId))
    setChatMenuOpenId(null)
    if (activeChatId === chatId) {
      const next = chats.find((c) => c.id !== chatId && !c.archived)?.id
      setActiveChatId(next ?? '')
    }
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || !activeChat || sending) return

    const chatId = activeChat.id
    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    const assistantId = crypto.randomUUID()
    const assistantMsg: Message = { id: assistantId, role: 'assistant', content: '' }

    const historyForApi = [...activeChat.messages, userMsg].map(({ role, content }) => ({
      role,
      content,
    }))

    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              title: c.title === 'New chat' ? text.slice(0, 28) || 'New chat' : c.title,
              messages: [...c.messages, userMsg, assistantMsg],
            }
          : c,
      ),
    )
    setInput('')
    setSending(true)
    sendAbortRef.current?.abort()
    sendAbortRef.current = new AbortController()

    try {
      await streamOllamaChat(historyForApi, (accumulated) => {
        setChats((prev) =>
          prev.map((c) => {
            if (c.id !== chatId) return c
            return {
              ...c,
              messages: c.messages.map((m) =>
                m.id === assistantId ? { ...m, content: accumulated } : m,
              ),
            }
          }),
        )
      }, sendAbortRef.current.signal)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      const message = err instanceof Error ? err.message : 'Request failed'
      setChats((prev) =>
        prev.map((c) => {
          if (c.id !== chatId) return c
          return {
            ...c,
            messages: c.messages.map((m) =>
              m.id === assistantId
                ? { ...m, content: m.content ? `${m.content}\n\nError: ${message}` : `Error: ${message}` }
                : m,
            ),
          }
        }),
      )
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="h-full w-full">
      <div className="flex h-full w-full">
        {/* Sidebar */}
        <aside
          className={[
            'h-full border-r border-slate-200 bg-slate-50',
            'transition-[width] duration-200',
            sidebarOpen ? 'w-[280px]' : 'w-[72px]',
          ].join(' ')}
        >
          <div className="flex h-full flex-col">
            <div
              className={[
                'border-b border-slate-200 bg-white p-4',
                sidebarOpen ? 'flex items-center gap-3' : 'flex flex-col items-center gap-2',
              ].join(' ')}
            >
              <img
                src={sesLogo}
                alt="Save Energy Systems"
                className={[
                  'w-auto object-contain',
                  sidebarOpen ? 'h-10' : 'h-8',
                ].join(' ')}
              />
              <button
                type="button"
                onClick={() => setSidebarOpen((s) => !s)}
                className={[
                  'inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm text-slate-700 hover:bg-slate-50',
                  'focus:outline-none focus:ring-2 focus:ring-[color:var(--ses-teal)]/25 focus:ring-offset-2 focus:ring-offset-white',
                  sidebarOpen ? 'ml-auto' : '',
                ].join(' ')}
                aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
                title={sidebarOpen ? 'Collapse' : 'Expand'}
              >
                {sidebarOpen ? '⟨' : '⟩'}
              </button>
            </div>

            <div className="p-3">
              <button
                type="button"
                onClick={createNewChat}
                className={[
                  'w-full rounded-xl border border-slate-200 text-sm',
                  'hover:brightness-95',
                  'focus:outline-none focus:ring-2 focus:ring-[color:var(--ses-teal)]/25 focus:ring-offset-2 focus:ring-offset-slate-50',
                  sidebarOpen ? 'px-3 py-2 text-left' : 'flex h-12 items-center justify-center',
                ].join(' ')}
                style={accentBg}
                aria-label="New chat"
                title="New chat"
              >
                {sidebarOpen ? (
                  <span className="font-semibold" style={accent}>
                    + New chat
                  </span>
                ) : (
                  <span className="inline-flex items-center justify-center" style={accent}>
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M12 5v14" />
                      <path d="M5 12h14" />
                    </svg>
                  </span>
                )}
              </button>
            </div>

            <div className={['px-3 pb-3', sidebarOpen ? '' : 'hidden'].join(' ')}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" />
                  </svg>
                </span>
                <input
                  type="search"
                  placeholder="Search chats"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className={[
                    'w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900',
                    'placeholder:text-slate-400',
                    'outline-none',
                    'focus:border-[color:var(--ses-teal)] focus:ring-2 focus:ring-[color:var(--ses-teal)]/20',
                  ].join(' ')}
                />
              </div>
            </div>

            <div className={['flex-1 overflow-auto px-3 pb-3', sidebarOpen ? '' : 'hidden'].join(' ')}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Recent
              </div>
              <div className="mt-2 space-y-1">
                {visibleChats.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-3 text-sm text-slate-500">
                    No chats found
                  </div>
                ) : (
                  visibleChats.map((c) => {
                    const isActive = c.id === activeChatId
                    const isMenuOpen = chatMenuOpenId === c.id
                    return (
                      <div key={c.id} className="relative">
                        <button
                          type="button"
                          onClick={() => setActiveChatId(c.id)}
                          className={[
                            'group relative flex w-full items-center gap-2 rounded-lg bg-white px-3 py-2 text-left text-sm text-slate-800',
                            'ring-1 shadow-sm',
                            isActive
                              ? 'ring-[color:var(--ses-teal)]/25'
                              : 'ring-slate-200 hover:ring-slate-300',
                          ].join(' ')}
                        >
                          {isActive ? (
                            <span
                              className="absolute left-0 top-2 bottom-2 w-1 rounded-full opacity-100"
                              style={{ background: 'var(--ses-teal)' }}
                            />
                          ) : null}
                          <span className={isActive ? 'pl-2 font-semibold' : 'pl-2'}>
                            {c.pinned ? '📌 ' : ''}
                            {c.title}
                          </span>
                          <span className="ml-auto flex items-center gap-1">
                            <button
                              type="button"
                              className={[
                                'inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-500',
                                'hover:bg-slate-100 hover:text-slate-700',
                                'opacity-0 group-hover:opacity-100',
                                isMenuOpen ? 'opacity-100' : '',
                              ].join(' ')}
                              aria-label="Chat menu"
                              onClick={(e) => {
                                e.stopPropagation()
                                setChatMenuOpenId((prev) => (prev === c.id ? null : c.id))
                              }}
                            >
                              ⋯
                            </button>
                          </span>
                        </button>

                        {isMenuOpen ? (
                          <div
                            className="absolute right-2 top-11 z-20 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
                            onPointerDown={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                              onClick={() => {
                                setChatMenuOpenId(null)
                                window.alert('Share: connect this to your backend later.')
                              }}
                            >
                              Share
                            </button>
                            <button
                              type="button"
                              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                              onClick={() => {
                                setChatMenuOpenId(null)
                                renameChat(c.id)
                              }}
                            >
                              Rename
                            </button>
                            <button
                              type="button"
                              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                              onClick={() => {
                                setChatMenuOpenId(null)
                                togglePin(c.id)
                              }}
                            >
                              {c.pinned ? 'Unpin chat' : 'Pin chat'}
                            </button>
                            <button
                              type="button"
                              className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-800 hover:bg-slate-50"
                              onClick={() => archiveChat(c.id)}
                            >
                              Archive
                            </button>
                            <div className="my-1 h-px bg-slate-200" />
                            <button
                              type="button"
                              className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
                              onClick={() => deleteChat(c.id)}
                            >
                              Delete
                            </button>
                          </div>
                        ) : null}
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 p-3">
              <div className={['flex items-center gap-3', sidebarOpen ? '' : 'justify-center'].join(' ')}>
                <div className="h-9 w-9 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                  <div className="flex h-full w-full items-center justify-center text-slate-500">
                    <svg
                      width="18"
                      height="18"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 21a8 8 0 0 0-16 0" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  </div>
                </div>
                <div className={sidebarOpen ? '' : 'hidden'}>
                  <div className="text-sm font-semibold text-slate-900">Guest</div>
                  <div className="text-xs text-slate-500">Save Energy Systems</div>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="flex h-full min-w-0 flex-1 flex-col bg-slate-50">
          <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/80 backdrop-blur">
            <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-2 px-4 py-3 sm:gap-3">
              <div className="text-sm font-semibold tracking-tight text-slate-900">SES Chat</div>
              <div className="text-[11px] text-slate-500 sm:ml-auto">
                Model: <span className="font-mono text-slate-700">{getOllamaModel()}</span>
                {sending ? <span className="text-[color:var(--ses-teal)]"> · Thinking…</span> : null}
              </div>
            </div>
          </header>

          <div
            ref={listRef}
            className="flex-1 overflow-auto bg-slate-50"
          >
            <div className="mx-auto w-full max-w-6xl px-4 py-6">
              <div className="space-y-6">
                {messages.map((m) => (
                  <div
                    key={m.id}
                    className={[
                      'flex gap-3',
                      m.role === 'user' ? 'justify-end' : 'justify-start',
                    ].join(' ')}
                  >
                    {m.role === 'assistant' ? (
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-white">
                        <img
                          src={sesLogo}
                          alt=""
                          className="h-full w-full object-contain p-1"
                        />
                      </div>
                    ) : null}

                    <div
                      className={[
                        'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-sm',
                        m.role === 'user'
                          ? 'bg-white border border-slate-200'
                          : 'bg-white border',
                      ].join(' ')}
                      style={m.role === 'assistant' ? accentBorder : undefined}
                    >
                      <div
                        className={[
                          'mb-1 text-[11px] font-semibold uppercase tracking-wide',
                          m.role === 'assistant' ? '' : 'text-slate-500',
                        ].join(' ')}
                        style={m.role === 'assistant' ? accent : undefined}
                      >
                        {m.role === 'user' ? 'You' : 'SES'}
                      </div>
                      <div className="whitespace-pre-wrap text-slate-900">
                        {m.role === 'assistant' ? stripMarkdown(m.content) : m.content}
                      </div>
                    </div>

                    {m.role === 'user' ? (
                      <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                        <div className="flex h-full w-full items-center justify-center text-slate-500">
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M20 21a8 8 0 0 0-16 0" />
                            <circle cx="12" cy="7" r="4" />
                          </svg>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white">
            <div className="mx-auto w-full max-w-6xl px-4 py-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm focus-within:ring-2 focus-within:ring-[color:var(--ses-teal)]/30 focus-within:ring-offset-2 focus-within:ring-offset-slate-50">
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        sendMessage()
                      }
                    }}
                    rows={1}
                    placeholder="Message SES Chat…"
                    className="max-h-40 flex-1 resize-none bg-transparent px-3 py-2 text-sm text-slate-900 outline-none"
                  />
                  <button
                    type="button"
                    onClick={sendMessage}
                    disabled={!canSend}
                    className={[
                      'inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold text-white',
                      'focus:outline-none focus:ring-2 focus:ring-[color:var(--ses-teal)]/25 focus:ring-offset-2 focus:ring-offset-white',
                      canSend
                        ? 'bg-[color:var(--ses-teal)] hover:brightness-95 active:brightness-90'
                        : 'bg-slate-300',
                    ].join(' ')}
                  >
                    Send
                  </button>
                </div>
              </div>
              <div className="mt-2 text-center text-[11px] text-slate-500">
                Press Enter to send • Shift+Enter for new line
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App

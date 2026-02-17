'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { callAIAgent, extractText } from '@/lib/aiAgent'
import { useLyzrAgentEvents } from '@/lib/lyzrAgentEvents'
import { AgentActivityPanel } from '@/components/AgentActivityPanel'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  RiRobot2Line,
  RiUserLine,
  RiAddLine,
  RiSendPlaneFill,
  RiMenuLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiChat1Line,
  RiRefreshLine,
  RiAlertLine,
  RiSignalWifiLine,
  RiSignalWifiOffLine,
} from 'react-icons/ri'

// ─── Constants ────────────────────────────────────────────────────────────────

const CHAT_AGENT_ID = '69942cebc194d78a6a0240a4'
const LS_CONVERSATIONS_KEY = 'simplechat_conversations'
const LS_USER_ID_KEY = 'simplechat_user_id'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  error?: boolean
}

interface Conversation {
  id: string
  title: string
  sessionId: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
}

function truncateText(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays === 0) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) {
    return d.toLocaleDateString('en-US', { weekday: 'short' })
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Markdown Renderer ───────────────────────────────────────────────────────

function formatInline(text: string): React.ReactNode {
  // Handle **bold** first
  const boldParts = text.split(/\*\*(.*?)\*\*/g)
  if (boldParts.length > 1) {
    return boldParts.map((part, i) =>
      i % 2 === 1 ? (
        <strong key={i} className="font-semibold">
          {part}
        </strong>
      ) : (
        <span key={i}>{formatInlineCode(part)}</span>
      )
    )
  }
  return formatInlineCode(text)
}

function formatInlineCode(text: string): React.ReactNode {
  const codeParts = text.split(/`([^`]+)`/g)
  if (codeParts.length === 1) return text
  return codeParts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="px-1.5 py-0.5 rounded bg-muted text-accent-foreground font-mono text-xs">
        {part}
      </code>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

function renderMarkdown(text: string): React.ReactNode {
  if (!text) return null
  let inCodeBlock = false
  let codeBlockLines: string[] = []
  const elements: React.ReactNode[] = []
  let keyIdx = 0

  const lines = text.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeBlockLines = []
        continue
      } else {
        inCodeBlock = false
        elements.push(
          <pre key={keyIdx++} className="p-3 rounded-lg bg-muted overflow-x-auto my-2">
            <code className="text-xs font-mono text-foreground leading-relaxed">{codeBlockLines.join('\n')}</code>
          </pre>
        )
        continue
      }
    }

    if (inCodeBlock) {
      codeBlockLines.push(line)
      continue
    }

    if (line.startsWith('### ')) {
      elements.push(<h4 key={keyIdx++} className="font-semibold text-sm mt-3 mb-1 text-foreground">{line.slice(4)}</h4>)
    } else if (line.startsWith('## ')) {
      elements.push(<h3 key={keyIdx++} className="font-semibold text-base mt-3 mb-1 text-foreground">{line.slice(3)}</h3>)
    } else if (line.startsWith('# ')) {
      elements.push(<h2 key={keyIdx++} className="font-bold text-lg mt-4 mb-2 text-foreground">{line.slice(2)}</h2>)
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={keyIdx++} className="ml-4 list-disc text-sm leading-relaxed">{formatInline(line.slice(2))}</li>)
    } else if (/^\d+\.\s/.test(line)) {
      elements.push(<li key={keyIdx++} className="ml-4 list-decimal text-sm leading-relaxed">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>)
    } else if (!line.trim()) {
      elements.push(<div key={keyIdx++} className="h-2" />)
    } else {
      elements.push(<p key={keyIdx++} className="text-sm leading-relaxed">{formatInline(line)}</p>)
    }
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockLines.length > 0) {
    elements.push(
      <pre key={keyIdx++} className="p-3 rounded-lg bg-muted overflow-x-auto my-2">
        <code className="text-xs font-mono text-foreground leading-relaxed">{codeBlockLines.join('\n')}</code>
      </pre>
    )
  }

  return <div className="space-y-1">{elements}</div>
}

// ─── Typing Indicator ─────────────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div className="flex items-end gap-3 max-w-[80%]">
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
        <RiRobot2Line className="w-4 h-4 text-accent-foreground" />
      </div>
      <div className="bg-secondary rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────

function WelcomeScreen({ onSendStarter }: { onSendStarter: (msg: string) => void }) {
  const starters = [
    'Tell me something interesting',
    'Help me brainstorm ideas',
    'Explain a complex topic simply',
  ]

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="text-center max-w-md space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-accent/20 flex items-center justify-center">
          <RiRobot2Line className="w-8 h-8 text-accent" />
        </div>
        <div className="space-y-2">
          <h2 className="font-serif text-2xl font-bold tracking-wide text-foreground">Welcome to SimpleChat</h2>
          <p className="text-sm text-muted-foreground leading-relaxed font-sans">Start a conversation with the AI assistant. Ask questions, brainstorm ideas, or explore any topic.</p>
        </div>
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-sans">Try a conversation starter</p>
          <div className="flex flex-col gap-2">
            {starters.map((starter) => (
              <button
                key={starter}
                onClick={() => onSendStarter(starter)}
                className="px-4 py-3 rounded-lg border border-border bg-card text-sm text-foreground hover:bg-secondary hover:border-accent/40 transition-all duration-200 text-left font-sans leading-relaxed"
              >
                {starter}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Chat Message Bubble ──────────────────────────────────────────────────────

function MessageBubble({ message, onRetry }: { message: ChatMessage; onRetry?: () => void }) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex items-end gap-3 max-w-[80%]', isUser ? 'ml-auto flex-row-reverse' : '')}>
      {!isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-accent flex items-center justify-center">
          <RiRobot2Line className="w-4 h-4 text-accent-foreground" />
        </div>
      )}
      {isUser && (
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <RiUserLine className="w-4 h-4 text-muted-foreground" />
        </div>
      )}
      <div
        className={cn(
          'rounded-2xl px-4 py-3',
          isUser ? 'bg-accent text-accent-foreground rounded-br-md' : 'bg-secondary text-secondary-foreground rounded-bl-md',
          message.error ? 'border border-destructive/50' : ''
        )}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap leading-relaxed font-sans">{message.content}</p>
        ) : (
          <div className="text-sm text-secondary-foreground font-sans">{renderMarkdown(message.content)}</div>
        )}
        {message.error && onRetry && (
          <div className="mt-2 flex items-center gap-2">
            <RiAlertLine className="w-3.5 h-3.5 text-destructive" />
            <span className="text-xs text-destructive">Failed to send.</span>
            <button onClick={onRetry} className="text-xs text-accent underline hover:no-underline flex items-center gap-1">
              <RiRefreshLine className="w-3 h-3" />
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sidebar Conversation Item ────────────────────────────────────────────────

function ConversationItem({
  conversation,
  isActive,
  onClick,
  onDelete,
}: {
  conversation: Conversation
  isActive: boolean
  onClick: () => void
  onDelete: (e: React.MouseEvent) => void
}) {
  const preview =
    conversation.messages.length > 0 ? truncateText(conversation.messages[0].content, 50) : 'New conversation'

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-3 rounded-lg transition-all duration-200 group relative',
        isActive ? 'bg-sidebar-accent border border-sidebar-border' : 'hover:bg-sidebar-accent/50'
      )}
    >
      <div className="flex items-start gap-2.5">
        <RiChat1Line className={cn('w-4 h-4 mt-0.5 flex-shrink-0', isActive ? 'text-sidebar-primary' : 'text-muted-foreground')} />
        <div className="flex-1 min-w-0">
          <p className={cn('text-sm font-medium truncate', isActive ? 'text-sidebar-foreground' : 'text-sidebar-foreground/80')}>{conversation.title}</p>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{preview}</p>
        </div>
        <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">{formatTime(conversation.updatedAt)}</span>
      </div>
      <button
        onClick={onDelete}
        className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-destructive/20 transition-opacity"
        title="Delete conversation"
      >
        <RiDeleteBinLine className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
      </button>
    </button>
  )
}

// ─── Agent Info Footer ────────────────────────────────────────────────────────

function AgentInfoFooter({ isActive }: { isActive: boolean }) {
  return (
    <div className="px-3 py-3 border-t border-sidebar-border">
      <div className="flex items-center gap-2">
        <div className={cn('w-2 h-2 rounded-full', isActive ? 'bg-accent animate-pulse' : 'bg-muted-foreground/40')} />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-sidebar-foreground truncate">Chat Agent</p>
          <p className="text-[10px] text-muted-foreground truncate">{isActive ? 'Processing...' : 'Ready'}</p>
        </div>
        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 border-sidebar-border text-muted-foreground">
          AI
        </Badge>
      </div>
    </div>
  )
}

// ─── Main Page Component ──────────────────────────────────────────────────────

export default function Page() {
  // ── State ───────────────────────────────────────────────────────────────────
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [userId, setUserId] = useState<string>('')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showActivityPanel, setShowActivityPanel] = useState(false)
  const [retryMessage, setRetryMessage] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const conversationsRef = useRef<Conversation[]>([])

  // Keep ref in sync
  useEffect(() => {
    conversationsRef.current = conversations
  }, [conversations])

  // ── Derived ─────────────────────────────────────────────────────────────────
  const activeConversation = conversations.find((c) => c.id === activeConversationId) ?? null
  const activeSessionId = activeConversation?.sessionId ?? null
  const messages = activeConversation?.messages ?? []

  // ── Agent Activity Monitoring ───────────────────────────────────────────────
  const agentActivity = useLyzrAgentEvents(activeSessionId)

  // ── Mount & Init ────────────────────────────────────────────────────────────
  useEffect(() => {
    setMounted(true)

    // Load or create user_id
    let storedUserId = ''
    try {
      storedUserId = localStorage.getItem(LS_USER_ID_KEY) ?? ''
    } catch {
      // localStorage unavailable
    }
    if (!storedUserId) {
      storedUserId = generateId()
      try {
        localStorage.setItem(LS_USER_ID_KEY, storedUserId)
      } catch {
        // ignore
      }
    }
    setUserId(storedUserId)

    // Load conversations
    try {
      const stored = localStorage.getItem(LS_CONVERSATIONS_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (Array.isArray(parsed) && parsed.length > 0) {
          setConversations(parsed)
          setActiveConversationId(parsed[0].id)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  // ── Persist conversations ───────────────────────────────────────────────────
  useEffect(() => {
    if (!mounted) return
    try {
      localStorage.setItem(LS_CONVERSATIONS_KEY, JSON.stringify(conversations))
    } catch {
      // ignore
    }
  }, [conversations, mounted])

  // ── Auto-scroll ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, isLoading])

  // ── Create a new conversation ───────────────────────────────────────────────
  const createNewConversation = useCallback((): Conversation => {
    const now = Date.now()
    const newConvo: Conversation = {
      id: generateId(),
      title: 'New Chat',
      sessionId: generateId(),
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    setConversations((prev) => [newConvo, ...prev])
    setActiveConversationId(newConvo.id)
    setSidebarOpen(false)
    return newConvo
  }, [])

  // ── Send message to agent ───────────────────────────────────────────────────
  const sendMessage = useCallback(
    async (messageText: string, conversationOverride?: Conversation) => {
      const trimmed = messageText.trim()
      if (!trimmed || isLoading) return

      setRetryMessage(null)

      // Determine which conversation to use
      let targetConvo = conversationOverride ?? activeConversation
      if (!targetConvo) {
        targetConvo = createNewConversation()
      }

      const targetConvoId = targetConvo.id
      const targetSessionId = targetConvo.sessionId

      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: trimmed,
        timestamp: Date.now(),
      }

      // Derive title from first user message
      const isFirstMessage = targetConvo.messages.length === 0
      const newTitle = isFirstMessage ? truncateText(trimmed, 40) : targetConvo.title

      // Add user message to conversation
      setConversations((prev) =>
        prev.map((c) =>
          c.id === targetConvoId
            ? { ...c, title: newTitle, messages: [...c.messages, userMsg], updatedAt: Date.now() }
            : c
        )
      )

      setInputValue('')
      setIsLoading(true)
      agentActivity.setProcessing(true)

      // Reset textarea height
      if (inputRef.current) {
        inputRef.current.style.height = 'auto'
      }

      try {
        const result = await callAIAgent(trimmed, CHAT_AGENT_ID, {
          user_id: userId,
          session_id: targetSessionId,
        })

        let responseText = ''

        if (result.success) {
          // Try extractText first (handles many edge cases)
          responseText = extractText(result.response)

          // Fallback: direct accessor for this agent's schema
          if (!responseText && result.response?.result?.response) {
            responseText = result.response.result.response
          }

          // Final fallback
          if (!responseText) {
            responseText = result.response?.message || 'I received your message but had trouble generating a response.'
          }
        }

        const assistantMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: responseText || 'Something went wrong. Please try again.',
          timestamp: Date.now(),
          error: !result.success,
        }

        if (!result.success) {
          setRetryMessage(trimmed)
        }

        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvoId ? { ...c, messages: [...c.messages, assistantMsg], updatedAt: Date.now() } : c
          )
        )
      } catch {
        const errorMsg: ChatMessage = {
          id: generateId(),
          role: 'assistant',
          content: 'A network error occurred. Please check your connection and try again.',
          timestamp: Date.now(),
          error: true,
        }
        setRetryMessage(trimmed)
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvoId ? { ...c, messages: [...c.messages, errorMsg], updatedAt: Date.now() } : c
          )
        )
      } finally {
        setIsLoading(false)
        agentActivity.setProcessing(false)
      }
    },
    [activeConversation, isLoading, userId, createNewConversation, agentActivity]
  )

  // ── Handle enter key ───────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(inputValue)
    }
  }

  // ── Delete conversation ─────────────────────────────────────────────────────
  const deleteConversation = (convoId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== convoId)
      if (activeConversationId === convoId) {
        setActiveConversationId(remaining.length > 0 ? remaining[0].id : null)
      }
      return remaining
    })
  }

  // ── Retry failed message ────────────────────────────────────────────────────
  const handleRetry = () => {
    if (retryMessage) {
      sendMessage(retryMessage)
    }
  }

  // ── Handle conversation starter click ───────────────────────────────────────
  const handleStarterClick = (msg: string) => {
    let targetConvo = activeConversation
    if (!targetConvo || targetConvo.messages.length > 0) {
      targetConvo = createNewConversation()
    }
    sendMessage(msg, targetConvo)
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  if (!mounted) {
    return (
      <div className="h-screen w-screen bg-background flex items-center justify-center">
        <div className="flex items-center gap-3">
          <div className="w-3 h-3 rounded-full bg-accent animate-pulse" />
          <span className="text-sm text-muted-foreground font-sans">Loading...</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-background flex overflow-hidden">
      {/* ── Mobile Sidebar Overlay ─────────────────────────────────────────── */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 md:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside
        className={cn(
          'flex flex-col h-full border-r border-sidebar-border w-[280px] flex-shrink-0 transition-transform duration-300 z-40',
          'fixed md:relative',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
        style={{ backgroundColor: 'hsl(var(--sidebar-background))' }}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-4">
          <h1 className="font-serif text-lg font-bold tracking-wide text-sidebar-foreground">SimpleChat</h1>
          <button className="md:hidden p-1 rounded hover:bg-sidebar-accent" onClick={() => setSidebarOpen(false)}>
            <RiCloseLine className="w-5 h-5 text-sidebar-foreground" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="px-3 pb-3">
          <Button
            onClick={() => createNewConversation()}
            className="w-full justify-start gap-2 bg-accent text-accent-foreground hover:bg-accent/80 font-sans"
            size="sm"
          >
            <RiAddLine className="w-4 h-4" />
            New Chat
          </Button>
        </div>

        <Separator className="bg-sidebar-border" />

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
          {conversations.length === 0 ? (
            <div className="text-center py-8">
              <RiChat1Line className="w-8 h-8 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground font-sans">No conversations yet</p>
            </div>
          ) : (
            conversations.map((convo) => (
              <ConversationItem
                key={convo.id}
                conversation={convo}
                isActive={convo.id === activeConversationId}
                onClick={() => {
                  setActiveConversationId(convo.id)
                  setSidebarOpen(false)
                }}
                onDelete={(e) => deleteConversation(convo.id, e)}
              />
            ))
          )}
        </div>

        {/* Agent Activity Toggle */}
        <div className="px-3 py-2 border-t border-sidebar-border">
          <button
            onClick={() => setShowActivityPanel((prev) => !prev)}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-sans text-muted-foreground hover:bg-sidebar-accent transition-colors"
          >
            {agentActivity.isConnected ? (
              <RiSignalWifiLine className="w-3.5 h-3.5 text-accent" />
            ) : (
              <RiSignalWifiOffLine className="w-3.5 h-3.5" />
            )}
            <span>Agent Activity</span>
            {showActivityPanel && (
              <Badge variant="outline" className="ml-auto text-[9px] px-1 py-0 h-4 border-sidebar-border">
                ON
              </Badge>
            )}
          </button>
        </div>

        {/* Agent Info */}
        <AgentInfoFooter isActive={isLoading} />
      </aside>

      {/* ── Main Chat Area ─────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col h-full min-w-0">
        {/* Chat Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-card flex-shrink-0">
          <button className="md:hidden p-1.5 rounded-lg hover:bg-secondary" onClick={() => setSidebarOpen(true)}>
            <RiMenuLine className="w-5 h-5 text-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-serif font-semibold tracking-wide text-foreground truncate">
              {activeConversation?.title ?? 'New Chat'}
            </h2>
            {activeConversation && activeConversation.messages.length > 0 && (
              <p className="text-[11px] text-muted-foreground font-sans">
                {activeConversation.messages.length} message{activeConversation.messages.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          {isLoading && (
            <Badge variant="outline" className="text-[10px] px-2 py-0.5 border-accent text-accent animate-pulse">
              Thinking...
            </Badge>
          )}
        </div>

        {/* Chat Content */}
        <div className="flex-1 flex min-h-0">
          {/* Messages Area */}
          <div className="flex-1 flex flex-col min-h-0">
            {!activeConversation || activeConversation.messages.length === 0 ? (
              <WelcomeScreen onSendStarter={handleStarterClick} />
            ) : (
              <div className="flex-1 overflow-y-auto px-4 py-6 space-y-6">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} onRetry={msg.error ? handleRetry : undefined} />
                ))}
                {isLoading && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            )}

            {/* Input Bar */}
            <div className="flex-shrink-0 border-t border-border bg-card p-4">
              <div className="flex items-end gap-3 max-w-3xl mx-auto">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a message..."
                    disabled={isLoading}
                    rows={1}
                    className="w-full resize-none rounded-xl border border-border bg-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground font-sans leading-relaxed focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed max-h-32 overflow-y-auto"
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement
                      target.style.height = 'auto'
                      target.style.height = Math.min(target.scrollHeight, 128) + 'px'
                    }}
                  />
                </div>
                <Button
                  onClick={() => sendMessage(inputValue)}
                  disabled={isLoading || !inputValue.trim()}
                  size="icon"
                  className="rounded-xl w-11 h-11 bg-accent text-accent-foreground hover:bg-accent/80 disabled:opacity-40 flex-shrink-0"
                >
                  {isLoading ? (
                    <div className="w-4 h-4 border-2 border-accent-foreground/30 border-t-accent-foreground rounded-full animate-spin" />
                  ) : (
                    <RiSendPlaneFill className="w-5 h-5" />
                  )}
                </Button>
              </div>
              <p className="text-[10px] text-muted-foreground text-center mt-2 font-sans">Press Enter to send, Shift+Enter for a new line</p>
            </div>
          </div>

          {/* Agent Activity Panel */}
          {showActivityPanel && (
            <div className="hidden lg:flex w-[320px] border-l border-border flex-shrink-0">
              <AgentActivityPanel
                isConnected={agentActivity.isConnected}
                events={agentActivity.events}
                thinkingEvents={agentActivity.thinkingEvents}
                lastThinkingMessage={agentActivity.lastThinkingMessage}
                activeAgentId={agentActivity.activeAgentId}
                activeAgentName={agentActivity.activeAgentName}
                isProcessing={agentActivity.isProcessing}
                className="w-full rounded-none border-0"
              />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

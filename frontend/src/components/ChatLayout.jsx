import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import {
  Send, Plus, Trash2, ThumbsUp, ThumbsDown, Settings2,
  MessageSquare, FileText, BookOpen, Zap, LogOut, Menu, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import clsx from 'clsx'
import { chatApi } from '../api'
import { useChatStore, useCourseStore, useAuthStore } from '../store'
import { useIsMobile } from '../hooks/useMediaQuery'
import { MessageSkeleton } from './shared/Skeleton'

const MODES = [
  { id: 'normal',   label: 'Normal',   desc: 'Balanced answers' },
  { id: 'strict',   label: 'Strict',   desc: 'Sources only' },
  { id: 'tutor',    label: 'Tutor',    desc: 'Explain & guide' },
  { id: 'exam',     label: 'Exam',     desc: 'Concise answers' },
  { id: 'revision', label: 'Revision', desc: 'Study notes' },
]

const FORMATS = ['text', 'bullets', 'table', 'flashcards', 'quiz', 'summary']

const SUGGESTIONS = [
  { icon: '📖', title: 'Explain the main concepts', desc: 'Get a clear overview of key topics' },
  { icon: '🃏', title: 'Generate flashcards', desc: 'Create study cards from your notes' },
  { icon: '🔢', title: 'What formulas are covered?', desc: 'Extract equations and formulas' },
  { icon: '📝', title: 'Create a quiz', desc: 'Test your knowledge with questions' },
]

const appNavItems = [
  { to: '/documents', icon: FileText, label: 'Documents' },
  { to: '/courses',   icon: BookOpen, label: 'Courses' },
  { to: '/study',     icon: Zap,      label: 'Study' },
]

const mobileNavItems = [
  { to: '/chat',      icon: MessageSquare, label: 'Chat' },
  { to: '/documents', icon: FileText,      label: 'Documents' },
  { to: '/courses',   icon: BookOpen,      label: 'Courses' },
  { to: '/study',     icon: Zap,           label: 'Study' },
]

const CitationPanel = memo(function CitationPanel({ citations }) {
  if (!citations?.length) return null
  return (
    <div style={{ marginTop: '.75rem', borderTop: '1px solid var(--border)', paddingTop: '.75rem' }}>
      <div style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '.5rem', textTransform: 'uppercase', letterSpacing: '.06em' }}>Sources</div>
      <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
        {citations.map((c) => (
          <div key={c.index} className="tooltip-wrap">
            <span className="citation-chip">
              <span className="citation-num">{c.index}</span>
              <span className="truncate" style={{ maxWidth: 120 }}>{c.filename}</span>
              {c.page_number && <span style={{ color: 'var(--text-muted)', fontSize: '.65rem' }}>p.{c.page_number}</span>}
            </span>
            {c.content_preview && (
              <span className="tooltip-text" style={{ maxWidth: 280, whiteSpace: 'normal', bottom: 'calc(100% + 8px)' }}>
                {c.content_preview}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
})

const MessageBubble = memo(function MessageBubble({ msg, onFeedback }) {
  const isUser = msg.role === 'user'
  return (
    <div className={clsx('message-wrap', isUser && 'user')}>
      <div className={clsx('message-avatar', isUser ? 'avatar-user' : 'avatar-ai')}>
        {isUser ? '👤' : '🎓'}
      </div>
      <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
        <div className={clsx('message-bubble', isUser ? 'bubble-user' : 'bubble-ai')}>
          {isUser ? (
            <p style={{ fontSize: '.9375rem' }}>{msg.content}</p>
          ) : (
            <>
              {msg.metadata?.mode && msg.metadata.mode !== 'normal' && (
                <span className="badge badge-accent" style={{ marginBottom: '.5rem', display: 'inline-flex' }}>{msg.metadata.mode}</span>
              )}
              <div className="md-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
              </div>
              {msg.confidence != null && (
                <div style={{ marginTop: '.75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>Confidence</span>
                  <div className="conf-bar" style={{ flex: 1 }}>
                    <div className="conf-fill" style={{
                      width: `${Math.round(msg.confidence * 100)}%`,
                      background: msg.confidence > 0.7 ? 'var(--emerald)' : msg.confidence > 0.4 ? 'var(--amber)' : 'var(--rose)',
                    }} />
                  </div>
                  <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{Math.round(msg.confidence * 100)}%</span>
                </div>
              )}
              <CitationPanel citations={msg.citations} />
              {msg.metadata?.follow_up_questions?.length > 0 && (
                <div className="flex" style={{ gap: '.4rem', flexWrap: 'wrap', marginTop: '.75rem' }}>
                  {msg.metadata.follow_up_questions.map((q, i) => (
                    <button key={i} style={{
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 99,
                      padding: '.3rem .75rem', fontSize: '.75rem', color: 'var(--text-secondary)',
                      cursor: 'pointer', transition: 'all .15s',
                    }}>{q}</button>
                  ))}
                </div>
              )}
              {!isUser && (
                <div className="flex gap-2" style={{ marginTop: '.6rem' }}>
                  <button className="btn btn-ghost btn-icon" style={{ padding: '.25rem', borderRadius: '6px' }} onClick={() => onFeedback(msg.id, 'good')} title="Good answer"><ThumbsUp size={13} /></button>
                  <button className="btn btn-ghost btn-icon" style={{ padding: '.25rem', borderRadius: '6px' }} onClick={() => onFeedback(msg.id, 'bad')} title="Bad answer"><ThumbsDown size={13} /></button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
})

function groupConversations(conversations) {
  const groups = [
    { label: 'Today', items: [] },
    { label: 'Yesterday', items: [] },
    { label: 'This Week', items: [] },
    { label: 'Older', items: [] },
  ]
  const now = new Date()
  conversations.forEach(c => {
    const d = new Date(c.created_at || c.updated_at || Date.now())
    const diff = (now - d) / (1000 * 60 * 60 * 24)
    if (diff < 1) groups[0].items.push(c)
    else if (diff < 2) groups[1].items.push(c)
    else if (diff < 7) groups[2].items.push(c)
    else groups[3].items.push(c)
  })
  return groups
}

function ChatSidebar({ conversations, activeConversation, onSelect, onNew, onDelete, user, onLogout }) {
  const groups = groupConversations(conversations)

  const navItemStyle = (isActive) => ({
    display: 'flex', alignItems: 'center', gap: '.65rem',
    padding: '.55rem .75rem', borderRadius: 'var(--radius)',
    background: isActive ? 'rgba(255,255,255,.08)' : 'transparent',
    border: isActive ? '1px solid rgba(255,255,255,.2)' : '1px solid transparent',
    borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
    color: isActive ? 'var(--accent-light)' : 'var(--text-secondary)',
    transition: 'all .15s', cursor: 'pointer',
  })

  return (
    <div className="chat-sidebar-inner">
      <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '.75rem', justifyContent: 'center' }}>
        <div className="glow-pulse" style={{
          width: 36, height: 36, borderRadius: 12,
          background: 'var(--grad-brand)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.1rem', boxShadow: 'var(--shadow-glow)', flexShrink: 0,
        }}>🎓</div>
        <NavLink to="/chat" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="brand-text" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', letterSpacing: '-.02em' }}>CollegeRAG</span>
        </NavLink>
      </div>

      <nav style={{ padding: '.5rem', display: 'flex', flexDirection: 'column', gap: '.1rem', borderBottom: '1px solid var(--glass-border)' }}>
        <NavLink to="/chat" style={{ textDecoration: 'none' }}>
          {({ isActive }) => (
            <div style={navItemStyle(isActive)}>
              <MessageSquare size={16} style={{ flexShrink: 0 }} />
              <span className="nav-label" style={{ fontSize: '.875rem', fontWeight: isActive ? 600 : 400 }}>Chat</span>
            </div>
          )}
        </NavLink>
        {appNavItems.map(item => (
          <NavLink key={item.to} to={item.to} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <div style={navItemStyle(isActive)}>
                <item.icon size={16} style={{ flexShrink: 0 }} />
                <span className="nav-label" style={{ fontSize: '.875rem', fontWeight: isActive ? 600 : 400 }}>{item.label}</span>
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '.65rem .75rem' }}>
        <button className="btn btn-primary new-chat-btn w-full" style={{ fontSize: '.8125rem' }} onClick={onNew}>
          <Plus size={14} />
          <span className="new-chat-text">New Chat</span>
        </button>
      </div>

      <div className="conv-section" style={{ flex: 1, overflowY: 'auto', padding: '0 .5rem .5rem' }}>
        {groups.map(({ label, items }) => items.length > 0 && (
          <div key={label}>
            <div style={{ fontSize: '.625rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', padding: '.5rem .75rem .25rem' }}>
              {label}
            </div>
            {items.map(conv => (
              <div key={conv.id} onClick={() => onSelect(conv)} style={{
                padding: '.45rem .75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: '.1rem',
                background: activeConversation?.id === conv.id ? 'rgba(255,255,255,.08)' : 'transparent',
                borderLeft: activeConversation?.id === conv.id ? '2px solid var(--accent)' : '2px solid transparent',
                display: 'flex', alignItems: 'center', gap: '.5rem', transition: 'all .15s',
              }}>
                <span style={{ flex: 1, fontSize: '.8125rem', color: activeConversation?.id === conv.id ? 'var(--accent-light)' : 'var(--text-secondary)' }} className="truncate">
                  {conv.title}
                </span>
                <button className="btn btn-icon" style={{ opacity: 0.4, padding: '.15rem', flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}>
                  <Trash2 size={11} />
                </button>
              </div>
            ))}
          </div>
        ))}
        {conversations.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '.8125rem', textAlign: 'center', padding: '2rem .5rem' }}>
            No conversations yet.<br />Ask a question to start!
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--glass-border)', padding: '.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <div style={{
            width: 30, height: 30, borderRadius: '50%',
            background: 'var(--grad-brand)', padding: 2,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: '50%',
              background: 'var(--bg-surface)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '.65rem', fontWeight: 700, color: 'var(--accent-light)',
            }}>{user?.full_name?.[0] || 'U'}</div>
          </div>
          <span className="user-name truncate" style={{ fontSize: '.8125rem', color: 'var(--text-secondary)' }}>{user?.full_name || 'User'}</span>
        </div>
        <button className="btn btn-ghost btn-icon" onClick={onLogout} style={{ padding: '.4rem', background: 'transparent' }}>
          <LogOut size={14} />
        </button>
      </div>
    </div>
  )
}

function ChatHeader({ activeConversation, activeCourse, mode, onSetMode, showFormats, onToggleFormats, onToggleSidebar, sidebarOpen }) {
  return (
    <div style={{
      padding: '.75rem 1rem', display: 'flex', alignItems: 'center', gap: '.65rem',
      background: 'rgba(17,17,17,0.5)', backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)', borderBottom: '1px solid var(--glass-border)',
    }}>
      {onToggleSidebar && (
        <button className="btn btn-ghost btn-icon" onClick={onToggleSidebar} style={{ padding: '.4rem', flexShrink: 0 }}>
          {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
        </button>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem' }} className="truncate">
          {activeConversation ? activeConversation.title : '✨ Ask Anything'}
        </h2>
        {activeCourse && <span className="badge badge-accent" style={{ marginTop: '.2rem' }}>{activeCourse.icon} {activeCourse.name}</span>}
      </div>
      <div className="hide-mobile flex gap-1" style={{
        background: 'var(--bg-elevated)', borderRadius: 99, padding: '.2rem',
        border: '1px solid var(--border)', overflowX: 'auto', maxWidth: '100%',
      }}>
        {MODES.map(m => (
          <button key={m.id} className={clsx('mode-pill', mode === m.id && 'active')}
            onClick={() => onSetMode(m.id)}
            style={{ padding: '.25rem .65rem', fontSize: '.75rem', whiteSpace: 'nowrap' }}>
            {m.label}
          </button>
        ))}
      </div>
      <button className="btn btn-ghost btn-icon" onClick={onToggleFormats} style={{ padding: '.4rem', flexShrink: 0 }}>
        <Settings2 size={15} />
      </button>
    </div>
  )
}

function FormatsToolbar({ show, outputFormat, onSetFormat }) {
  return (
    <div style={{
      overflow: 'hidden', maxHeight: show ? 50 : 0, transition: 'max-height .25s var(--ease)',
      background: 'rgba(17,17,17,0.3)',
      borderBottom: show ? '1px solid var(--glass-border)' : '1px solid transparent',
    }}>
      <div className="flex gap-2" style={{ padding: '.5rem 1.5rem', overflowX: 'auto' }}>
        {FORMATS.map(f => (
          <button key={f} className={clsx('mode-pill', outputFormat === f && 'active')} onClick={() => onSetFormat(f)}>{f}</button>
        ))}
      </div>
    </div>
  )
}

function EmptyChatState({ onSuggestionClick }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '1rem', padding: '1rem' }}>
      <div className="float-anim" style={{ fontSize: '3.5rem' }}>🎓</div>
      <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.5rem', fontWeight: 700, textAlign: 'center' }}>
        Ask anything from your <span className="gradient-text">study materials</span>
      </h2>
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 400 }}>
        Upload documents first, then ask questions. Get cited, accurate answers with page references.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', maxWidth: 500, marginTop: '.5rem' }}>
        {SUGGESTIONS.map(s => (
          <div key={s.title} onClick={() => onSuggestionClick(s.title)}
            className="bento-card" style={{ padding: '1rem', cursor: 'pointer', textAlign: 'center' }}>
            <div style={{ fontSize: '1.5rem', marginBottom: '.35rem' }}>{s.icon}</div>
            <div style={{ fontWeight: 600, fontSize: '.8125rem' }}>{s.title}</div>
            <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.15rem' }}>{s.desc}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatInput({ input, setInput, loading, onSend, inputRef }) {
  return (
    <div style={{
      borderTop: '1px solid var(--glass-border)', padding: '1rem 1.5rem',
      background: 'rgba(17,17,17,0.6)', backdropFilter: 'blur(16px)',
      WebkitBackdropFilter: 'blur(16px)',
    }}>
      <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-end', maxWidth: 900, margin: '0 auto', position: 'relative' }}>
        <textarea ref={inputRef} className="input"
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
          placeholder="Ask a question from your documents..."
          style={{ resize: 'none', minHeight: 52, maxHeight: 140, lineHeight: 1.5, paddingTop: '.7rem', paddingRight: '3.5rem' }}
          rows={2}
        />
        <button className="btn btn-primary" onClick={onSend}
          disabled={loading || !input.trim()}
          style={{ padding: '.75rem', borderRadius: '50%', flexShrink: 0, position: 'absolute', right: '.5rem', bottom: '.5rem' }}>
          <Send size={16} />
        </button>
      </div>
      <p style={{ textAlign: 'center', fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.5rem' }}>
        Answers are grounded in your uploaded documents
      </p>
    </div>
  )
}

function MobileNavItem({ to, icon: Icon, label }) {
  return (
    <NavLink to={to} className={({ isActive }) => isActive ? 'active' : ''}>
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  )
}

export default function ChatLayout() {
  const { user, logout } = useAuthStore()
  const {
    conversations, activeConversation, messages, loading, mode, outputFormat,
    setConversations, setActiveConversation, setMessages, addMessage, setLoading, setMode, setOutputFormat,
  } = useChatStore()
  const { activeCourse } = useCourseStore()
  const [input, setInput] = useState('')
  const [showFormats, setShowFormats] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  useEffect(() => { loadConversations() }, [])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  const loadConversations = useCallback(async () => {
    try { const r = await chatApi.conversations(); setConversations(r.data) } catch {}
  }, [setConversations])

  const loadMessages = useCallback(async (convId) => {
    try { const r = await chatApi.messages(convId); setMessages(r.data) } catch {}
  }, [setMessages])

  const selectConversation = useCallback(async (conv) => {
    setActiveConversation(conv)
    await loadMessages(conv.id)
    if (isMobile) setSidebarOpen(false)
  }, [setActiveConversation, loadMessages, isMobile])

  const newConversation = useCallback(() => {
    setActiveConversation(null)
    setMessages([])
    if (isMobile) setSidebarOpen(false)
  }, [setActiveConversation, setMessages, isMobile])

  const sendMessage = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    setLoading(true)

    const userMsg = { id: Date.now(), role: 'user', content: text }
    addMessage(userMsg)

    try {
      const r = await chatApi.send({
        message: text,
        conversation_id: activeConversation?.id || null,
        course_id: activeCourse?.id || null,
        mode,
        output_format: outputFormat,
        generate_follow_ups: true,
      })
      const d = r.data
      if (!activeConversation) {
        setActiveConversation({ id: d.conversation_id, title: text.slice(0, 60) })
        loadConversations()
      }
      addMessage({
        id: d.message_id, role: 'assistant', content: d.answer,
        citations: d.citations, confidence: d.confidence,
        latency_ms: d.latency_ms,
        metadata: { mode: d.mode, follow_up_questions: d.follow_up_questions, chunks_retrieved: d.chunks_retrieved },
      })
    } catch {
      addMessage({ id: Date.now(), role: 'assistant', content: '⚠️ Failed to get a response. Please try again.' })
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }, [input, loading, activeConversation, activeCourse, mode, outputFormat, setLoading, addMessage, setActiveConversation, loadConversations])

  const handleFeedback = useCallback(async (msgId, rating) => {
    try { await chatApi.messageFeedback(msgId, rating) } catch {}
  }, [])

  const deleteConversation = useCallback(async (convId) => {
    try {
      await chatApi.deleteConversation(convId)
      setConversations(conversations.filter(c => c.id !== convId))
      if (activeConversation?.id === convId) newConversation()
    } catch {}
  }, [conversations, activeConversation, setConversations, newConversation])

  const handleLogout = useCallback(() => { logout(); navigate('/login') }, [logout, navigate])

  return (
    <div className="chat-layout">
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      <div className={`chat-sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />

      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="hide-desktop" style={{ display: 'flex', justifyContent: 'flex-end', padding: '.5rem' }}>
          <button className="btn btn-ghost btn-icon" onClick={() => setSidebarOpen(false)}>
            <X size={16} />
          </button>
        </div>
        <ChatSidebar
          conversations={conversations}
          activeConversation={activeConversation}
          onSelect={selectConversation}
          onNew={newConversation}
          onDelete={deleteConversation}
          user={user}
          onLogout={handleLogout}
        />
      </aside>

      <div className="chat-main">
        <ChatHeader
          activeConversation={activeConversation}
          activeCourse={activeCourse}
          mode={mode}
          onSetMode={setMode}
          showFormats={showFormats}
          onToggleFormats={() => setShowFormats(!showFormats)}
          onToggleSidebar={isMobile ? () => setSidebarOpen(v => !v) : undefined}
          sidebarOpen={sidebarOpen}
        />
        <FormatsToolbar show={showFormats} outputFormat={outputFormat} onSetFormat={setOutputFormat} />
        <div className="chat-messages">
          {messages.length === 0 && !loading && <EmptyChatState onSuggestionClick={(t) => setInput(t)} />}
          {messages.map(msg => <MessageBubble key={msg.id} msg={msg} onFeedback={handleFeedback} />)}
          {loading && <MessageSkeleton />}
          <div ref={messagesEndRef} />
        </div>
        <ChatInput input={input} setInput={setInput} loading={loading} onSend={sendMessage} inputRef={inputRef} />
      </div>

      {isMobile && (
        <nav className="mobile-bottom-nav">
          {mobileNavItems.map(item => (
            <MobileNavItem key={item.to} {...item} />
          ))}
        </nav>
      )}
    </div>
  )
}

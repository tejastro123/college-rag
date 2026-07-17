import { useState, useEffect, useRef, useCallback, memo } from 'react'
import { useNavigate, NavLink } from 'react-router-dom'
import {
  Send, Plus, Trash2, ThumbsUp, ThumbsDown, Settings2,
  MessageSquare, FileText, BookOpen, Zap, LogOut, Menu, X,
  ChevronLeft, ChevronRight, Settings, User, Sparkles, Palette, HelpCircle
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import clsx from 'clsx'
import { chatApi } from '../api'
import { useChatStore, useCourseStore, useAuthStore } from '../store'
import { useIsMobile } from '../hooks/useMediaQuery'
import { MessageSkeleton } from './shared/Skeleton'
import ThemeToggle from './shared/ThemeToggle'

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

function ChatSidebar({
  conversations, activeConversation, onSelect, onNew, onDelete, user, onLogout,
  isCollapsed, toggleCollapse, popoverOpen, setPopoverOpen
}) {
  const groups = groupConversations(conversations)
  const navigate = useNavigate()

  return (
    <div className="chat-sidebar-inner">
      <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '.75rem', justifyContent: 'center', flexShrink: 0 }}>
        <div className="glow-pulse" style={{
          width: 36, height: 36, borderRadius: 12,
          background: 'var(--grad-brand)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.1rem', boxShadow: 'var(--shadow-glow)', flexShrink: 0,
        }}>🎓</div>
        {!isCollapsed && (
          <NavLink to="/chat" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="brand-text" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1rem', letterSpacing: '-.02em' }}>CollegeRAG</span>
          </NavLink>
        )}
      </div>

      <nav style={{ padding: '.5rem', display: 'flex', flexDirection: 'column', gap: '.1rem', borderBottom: '1px solid var(--glass-border)' }}>
        <NavLink to="/chat" style={{ textDecoration: 'none' }}>
          {({ isActive }) => (
            <div className={`tooltip-wrap nav-item-inner ${isActive ? 'active' : ''}`} style={{ justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '.55rem 0' : '.55rem .75rem' }}>
              <MessageSquare size={16} style={{ flexShrink: 0 }} />
              {!isCollapsed && <span className="nav-label" style={{ fontSize: '.875rem', fontWeight: isActive ? 600 : 400 }}>Chat</span>}
              {isCollapsed && <span className="sidebar-tooltip">Chat</span>}
            </div>
          )}
        </NavLink>
        {appNavItems.map(item => (
          <NavLink key={item.to} to={item.to} style={{ textDecoration: 'none' }}>
            {({ isActive }) => (
              <div className={`tooltip-wrap nav-item-inner ${isActive ? 'active' : ''}`} style={{ justifyContent: isCollapsed ? 'center' : 'flex-start', padding: isCollapsed ? '.55rem 0' : '.55rem .75rem' }}>
                <item.icon size={16} style={{ flexShrink: 0 }} />
                {!isCollapsed && <span className="nav-label" style={{ fontSize: '.875rem', fontWeight: isActive ? 600 : 400 }}>{item.label}</span>}
                {isCollapsed && <span className="sidebar-tooltip">{item.label}</span>}
              </div>
            )}
          </NavLink>
        ))}
      </nav>

      <div style={{ padding: '.65rem .75rem' }}>
        <div className="tooltip-wrap" style={{ width: '100%' }}>
          <button className="btn btn-primary new-chat-btn w-full" style={{ fontSize: '.8125rem', justifyContent: 'center', padding: isCollapsed ? '.5rem 0' : undefined }} onClick={onNew}>
            <Plus size={14} style={{ flexShrink: 0 }} />
            {!isCollapsed && <span className="new-chat-text">New Chat</span>}
          </button>
          {isCollapsed && <span className="sidebar-tooltip">New Chat</span>}
        </div>
      </div>

      <div className="conv-section" style={{ flex: 1, overflowY: 'auto', padding: '0 .5rem .5rem' }}>
        {groups.map(({ label, items }) => items.length > 0 && (
          <div key={label}>
            {!isCollapsed && (
              <div style={{ fontSize: '.625rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.08em', padding: '.5rem .75rem .25rem' }}>
                {label}
              </div>
            )}
            {items.map(conv => (
              <div key={conv.id} className="tooltip-wrap" style={{ width: '100%' }}>
                <div onClick={() => onSelect(conv)} style={{
                  padding: isCollapsed ? '.5rem 0' : '.45rem .75rem', borderRadius: 'var(--radius-sm)', cursor: 'pointer', marginBottom: '.1rem',
                  background: activeConversation?.id === conv.id ? 'rgba(255,255,255,.08)' : 'transparent',
                  borderLeft: activeConversation?.id === conv.id ? '2px solid var(--accent)' : '2px solid transparent',
                  display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '.5rem', transition: 'all .15s',
                }}>
                  {isCollapsed ? (
                    <MessageSquare size={14} style={{ color: activeConversation?.id === conv.id ? 'var(--accent-light)' : 'var(--text-muted)' }} />
                  ) : (
                    <>
                      <span style={{ flex: 1, fontSize: '.8125rem', color: activeConversation?.id === conv.id ? 'var(--accent-light)' : 'var(--text-secondary)' }} className="truncate">
                        {conv.title}
                      </span>
                      <button className="btn btn-icon" style={{ opacity: 0.4, padding: '.15rem', flexShrink: 0 }} onClick={(e) => { e.stopPropagation(); onDelete(conv.id) }}>
                        <Trash2 size={11} />
                      </button>
                    </>
                  )}
                </div>
                {isCollapsed && <span className="sidebar-tooltip">{conv.title}</span>}
              </div>
            ))}
          </div>
        ))}
        {conversations.length === 0 && !isCollapsed && (
          <div style={{ color: 'var(--text-muted)', fontSize: '.8125rem', textAlign: 'center', padding: '2rem .5rem' }}>
            No conversations yet.<br />Ask a question to start!
          </div>
        )}
      </div>

      <div style={{ padding: '.5rem', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
        <ThemeToggle />
      </div>

      <div className="hide-mobile" style={{ padding: '0 .5rem', marginBottom: '.25rem' }}>
        <div className="tooltip-wrap" style={{ width: '100%' }}>
          <button
            onClick={toggleCollapse}
            className="nav-item-inner"
            style={{
              background: 'transparent', border: 'none', padding: '.5rem',
              justifyContent: isCollapsed ? 'center' : 'flex-start',
              color: 'var(--text-muted)'
            }}
          >
            {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
            {!isCollapsed && <span className="nav-label" style={{ fontSize: '.8125rem' }}>Collapse sidebar</span>}
          </button>
          <span className="sidebar-tooltip">{isCollapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '.5rem', flexShrink: 0, position: 'relative' }}>
        {/* User Popover Menu */}
        {popoverOpen && (
          <div className="user-popover" style={{ bottom: '55px' }}>
            <div className="user-popover-header" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=profile'); }}>
              <div className="user-popover-avatar">
                {user?.full_name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="user-popover-info">
                <span className="user-popover-username truncate">{user?.username || 'user'}</span>
                <span className="user-popover-subtext truncate">{user?.role || 'Go'}</span>
              </div>
              <ChevronRight size={14} className="user-popover-chevron" style={{ color: 'var(--text-muted)' }} />
            </div>
            <div className="user-popover-divider" />
            <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/billing'); }}>
              <Sparkles size={14} />
              <span>Upgrade plan</span>
            </button>
            <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=personalization'); }}>
              <Palette size={14} />
              <span>Personalization</span>
            </button>
            <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=profile'); }}>
              <User size={14} />
              <span>Profile</span>
            </button>
            <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=general'); }}>
              <Settings size={14} />
              <span>Settings</span>
            </button>
            <div className="user-popover-divider" />
            <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=help'); }}>
              <HelpCircle size={14} />
              <span>Help</span>
            </button>
            <button className="user-popover-item" onClick={() => { setPopoverOpen(false); onLogout(); }}>
              <LogOut size={14} />
              <span>Log out</span>
            </button>
          </div>
        )}

        {/* User Row Trigger */}
        <div className="tooltip-wrap" style={{ width: '100%' }}>
          <div className="sidebar-user-row" onClick={() => setPopoverOpen(!popoverOpen)}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: '#ec4899', // Pink avatar
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '.8rem', fontWeight: 700, color: 'white', flexShrink: 0
            }}>
              {user?.full_name?.[0]?.toUpperCase() || 'U'}
            </div>
            {!isCollapsed && (
              <>
                <div className="sidebar-user-info" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                  <span className="truncate" style={{ fontSize: '.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                    {user?.username || 'user'}
                  </span>
                  <span className="truncate" style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>
                    Go
                  </span>
                </div>
                <ChevronRight size={14} className="sidebar-user-chevron" style={{ color: 'var(--text-muted)', transform: popoverOpen ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }} />
              </>
            )}
          </div>
          <span className="sidebar-tooltip">
            {user?.full_name || 'User'}
          </span>
        </div>
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
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  useEffect(() => {
    if (!popoverOpen) return
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.user-popover') && !e.target.closest('.sidebar-user-row')) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [popoverOpen])

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

      <aside className={`chat-sidebar ${sidebarOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
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
          isCollapsed={isCollapsed}
          toggleCollapse={() => {
            setIsCollapsed(prev => {
              const next = !prev
              localStorage.setItem('sidebar-collapsed', String(next))
              return next
            })
          }}
          popoverOpen={popoverOpen}
          setPopoverOpen={setPopoverOpen}
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

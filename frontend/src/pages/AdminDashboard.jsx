import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'
import api from '../api'
import GlassCard from '../components/shared/GlassCard'
import AnimatedPage from '../components/shared/AnimatedPage'
import Modal from '../components/shared/Modal'
import { Skeleton } from '../components/shared/Skeleton'
import { useToast } from '../components/shared/Toast'
import { useAdminWS } from '../hooks/useAdminWS'
import {
  LayoutDashboard, Users, FileText, Building2, Shield, Activity,
  ChevronRight, Search, Download, Trash2, RefreshCw, Eye,
  MoreHorizontal, CheckCircle, XCircle, AlertTriangle, Clock,
  BookOpen, MessageSquare, Database, HardDrive, Hash, TrendingUp,
  ArrowUpRight, ArrowDownRight, ChevronDown, X, Filter,
  GraduationCap, MessageCircle, Bookmark, BarChart3,
  Wifi, WifiOff, Bell, BellOff, Zap, Radio, Package, DollarSign, TrendingDown, Cpu,
  Star, Flag, Target, Gauge, Edit2, Lock, ShieldAlert
} from 'lucide-react'

// ── Sidebar config ──────────────────────────────────────
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'realtime', label: 'Real-time', icon: Radio },
  { id: 'cost', label: 'Cost & Usage', icon: DollarSign },
  { id: 'quality', label: 'Quality', icon: Star },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'courses', label: 'Courses', icon: GraduationCap },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'organizations', label: 'Organizations', icon: Building2 },
  { id: 'security', label: 'Security/Access', icon: Lock },
  { id: 'audit', label: 'Audit Log', icon: Shield },
  { id: 'lifecycle', label: 'Data Lifecycle', icon: HardDrive },
  { id: 'search_vector', label: 'Search/Vector', icon: Search },
  { id: 'compliance', label: 'Compliance', icon: ShieldAlert },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'system', label: 'System', icon: Activity },
]

const PAGE_SIZES = [10, 25, 50, 100]

// ── Helpers ─────────────────────────────────────────────
const STATUS_COLORS = {
  active: { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  inactive: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
  suspended: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24' },
  ready: { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  indexed: { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  pending: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24' },
  processing: { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  failed: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
  student: { bg: 'rgba(96,165,250,0.15)', text: '#60a5fa' },
  ta: { bg: 'rgba(52,211,153,0.15)', text: '#34d399' },
  faculty: { bg: 'rgba(251,191,36,0.15)', text: '#fbbf24' },
  admin: { bg: 'rgba(239,68,68,0.15)', text: '#ef4444' },
  archived: { bg: 'rgba(156,163,175,0.15)', text: '#9ca3af' },
}

function statusStyle(status) {
  if (status && status.startsWith('processing:')) {
    return { background: 'rgba(96,165,250,0.15)', color: '#60a5fa' }
  }
  const c = STATUS_COLORS[status] || { bg: 'rgba(163,163,163,0.12)', text: '#a3a3a3' }
  return { background: c.bg, color: c.text }
}

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDate(d) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function Sparkline({ data, color, height = 32 }) {
  if (!data || data.length < 2) return null
  const max = Math.max(...data, 1)
  const min = Math.min(...data)
  const range = Math.max(max - min, 1)
  const w = 80
  const h = height
  const points = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`).join(' ')
  return (
    <svg width={w} height={h} style={{ flexShrink: 0 }}>
      <polyline fill="none" stroke={color || 'var(--accent)'} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  )
}

function MiniBar({ data, color, height = 40 }) {
  if (!data || data.length === 0) return null
  const max = Math.max(...data, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, flex: 1 }}>
      {data.map((v, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${(v / max) * 100}%`,
            background: color || 'var(--accent)',
            borderRadius: '2px 2px 0 0',
            opacity: 0.4 + (i / data.length) * 0.6,
            minHeight: v > 0 ? 2 : 0,
          }}
        />
      ))}
    </div>
  )
}

function DeltaBadge({ value, suffix }) {
  if (value === undefined || value === null) return null
  const isPos = value > 0
  const color = isPos ? '#34d399' : '#ef4444'
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: '.65rem', fontWeight: 600, color,
      padding: '1px 6px', borderRadius: 999,
      background: `${color}15`,
    }}>
      {isPos ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
      {Math.abs(value)}{suffix || '%'}
    </span>
  )
}

// ── KPICard ─────────────────────────────────────────────
function KPICard({ label, value, delta, trend, icon, color }) {
  return (
    <GlassCard style={{ padding: '1.125rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>{label}</span>
        {icon && <span style={{ color: color || 'var(--text-muted)', opacity: 0.5 }}>{icon}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '.5rem' }}>
        <span style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1 }}>{value}</span>
        {delta !== undefined && <DeltaBadge value={delta} />}
      </div>
      {trend && <Sparkline data={trend} color={color} />}
    </GlassCard>
  )
}

// ── SearchInput ─────────────────────────────────────────
function SearchInput({ value, onChange, placeholder }) {
  return (
    <div style={{ position: 'relative', flex: 1, maxWidth: 320 }}>
      <Search size={14} style={{ position: 'absolute', left: '.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
      <input
        value={value}
        onChange={onChange}
        placeholder={placeholder || 'Search...'}
        style={{
          width: '100%', padding: '.45rem .45rem .45rem 2rem',
          background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 'var(--radius)', fontSize: '.8125rem', color: 'var(--text-primary)',
          outline: 'none',
        }}
      />
    </div>
  )
}

// ── Pagination ──────────────────────────────────────────
function Pagination({ page, perPage, total, onPageChange, onPerPageChange }) {
  const totalPages = Math.ceil(total / perPage) || 1
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '1rem', gap: '1rem', flexWrap: 'wrap' }}>
      <span style={{ fontSize: '.8125rem', color: 'var(--text-muted)' }}>{total} total</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
        <select
          value={perPage}
          onChange={e => onPerPageChange(Number(e.target.value))}
          style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)', padding: '.3rem .5rem', fontSize: '.75rem', color: 'var(--text-primary)',
          }}
        >
          {PAGE_SIZES.map(s => <option key={s} value={s}>{s} / page</option>)}
        </select>
        <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
        <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="btn btn-ghost" style={{ padding: '.25rem .6rem', fontSize: '.75rem' }}>Prev</button>
        <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="btn btn-ghost" style={{ padding: '.25rem .6rem', fontSize: '.75rem' }}>Next</button>
      </div>
    </div>
  )
}

// ── UserDetailModal ─────────────────────────────────────
function UserDetailModal({ userId, onClose }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    api.get(`/admin/users/${userId}`).then(({ data }) => setUser(data)).catch(() => {}).finally(() => setLoading(false))
  }, [userId])

  return (
    <Modal open={!!userId} onClose={onClose} title="User Details" maxWidth={700}>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} height={16} />)}
        </div>
      ) : user ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8125rem' }}>
          {/* Profile */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
            {[
              ['Email', user.email],
              ['Full Name', user.full_name],
              ['Username', user.username],
              ['Role', <span key="role" className="badge" style={statusStyle(user.role)}>{user.role}</span>],
              ['Dept', user.department || '-'],
              ['Semester', user.semester || '-'],
              ['Status', <span key="status" className="badge" style={statusStyle(user.is_active ? 'active' : 'inactive')}>{user.is_active ? 'Active' : 'Inactive'}</span>],
              ['Verified', user.is_verified ? 'Yes' : 'No'],
              ['Joined', formatDate(user.created_at)],
            ].map(([label, value]) => (
              <div key={label}><span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span><div style={{ marginTop: 2 }}>{value}</div></div>
            ))}
          </div>

          {/* Activity stats */}
          <div>
            <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Activity</span>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.5rem', marginTop: '.35rem' }}>
              {[
                ['Documents', user.doc_count],
                ['Conversations', user.conv_count],
                ['Total Messages', user.total_messages],
                ['Total Tokens', user.total_tokens?.toLocaleString()],
                ['Avg Latency', user.avg_latency ? `${user.avg_latency}ms` : '-'],
                ['Avg Conf', user.avg_confidence || '-'],
                ['Feedback +', user.feedback_good || 0],
                ['Feedback -', user.feedback_bad || 0],
                ['Last Active', user.last_active ? formatDate(user.last_active) : '-'],
              ].map(([label, value]) => (
                <div key={label} style={{ padding: '.35rem .5rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)' }}>
                  <span style={{ fontSize: '.6rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                  <div style={{ fontWeight: 600, fontSize: '.8125rem' }}>{value ?? '-'}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Conversations by mode */}
          {user.conversations_by_mode && Object.keys(user.conversations_by_mode).length > 0 && (
            <div>
              <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Conversations by Mode</span>
              <div style={{ display: 'flex', gap: '.35rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
                {Object.entries(user.conversations_by_mode).map(([mode, count]) => (
                  <span key={mode} style={{ padding: '.2rem .5rem', background: 'rgba(255,255,255,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem' }}>
                    <span className="badge" style={statusStyle(mode)}>{mode}</span> {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Courses with names */}
          {user.courses?.length > 0 && (
            <div>
              <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Enrolled Courses</span>
              <div style={{ display: 'flex', gap: '.35rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
                {user.courses.map(c => (
                  <span key={c.course_id} style={{ padding: '.2rem .5rem', background: 'rgba(255,255,255,0.06)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem' }}>
                    {c.course_name || c.course_code || c.course_id.slice(0, 8)}
                    {c.course_code ? ` (${c.course_code})` : ''}
                    <span className="badge" style={{ ...statusStyle(c.role), marginLeft: '.35rem' }}>{c.role}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recent messages with latency/tokens/feedback */}
          {user.recent_messages?.length > 0 && (
            <div>
              <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recent Messages ({user.recent_messages.length})</span>
              <div style={{ maxHeight: 240, overflowY: 'auto', marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {user.recent_messages.map(m => (
                  <div key={m.id} style={{ padding: '.4rem .6rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                      <span className="badge" style={statusStyle(m.role === 'user' ? 'active' : 'ready')}>{m.role}</span>
                      <span style={{ color: 'var(--text-muted)', fontSize: '.65rem' }}>
                        {m.latency_ms ? `${m.latency_ms}ms` : ''}
                        {m.tokens_used ? ` | ${m.tokens_used}t` : ''}
                        {m.feedback ? ` | ${m.feedback === 'good' ? '👍' : '👎'}` : ''}
                        {m.confidence ? ` | ${m.confidence}` : ''}
                      </span>
                    </div>
                    <div style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content_preview}</div>
                    <span style={{ color: 'var(--text-muted)', fontSize: '.65rem' }}>{formatDate(m.created_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>User not found</p>
      )}
    </Modal>
  )
}

// ── CSV Export ──────────────────────────────────────────
function downloadCSV(data, filename) {
  if (!data || data.length === 0) return
  const headers = Object.keys(data[0])
  const rows = data.map(row => headers.map(h => `"${String(row[h] || '').replace(/"/g, '""')}"`).join(','))
  const csv = [headers.join(','), ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ══════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════
export default function AdminDashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const { addToast } = useToast()
  const [section, setSection] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const ws = useAdminWS()

  // Auth guard
  useEffect(() => {
    if (!user || user.role !== 'admin') navigate('/login', { replace: true })
  }, [user, navigate])

  // Toast on new alerts
  useEffect(() => {
    if (ws.alerts.length > 0) {
      const latest = ws.alerts[ws.alerts.length - 1]
      addToast(latest.message, latest.level === 'error' ? 'error' : 'warning')
    }
  }, [ws.alerts.length]) // eslint-disable-line

  return (
    <AnimatedPage>
      <div style={{ display: 'flex', minHeight: '100vh' }}>
        {/* Sidebar */}
        <aside style={{
          width: 240, flexShrink: 0,
          background: 'rgba(12,14,24,0.95)',
          borderRight: '1px solid rgba(255,255,255,0.06)',
          padding: '1.25rem .75rem',
          display: 'flex', flexDirection: 'column',
          position: 'sticky', top: 0, height: '100vh',
          overflowY: 'auto', zIndex: 50,
        }}>
          <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-display)', padding: '0 .75rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            &#9733; Admin
            <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: ws.connected ? '#34d399' : '#ef4444', display: 'inline-block' }} title={ws.connected ? 'Live' : 'Offline'} />
          </div>
          <nav style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {SECTIONS.map(s => {
              const Icon = s.icon
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '.6rem',
                    padding: '.55rem .75rem', borderRadius: 'var(--radius)',
                    fontSize: '.8125rem', fontWeight: section === s.id ? 600 : 400,
                    background: section === s.id ? 'rgba(255,255,255,0.07)' : 'transparent',
                    color: section === s.id ? 'var(--text-primary)' : 'var(--text-muted)',
                    border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                    transition: 'all .15s',
                  }}
                  onMouseEnter={e => { if (section !== s.id) e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                  onMouseLeave={e => { if (section !== s.id) e.currentTarget.style.background = 'transparent' }}
                >
                  <Icon size={16} />
                  {s.label}
                  {s.id === 'realtime' && ws.alerts.length > 0 && (
                    <span style={{ marginLeft: 'auto', background: '#ef4444', color: '#fff', borderRadius: 99, fontSize: '.65rem', fontWeight: 700, padding: '1px 6px', minWidth: 18, textAlign: 'center' }}>
                      {ws.alerts.length}
                    </span>
                  )}
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, padding: '1.5rem 2rem', minWidth: 0 }}>
          <div className="tab-bar" style={{ display: 'none' }} />
          {section === 'overview' && <OverviewSection />}
          {section === 'realtime' && <RealtimeSection ws={ws} />}
          {section === 'cost' && <CostSection />}
          {section === 'quality' && <QualitySection />}
          {section === 'users' && <UsersSection />}
          {section === 'documents' && <DocumentsSection />}
          {section === 'organizations' && <OrganizationsSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'courses' && <CoursesSection />}
          {section === 'conversations' && <ConversationsSection />}
          {section === 'bookmarks' && <BookmarksSection />}
          {section === 'audit' && <AuditSection />}
          {section === 'lifecycle' && <LifecycleSection />}
          {section === 'search_vector' && <SearchVectorSection />}
          {section === 'compliance' && <ComplianceSection />}
          {section === 'analytics' && <AnalyticsSection />}
          {section === 'system' && <SystemSection />}
        </main>
      </div>
    </AnimatedPage>
  )
}

// ══════════════════════════════════════════════════════════
// QUALITY
// ══════════════════════════════════════════════════════════
const SCORE_COLOR = (s) => s >= 0.75 ? '#34d399' : s >= 0.50 ? '#fbbf24' : '#ef4444'
const SCORE_LABEL = (s) => s >= 0.75 ? 'Good' : s >= 0.50 ? 'Fair' : 'Poor'

const MODE_COLORS = {
  strict: '#818cf8', normal: '#60a5fa', tutor: '#34d399',
  exam: '#fb923c', revision: '#a78bfa',
}

function ScorePill({ score }) {
  const color = SCORE_COLOR(score)
  return (
    <span style={{
      fontSize: '.7rem', padding: '2px 8px', borderRadius: 99, fontWeight: 700,
      background: `${color}18`, color,
    }}>
      {(score * 100).toFixed(0)}%
    </span>
  )
}

function QualitySection() {
  const [tab, setTab] = useState('overview')
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState(null)
  const [flagged, setFlagged] = useState(null)
  const [distribution, setDistribution] = useState(null)
  const [ragEval, setRagEval] = useState(null)
  const [abData, setAbData] = useState(null)
  const [fbTrends, setFbTrends] = useState(null)
  const [loading, setLoading] = useState(true)
  const { addToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [s, f, d, r, ab, fb] = await Promise.all([
        api.get(`/admin/quality/summary?days=${days}`),
        api.get(`/admin/quality/flagged?days=${days}&limit=50`),
        api.get(`/admin/quality/distribution?days=${days}`),
        api.get(`/admin/quality/rag-eval?days=${days}`),
        api.get(`/admin/quality/ab-comparison?days=${days}`),
        api.get(`/admin/quality/feedback-trends?days=${days}`),
      ])
      setSummary(s.data)
      setFlagged(f.data)
      setDistribution(d.data)
      setRagEval(r.data)
      setAbData(ab.data)
      setFbTrends(fb.data)
    } catch { addToast('Failed to load quality data', 'error') }
    setLoading(false)
  }, [days, addToast])

  useEffect(() => { load() }, [load])

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'flagged', label: `Flagged${summary ? ` (${summary.flagged_count})` : ''}` },
    { id: 'rag-eval', label: 'RAG Eval' },
    { id: 'ab', label: 'Mode A/B' },
    { id: 'distribution', label: 'Distribution' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>Quality Dashboard</h1>
          <p style={{ fontSize: '.8125rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
            Auto-flagging, RAG eval metrics & mode comparison
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className="btn btn-ghost"
              style={{ padding: '.3rem .65rem', fontSize: '.8rem', fontWeight: days === d ? 700 : 400, background: days === d ? 'rgba(255,255,255,0.08)' : 'transparent' }}>
              {d}d
            </button>
          ))}
          <button onClick={load} className="btn btn-ghost" style={{ padding: '.3rem .65rem', fontSize: '.8rem' }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '.5rem' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="btn btn-ghost"
            style={{ padding: '.4rem .85rem', fontSize: '.8125rem', fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? 'var(--accent-light)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0, background: 'transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '1rem' }}>
          {Array.from({ length: 6 }).map((_, i) => <GlassCard key={i} style={{ padding: '1.25rem' }}><Skeleton height={80} /></GlassCard>)}
        </div>
      )}

      {/* ── Overview ── */}
      {!loading && tab === 'overview' && summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Avg Quality Score', value: `${(summary.avg_quality_score * 100).toFixed(1)}%`, color: SCORE_COLOR(summary.avg_quality_score), icon: Star },
              { label: 'Avg Confidence', value: `${(summary.avg_confidence * 100).toFixed(1)}%`, color: '#60a5fa', icon: Target },
              { label: 'Flagged Messages', value: `${summary.flagged_count} (${summary.flagged_pct}%)`, color: summary.flagged_pct > 20 ? '#ef4444' : '#fbbf24', icon: Flag },
              { label: 'Good Feedback', value: `${summary.good_feedback_pct}%`, color: '#34d399', icon: CheckCircle },
              { label: 'Bad Feedback', value: `${summary.bad_feedback_pct}%`, color: '#ef4444', icon: XCircle },
              { label: 'Avg Faithfulness', value: `${(summary.avg_faithfulness_proxy * 100).toFixed(1)}%`, color: '#a78bfa', icon: Gauge },
            ].map(({ label, value, color, icon: Icon }) => (
              <GlassCard key={label} style={{ padding: '1.125rem', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
                <div style={{ width: 38, height: 38, borderRadius: 'var(--radius)', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={18} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800 }}>{value}</div>
                  <div style={{ fontSize: '.73rem', color: 'var(--text-muted)' }}>{label}</div>
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Feedback trend mini chart */}
          {fbTrends && (
            <GlassCard style={{ padding: '1.25rem' }}>
              <h3 style={{ fontWeight: 700, fontSize: '.9375rem', marginBottom: '1rem' }}>Feedback Trends</h3>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 64 }}>
                {fbTrends.series.map((d, i) => {
                  const total = d.good + d.bad + d.neutral || 1
                  const goodH = (d.good / total) * 100
                  const badH = (d.bad / total) * 100
                  return (
                    <div key={i} title={`${d.date}: +${d.good} 👍 -${d.bad} 👎`}
                      style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch', height: '100%', minWidth: 2 }}>
                      <div style={{ flex: `${goodH}`, background: '#34d399', opacity: 0.7, minHeight: d.good > 0 ? 1 : 0 }} />
                      <div style={{ flex: `${100 - goodH - badH}`, background: 'rgba(255,255,255,0.05)' }} />
                      <div style={{ flex: `${badH}`, background: '#ef4444', opacity: 0.7, minHeight: d.bad > 0 ? 1 : 0 }} />
                    </div>
                  )
                })}
              </div>
              <div style={{ display: 'flex', gap: '1rem', marginTop: '.75rem' }}>
                {[['#34d399', 'Good'], ['rgba(255,255,255,0.1)', 'Neutral'], ['#ef4444', 'Bad']].map(([color, label]) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: color, display: 'inline-block' }} />
                    {label}
                  </div>
                ))}
              </div>
            </GlassCard>
          )}
        </>
      )}

      {/* ── Flagged ── */}
      {!loading && tab === 'flagged' && flagged && (
        <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
          {flagged.flagged.length === 0
            ? <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>No flagged messages in this period 🎉</div>
            : (
              <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                {flagged.flagged.map((m, i) => (
                  <div key={m.message_id} style={{ padding: '.875rem 1.125rem', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '.75rem' }}>
                      <Flag size={14} style={{ color: '#ef4444', flexShrink: 0, marginTop: 3 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '.8125rem', color: 'var(--text-secondary)', marginBottom: '.3rem' }} className="truncate">
                          {m.content_preview}
                        </div>
                        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', alignItems: 'center', fontSize: '.73rem', color: 'var(--text-muted)' }}>
                          <ScorePill score={m.quality_score} />
                          <span>conf: {(m.confidence * 100).toFixed(0)}%</span>
                          <span>·</span>
                          <span style={{ color: MODE_COLORS[m.mode] || 'var(--text-muted)' }}>{m.mode}</span>
                          <span>·</span>
                          <span>{m.chunks_retrieved} chunks</span>
                          <span>·</span>
                          <span>{m.citations} citations</span>
                          {m.feedback === 'bad' && <span style={{ color: '#ef4444', fontWeight: 600 }}>👎 bad</span>}
                          {m.feedback === 'good' && <span style={{ color: '#34d399', fontWeight: 600 }}>👍 good</span>}
                        </div>
                        <div style={{ fontSize: '.72rem', color: '#ef4444', marginTop: '.25rem' }}>{m.flag_reason}</div>
                      </div>
                      <div style={{ textAlign: 'right', flexShrink: 0 }}>
                        <div style={{ fontSize: '.72rem', color: 'var(--text-muted)' }}>{m.user?.name}</div>
                        <div style={{ fontSize: '.68rem', color: 'var(--text-muted)' }}>{new Date(m.created_at).toLocaleDateString()}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          }
        </GlassCard>
      )}

      {/* ── RAG Eval ── */}
      {!loading && tab === 'rag-eval' && ragEval && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Avg Retrieval Precision', value: `${(ragEval.overall.avg_retrieval_precision * 100).toFixed(1)}%`, color: '#60a5fa' },
              { label: 'Avg Faithfulness', value: `${(ragEval.overall.avg_faithfulness * 100).toFixed(1)}%`, color: '#a78bfa' },
              { label: 'Avg Confidence', value: `${(ragEval.overall.avg_confidence * 100).toFixed(1)}%`, color: '#34d399' },
            ].map(({ label, value, color }) => (
              <GlassCard key={label} style={{ padding: '1.125rem' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color, marginBottom: '.25rem' }}>{value}</div>
                <div style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>{label}</div>
              </GlassCard>
            ))}
          </div>

          <GlassCard style={{ padding: '1.25rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '.9375rem', marginBottom: '.75rem' }}>Daily Precision & Faithfulness</h3>
            <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 80 }}>
              {ragEval.daily.map((d, i) => {
                const prec = d.avg_precision * 100
                const faith = d.avg_faithfulness * 100
                return (
                  <div key={i} style={{ flex: 1, display: 'flex', gap: 1, alignItems: 'flex-end', height: '100%', minWidth: 3 }}
                    title={`${d.date} | Precision: ${prec.toFixed(0)}% | Faithfulness: ${faith.toFixed(0)}%`}>
                    <div style={{ flex: 1, height: `${prec}%`, background: '#60a5fa', borderRadius: '2px 2px 0 0', opacity: 0.7, minHeight: prec > 0 ? 2 : 0 }} />
                    <div style={{ flex: 1, height: `${faith}%`, background: '#a78bfa', borderRadius: '2px 2px 0 0', opacity: 0.7, minHeight: faith > 0 ? 2 : 0 }} />
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: '1.25rem', marginTop: '.75rem' }}>
              {[['#60a5fa', 'Retrieval Precision'], ['#a78bfa', 'Faithfulness']].map(([c, l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '.35rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>
                  <span style={{ width: 10, height: 10, borderRadius: 2, background: c, display: 'inline-block' }} />
                  {l}
                </div>
              ))}
            </div>
            <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '1rem', marginBottom: 0 }}>
              <strong>Precision proxy</strong> = cited chunks / total retrieved chunks.{' '}
              <strong>Faithfulness proxy</strong> = (confidence × 0.6) + (citation coverage × 0.4).
              Real LLM-as-judge eval requires separate scoring pipeline.
            </p>
          </GlassCard>
        </>
      )}

      {/* ── A/B Mode Comparison ── */}
      {!loading && tab === 'ab' && abData && (
        <>
          <div style={{ marginBottom: '1rem', fontSize: '.8125rem', color: 'var(--text-muted)' }}>
            Comparing quality metrics across RAG modes ({days}d, {abData.modes.reduce((s, m) => s + m.total_messages, 0)} messages)
          </div>

          {/* Mode comparison table */}
          <GlassCard style={{ padding: 0, overflow: 'hidden', marginBottom: '1.5rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.8125rem' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid var(--border)' }}>
                  {['Mode', 'Messages', 'Quality Score', 'Confidence', 'Precision', 'Faithfulness', 'Latency', '👍%', '👎%', 'Flagged%'].map(h => (
                    <th key={h} style={{ padding: '.65rem 1rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {abData.modes.map((m, i) => (
                  <tr key={m.mode} style={{ borderBottom: i < abData.modes.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <td style={{ padding: '.65rem 1rem' }}>
                      <span style={{ padding: '2px 9px', borderRadius: 99, fontSize: '.7rem', fontWeight: 700,
                        background: `${MODE_COLORS[m.mode] || '#6b7280'}15`, color: MODE_COLORS[m.mode] || '#6b7280' }}>
                        {m.mode}
                      </span>
                    </td>
                    <td style={{ padding: '.65rem 1rem', color: 'var(--text-muted)' }}>{m.total_messages}</td>
                    <td style={{ padding: '.65rem 1rem' }}><ScorePill score={m.avg_quality_score} /></td>
                    <td style={{ padding: '.65rem 1rem', color: '#60a5fa' }}>{(m.avg_confidence * 100).toFixed(1)}%</td>
                    <td style={{ padding: '.65rem 1rem', color: '#34d399' }}>{(m.avg_precision * 100).toFixed(1)}%</td>
                    <td style={{ padding: '.65rem 1rem', color: '#a78bfa' }}>{(m.avg_faithfulness * 100).toFixed(1)}%</td>
                    <td style={{ padding: '.65rem 1rem', color: 'var(--text-muted)' }}>{m.avg_latency_ms.toFixed(0)}ms</td>
                    <td style={{ padding: '.65rem 1rem', color: '#34d399' }}>{m.good_feedback_pct}%</td>
                    <td style={{ padding: '.65rem 1rem', color: '#ef4444' }}>{m.bad_feedback_pct}%</td>
                    <td style={{ padding: '.65rem 1rem', color: m.flagged_pct > 20 ? '#ef4444' : 'var(--text-muted)' }}>{m.flagged_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>

          {/* Visual bar comparison */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px,1fr))', gap: '1rem' }}>
            {[
              { key: 'avg_quality_score', label: 'Quality Score', color: '#34d399' },
              { key: 'avg_confidence', label: 'Confidence', color: '#60a5fa' },
              { key: 'avg_faithfulness', label: 'Faithfulness', color: '#a78bfa' },
            ].map(({ key, label, color }) => {
              const max = Math.max(...abData.modes.map(m => m[key]), 0.01)
              return (
                <GlassCard key={key} style={{ padding: '1rem' }}>
                  <h4 style={{ fontSize: '.8125rem', fontWeight: 700, marginBottom: '.75rem', color: 'var(--text-muted)' }}>{label}</h4>
                  {abData.modes.map(m => (
                    <div key={m.mode} style={{ marginBottom: '.4rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', marginBottom: '.2rem' }}>
                        <span style={{ color: MODE_COLORS[m.mode] || '#6b7280' }}>{m.mode}</span>
                        <span style={{ color: 'var(--text-muted)' }}>{(m[key] * 100).toFixed(1)}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.05)' }}>
                        <div style={{ height: '100%', width: `${(m[key] / max) * 100}%`, background: color, borderRadius: 3, opacity: 0.8, transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                  ))}
                </GlassCard>
              )
            })}
          </div>
        </>
      )}

      {/* ── Distribution ── */}
      {!loading && tab === 'distribution' && distribution && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Median (P50)', value: `${(distribution.percentiles.p50 * 100).toFixed(1)}%` },
              { label: 'P75', value: `${(distribution.percentiles.p75 * 100).toFixed(1)}%` },
              { label: 'P90', value: `${(distribution.percentiles.p90 * 100).toFixed(1)}%` },
              { label: 'Mean', value: `${(distribution.mean * 100).toFixed(1)}%` },
              { label: 'Flagged', value: `${distribution.flagged_pct}%` },
            ].map(({ label, value }) => (
              <GlassCard key={label} style={{ padding: '1rem' }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 800 }}>{value}</div>
                <div style={{ fontSize: '.73rem', color: 'var(--text-muted)', marginTop: '.2rem' }}>{label}</div>
              </GlassCard>
            ))}
          </div>

          <GlassCard style={{ padding: '1.25rem' }}>
            <h3 style={{ fontWeight: 700, fontSize: '.9375rem', marginBottom: '1rem' }}>
              Score Histogram ({distribution.total} messages)
            </h3>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
              {distribution.distribution.map((b, i) => {
                const maxCount = Math.max(...distribution.distribution.map(x => x.count), 1)
                const h = (b.count / maxCount) * 100
                const mid = (i + 0.5) / 10
                return (
                  <div key={b.range} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>{b.count}</span>
                    <div style={{ width: '100%', height: `${h}%`, background: SCORE_COLOR(mid), borderRadius: '3px 3px 0 0', opacity: 0.7, minHeight: b.count > 0 ? 4 : 0 }} />
                    <span style={{ fontSize: '.6rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{b.range}</span>
                  </div>
                )
              })}
            </div>
          </GlassCard>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// COST & USAGE
// ══════════════════════════════════════════════════════════
const MODEL_COLORS = {
  Google: '#4285f4', OpenAI: '#10a37f', Anthropic: '#d97706',
}

function fmtUSD(n) {
  if (n >= 1) return `$${n.toFixed(2)}`
  if (n >= 0.01) return `$${n.toFixed(4)}`
  return `$${n.toFixed(6)}`
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function BudgetBar({ pct, over }) {
  const clamped = Math.min(pct || 0, 100)
  const color = over ? '#ef4444' : pct > 80 ? '#fbbf24' : '#34d399'
  return (
    <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden', marginTop: 4 }}>
      <div style={{ height: '100%', width: `${clamped}%`, background: color, borderRadius: 3, transition: 'width 0.4s ease' }} />
    </div>
  )
}

function SparkBars({ series, color = 'var(--accent)' }) {
  if (!series?.length) return null
  const max = Math.max(...series, 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 32, flex: 1 }}>
      {series.map((v, i) => (
        <div key={i} style={{
          flex: 1, minWidth: 2,
          height: `${(v / max) * 100}%`,
          background: color,
          borderRadius: '2px 2px 0 0',
          opacity: 0.35 + (i / series.length) * 0.65,
          minHeight: v > 0 ? 2 : 0,
        }} />
      ))}
    </div>
  )
}

function CostSection() {
  const [tab, setTab] = useState('overview')
  const [days, setDays] = useState(30)
  const [summary, setSummary] = useState(null)
  const [daily, setDaily] = useState(null)
  const [byUser, setByUser] = useState(null)
  const [byCourse, setByCourse] = useState(null)
  const [byOrg, setByOrg] = useState(null)
  const [forecast, setForecast] = useState(null)
  const [models, setModels] = useState(null)
  const [budgets, setBudgets] = useState([])
  const [budgetAlerts, setBudgetAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [budgetForm, setBudgetForm] = useState({ entity_type: 'user', entity_id: '', tokens: '' })
  const { addToast } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sum, d, u, c, o, fc, m, b, ba] = await Promise.all([
        api.get(`/admin/cost/summary?days=${days}`),
        api.get(`/admin/cost/daily?days=${days}`),
        api.get(`/admin/cost/by-user?days=${days}`),
        api.get(`/admin/cost/by-course?days=${days}`),
        api.get(`/admin/cost/by-org?days=${days}`),
        api.get(`/admin/cost/forecast?days=${days}`),
        api.get(`/admin/cost/model-comparison?days=${days}`),
        api.get('/admin/cost/budget'),
        api.get(`/admin/cost/alerts?days=${days}`),
      ])
      setSummary(sum.data)
      setDaily(d.data)
      setByUser(u.data)
      setByCourse(c.data)
      setByOrg(o.data)
      setForecast(fc.data)
      setModels(m.data)
      setBudgets(b.data.budgets || [])
      setBudgetAlerts(ba.data.alerts || [])
    } catch { addToast('Failed to load cost data', 'error') }
    setLoading(false)
  }, [days, addToast])

  useEffect(() => { load() }, [load])

  const saveBudget = async () => {
    if (!budgetForm.entity_id || !budgetForm.tokens) return
    try {
      await api.post('/admin/cost/budget', { ...budgetForm, tokens: parseInt(budgetForm.tokens) })
      addToast('Budget saved', 'success')
      setBudgetForm(f => ({ ...f, entity_id: '', tokens: '' }))
      load()
    } catch (e) { addToast(e.response?.data?.detail || 'Failed', 'error') }
  }

  const deleteBudget = async (type, id) => {
    try {
      await api.delete(`/admin/cost/budget/${type}/${id}`)
      addToast('Budget removed', 'success')
      load()
    } catch { addToast('Failed', 'error') }
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'breakdown', label: 'Breakdown' },
    { id: 'forecast', label: 'Forecast' },
    { id: 'models', label: 'Model Comparison' },
    { id: 'budgets', label: 'Budgets' },
  ]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>Cost & Usage</h1>
          <p style={{ fontSize: '.8125rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
            Token spend tracking, budget alerts, model pricing & forecasting
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          {[7, 14, 30, 90].map(d => (
            <button key={d} onClick={() => setDays(d)} className="btn btn-ghost"
              style={{ padding: '.3rem .65rem', fontSize: '.8rem', fontWeight: days === d ? 700 : 400, background: days === d ? 'rgba(255,255,255,0.08)' : 'transparent' }}>
              {d}d
            </button>
          ))}
          <button onClick={load} className="btn btn-ghost" style={{ padding: '.3rem .65rem', fontSize: '.8rem' }}>
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Budget alerts banner */}
      {budgetAlerts.length > 0 && (
        <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
          {budgetAlerts.map(a => (
            <div key={a.entity_id} style={{
              display: 'flex', alignItems: 'center', gap: '.75rem', padding: '.65rem 1rem',
              borderRadius: 'var(--radius)', background: 'rgba(239,68,68,0.08)',
              border: '1px solid rgba(239,68,68,0.2)', borderLeft: '3px solid #ef4444',
            }}>
              <AlertTriangle size={14} style={{ color: '#ef4444', flexShrink: 0 }} />
              <span style={{ flex: 1, fontSize: '.8125rem' }}>
                <strong>{a.label}</strong> used {fmtTokens(a.tokens_used)} of {fmtTokens(a.budget_tokens)} tokens ({a.pct}%)
              </span>
              <span style={{ fontSize: '.75rem', color: '#ef4444', fontWeight: 600 }}>{fmtUSD(a.cost_usd)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '.25rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '.5rem' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className="btn btn-ghost"
            style={{ padding: '.4rem .85rem', fontSize: '.8125rem', fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? 'var(--accent-light)' : 'var(--text-muted)',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              borderRadius: 0, background: 'transparent' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '1rem' }}>{Array.from({length:6}).map((_,i)=><GlassCard key={i} style={{padding:'1.25rem'}}><Skeleton height={80}/></GlassCard>)}</div>}

      {!loading && tab === 'overview' && summary && (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Total Spend', value: fmtUSD(summary.total_cost_usd), icon: DollarSign, color: '#34d399', sub: `${days}d` },
              { label: 'Total Tokens', value: fmtTokens(summary.total_tokens), icon: Hash, color: '#60a5fa', sub: `${summary.messages} messages` },
              { label: 'Avg / Message', value: fmtUSD(summary.avg_cost_per_message_usd), icon: TrendingUp, color: '#a78bfa', sub: `${fmtTokens(summary.avg_tokens_per_message)} tokens` },
              { label: 'Token Growth', value: `${summary.token_growth_pct > 0 ? '+' : ''}${summary.token_growth_pct}%`, icon: summary.token_growth_pct >= 0 ? ArrowUpRight : ArrowDownRight, color: summary.token_growth_pct > 0 ? '#ef4444' : '#34d399', sub: 'vs prev period' },
            ].map(({ label, value, icon: Icon, color, sub }) => (
              <GlassCard key={label} style={{ padding: '1.125rem', display: 'flex', gap: '.85rem', alignItems: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: 'var(--radius)', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon size={20} style={{ color }} />
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>{value}</div>
                  <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{label}</div>
                  <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: 1 }}>{sub}</div>
                </div>
              </GlassCard>
            ))}
          </div>

          {/* Daily chart */}
          {daily && (
            <GlassCard style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ fontWeight: 700, fontSize: '.9375rem', margin: 0 }}>Daily Token Usage</h3>
                <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>last {days} days</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 80 }}>
                {daily.series.map((d, i) => {
                  const max = Math.max(...daily.series.map(x => x.tokens), 1)
                  const h = (d.tokens / max) * 100
                  return (
                    <div key={i} title={`${d.date}: ${fmtTokens(d.tokens)} (${fmtUSD(d.cost_usd)})`}
                      style={{ flex: 1, minWidth: 2, height: `${h}%`, minHeight: d.tokens > 0 ? 2 : 0,
                        background: 'var(--accent)', borderRadius: '2px 2px 0 0', opacity: 0.4 + (i / daily.series.length) * 0.6, cursor: 'default' }} />
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '.4rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>
                <span>{daily.series[0]?.date}</span>
                <span>{daily.series[daily.series.length - 1]?.date}</span>
              </div>
            </GlassCard>
          )}

          {/* Active model info */}
          <GlassCard style={{ padding: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <Cpu size={20} style={{ color: 'var(--accent)', flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: '.875rem', fontWeight: 600 }}>Active Model: {summary.active_model_label}</div>
              <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Switch to <strong>Cost & Usage → Model Comparison</strong> to see alternative pricing</div>
            </div>
          </GlassCard>
        </>
      )}

      {!loading && tab === 'breakdown' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
          {/* By User */}
          <div>
            <h3 style={{ fontWeight: 700, marginBottom: '.75rem', fontSize: '.9375rem' }}>Top Users by Token Spend</h3>
            <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
              {byUser?.users?.slice(0, 10).map((u, i) => (
                <div key={u.user_id} style={{ padding: '.75rem 1rem', borderBottom: i < 9 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--grad-brand)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', fontWeight: 700, flexShrink: 0 }}>
                      {u.full_name?.[0]?.toUpperCase() || 'U'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: '.8125rem', fontWeight: 500 }}>{u.full_name}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{fmtTokens(u.tokens)} tokens · {u.messages} msgs</div>
                      {u.budget_tokens && <BudgetBar pct={u.budget_pct} over={u.over_budget} />}
                    </div>
                    <span style={{ fontSize: '.875rem', fontWeight: 700, color: u.over_budget ? '#ef4444' : 'var(--text-primary)', flexShrink: 0 }}>
                      {fmtUSD(u.cost_usd)}
                    </span>
                  </div>
                </div>
              ))}
              {!byUser?.users?.length && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No data</div>}
            </GlassCard>
          </div>

          {/* By Course */}
          <div>
            <h3 style={{ fontWeight: 700, marginBottom: '.75rem', fontSize: '.9375rem' }}>Top Courses by Token Spend</h3>
            <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
              {byCourse?.courses?.slice(0, 10).map((c, i) => (
                <div key={c.course_id || i} style={{ padding: '.75rem 1rem', borderBottom: i < 9 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 'var(--radius-sm)', background: 'rgba(99,102,241,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '.7rem', fontWeight: 700, color: '#818cf8', flexShrink: 0 }}>
                      {c.code?.[0] || '?'}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: '.8125rem', fontWeight: 500 }}>{c.name}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{fmtTokens(c.tokens)} tokens · {c.messages} msgs</div>
                      {c.budget_tokens && <BudgetBar pct={c.budget_pct} over={c.over_budget} />}
                    </div>
                    <span style={{ fontSize: '.875rem', fontWeight: 700, color: c.over_budget ? '#ef4444' : 'var(--text-primary)', flexShrink: 0 }}>
                      {fmtUSD(c.cost_usd)}
                    </span>
                  </div>
                </div>
              ))}
              {!byCourse?.courses?.length && <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No data</div>}
            </GlassCard>
          </div>
        </div>
      )}

      {!loading && tab === 'forecast' && forecast && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Next 7 Days (tokens)', value: fmtTokens(forecast.forecast.projected_7d), sub: fmtUSD(forecast.forecast.projected_7d_cost_usd) },
              { label: 'Next 30 Days (tokens)', value: fmtTokens(forecast.forecast.projected_30d), sub: fmtUSD(forecast.forecast.projected_30d_cost_usd) },
              { label: 'Daily Trend', value: `${forecast.forecast.slope > 0 ? '+' : ''}${forecast.forecast.slope} tok/day`, sub: `R² = ${forecast.forecast.r2}` },
              { label: 'Confidence', value: forecast.forecast.confidence.toUpperCase(), sub: `${forecast.historical_days}d sample` },
            ].map(({ label, value, sub }) => (
              <GlassCard key={label} style={{ padding: '1.125rem' }}>
                <div style={{ fontSize: '1.2rem', fontWeight: 800, marginBottom: '.25rem' }}>{value}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginBottom: '.15rem' }}>{label}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--accent-light)' }}>{sub}</div>
              </GlassCard>
            ))}
          </div>
          <GlassCard style={{ padding: '1.25rem' }}>
            <p style={{ fontSize: '.875rem', color: 'var(--text-muted)', margin: 0 }}>
              Forecast uses linear regression on the last <strong>{forecast.historical_days}</strong> days of usage.
              Historical total: <strong>{fmtTokens(forecast.historical_total_tokens)}</strong> ({fmtUSD(forecast.historical_total_cost_usd)}).
              Slope of <strong>{forecast.forecast.slope} tokens/day</strong> with R²={forecast.forecast.r2}.
            </p>
          </GlassCard>
        </>
      )}

      {!loading && tab === 'models' && models && (
        <>
          <GlassCard style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <p style={{ fontSize: '.875rem', color: 'var(--text-muted)', margin: 0 }}>
              Showing cost for <strong>{fmtTokens(models.total_tokens)}</strong> tokens consumed in the last {days} days,
              priced across all known models (blended input+output rates).
            </p>
          </GlassCard>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {models.models.map((m, i) => {
              const maxCost = models.models[models.models.length - 1].cost_usd || 1
              const barPct = models.models[0].cost_usd ? (m.cost_usd / models.models[models.models.length - 1].cost_usd) * 100 : 0
              return (
                <GlassCard key={m.model_id} style={{
                  padding: '.875rem 1.125rem',
                  border: m.is_active ? '1px solid var(--accent)' : '1px solid var(--border)',
                  position: 'relative', overflow: 'hidden',
                }}>
                  {m.is_active && <span style={{ position: 'absolute', top: 6, right: 10, fontSize: '.65rem', background: 'var(--accent)', color: '#0a0a0a', padding: '1px 7px', borderRadius: 99, fontWeight: 700 }}>ACTIVE</span>}
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', marginBottom: '.3rem' }}>
                        <span style={{ fontSize: '.875rem', fontWeight: 600 }}>{m.label}</span>
                        <span style={{ fontSize: '.7rem', padding: '1px 7px', borderRadius: 99, background: `${MODEL_COLORS[m.provider] || '#6b7280'}18`, color: MODEL_COLORS[m.provider] || '#6b7280' }}>{m.provider}</span>
                      </div>
                      <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>
                        ${m.blended_per_1m.toFixed(2)} / 1M tokens (blended)
                      </div>
                      <div style={{ marginTop: '.4rem', height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.05)' }}>
                        <div style={{ height: '100%', width: `${Math.min(barPct, 100)}%`, background: MODEL_COLORS[m.provider] || 'var(--accent)', borderRadius: 2, transition: 'width 0.4s ease' }} />
                      </div>
                    </div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 800, flexShrink: 0, color: i === 0 ? '#34d399' : 'var(--text-primary)' }}>
                      {fmtUSD(m.cost_usd)}
                    </div>
                  </div>
                </GlassCard>
              )
            })}
          </div>
        </>
      )}

      {!loading && tab === 'budgets' && (
        <>
          {/* Add budget form */}
          <GlassCard style={{ padding: '1.25rem', marginBottom: '1.5rem' }}>
            <h3 style={{ fontWeight: 700, marginBottom: '1rem', fontSize: '.9375rem' }}>Set Token Budget</h3>
            <div style={{ display: 'flex', gap: '.75rem', flexWrap: 'wrap' }}>
              <select value={budgetForm.entity_type} onChange={e => setBudgetForm(f => ({ ...f, entity_type: e.target.value }))}
                className="form-control" style={{ width: 120 }}>
                <option value="user">User</option>
                <option value="course">Course</option>
                <option value="org">Org</option>
              </select>
              <input placeholder="ID (user/course/org)" value={budgetForm.entity_id}
                onChange={e => setBudgetForm(f => ({ ...f, entity_id: e.target.value }))}
                className="form-control" style={{ flex: 1, minWidth: 200 }} />
              <input type="number" placeholder="Token limit" value={budgetForm.tokens}
                onChange={e => setBudgetForm(f => ({ ...f, tokens: e.target.value }))}
                className="form-control" style={{ width: 160 }} />
              <button onClick={saveBudget} className="btn btn-primary">Set Budget</button>
            </div>
          </GlassCard>

          {/* Budget list */}
          <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
            {budgets.length === 0
              ? <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No budgets set</div>
              : budgets.map((b, i) => (
                <div key={b.key} style={{ display: 'flex', alignItems: 'center', gap: '1rem', padding: '.75rem 1rem', borderBottom: i < budgets.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: '.7rem', padding: '2px 8px', borderRadius: 99, background: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)', flexShrink: 0, textTransform: 'uppercase', fontWeight: 600 }}>
                    {b.entity_type}
                  </span>
                  <code style={{ fontSize: '.8125rem', flex: 1, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{b.entity_id}</code>
                  <span style={{ fontSize: '.875rem', fontWeight: 600 }}>{fmtTokens(b.tokens)}</span>
                  <span style={{ fontSize: '.8rem', color: 'var(--text-muted)' }}>≤ {fmtUSD(b.cost_usd_limit)}</span>
                  <button onClick={() => deleteBudget(b.entity_type, b.entity_id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem', color: '#ef4444' }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              ))
            }
          </GlassCard>
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// REALTIME
// ══════════════════════════════════════════════════════════
const ALERT_LEVEL_STYLES = {
  error: { bg: 'rgba(239,68,68,0.1)', border: '#ef4444', icon: XCircle, color: '#ef4444' },
  warning: { bg: 'rgba(251,191,36,0.1)', border: '#fbbf24', icon: AlertTriangle, color: '#fbbf24' },
  info: { bg: 'rgba(96,165,250,0.1)', border: '#60a5fa', icon: Bell, color: '#60a5fa' },
}

const INGESTION_STATUS_COLOR = {
  indexed: '#34d399',
  failed: '#ef4444',
  processing: '#60a5fa',
  pending: '#fbbf24',
}

function formatRelativeTime(ts) {
  if (!ts) return '-'
  const diff = Date.now() - new Date(ts).getTime()
  const secs = Math.floor(diff / 1000)
  if (secs < 60) return `${secs}s ago`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins}m ago`
  return `${Math.floor(mins / 60)}h ago`
}

function RealtimeSection({ ws }) {
  const { connected, snapshot, auditLog, ingestionFeed, alerts, requestRefresh, dismissAlert } = ws

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>Real-time Dashboard</h1>
          <p style={{ fontSize: '.8125rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
            Live WebSocket feed — events push instantly
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', fontSize: '.8125rem' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: connected ? '#34d399' : '#ef4444', display: 'inline-block', animation: connected ? 'pulse 2s infinite' : 'none' }} />
            <span style={{ color: connected ? '#34d399' : '#ef4444', fontWeight: 600 }}>
              {connected ? 'Connected' : 'Reconnecting…'}
            </span>
          </div>
          <button className="btn btn-ghost" style={{ fontSize: '.8rem', padding: '.35rem .75rem' }} onClick={requestRefresh}>
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* KPI Snapshot */}
      {snapshot && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.75rem' }}>
          {[
            { label: 'Users', value: snapshot.users, icon: Users, color: '#60a5fa' },
            { label: 'Documents', value: snapshot.documents, icon: FileText, color: '#34d399' },
            { label: 'Failed Docs', value: snapshot.failed_docs, icon: XCircle, color: snapshot.failed_docs > 0 ? '#ef4444' : '#6b7280' },
            { label: 'Messages', value: snapshot.messages, icon: MessageSquare, color: '#a78bfa' },
            { label: 'Storage', value: formatBytes(snapshot.storage_bytes), icon: Database, color: '#fb923c' },
          ].map(({ label, value, icon: Icon, color }) => (
            <GlassCard key={label} style={{ padding: '1rem', display: 'flex', gap: '.75rem', alignItems: 'center' }}>
              <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-sm)', background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon size={18} style={{ color }} />
              </div>
              <div>
                <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{value}</div>
                <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{label}</div>
              </div>
            </GlassCard>
          ))}
        </div>
      )}

      {/* Active Alerts */}
      {alerts.length > 0 && (
        <div style={{ marginBottom: '1.75rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <Bell size={16} style={{ color: '#fbbf24' }} /> Active Alerts
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
            {alerts.map(alert => {
              const style = ALERT_LEVEL_STYLES[alert.level] || ALERT_LEVEL_STYLES.info
              const Icon = style.icon
              return (
                <div key={alert.type} style={{
                  display: 'flex', alignItems: 'center', gap: '.75rem',
                  padding: '.75rem 1rem', borderRadius: 'var(--radius)',
                  background: style.bg, border: `1px solid ${style.border}22`,
                  borderLeft: `3px solid ${style.border}`,
                }}>
                  <Icon size={16} style={{ color: style.color, flexShrink: 0 }} />
                  <span style={{ flex: 1, fontSize: '.875rem' }}>{alert.message}</span>
                  <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                    {alert.type}
                  </span>
                  <button
                    onClick={() => dismissAlert(alert.type)}
                    style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}
                  >
                    <X size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        {/* Ingestion Feed */}
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <Package size={16} /> Ingestion Feed
            <span style={{ marginLeft: 'auto', fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              last {ingestionFeed.length}
            </span>
          </h2>
          <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
            {ingestionFeed.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>
                Waiting for ingestion events…
              </div>
            ) : (
              <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                {ingestionFeed.map((item, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '.75rem',
                    padding: '.65rem 1rem',
                    borderBottom: i < ingestionFeed.length - 1 ? '1px solid var(--border)' : 'none',
                    animation: i === 0 ? 'fadeIn .3s ease' : 'none',
                  }}>
                    <span style={{
                      width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                      background: INGESTION_STATUS_COLOR[item.status] || '#6b7280',
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="truncate" style={{ fontSize: '.8125rem', fontWeight: 500 }}>{item.filename}</div>
                      {item.chunks && <div style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{item.chunks} chunks</div>}
                      {item.error && <div style={{ fontSize: '.7rem', color: '#ef4444' }} className="truncate">{item.error}</div>}
                    </div>
                    <span style={{
                      fontSize: '.7rem', padding: '2px 7px', borderRadius: 99,
                      background: `${INGESTION_STATUS_COLOR[item.status] || '#6b7280'}18`,
                      color: INGESTION_STATUS_COLOR[item.status] || '#6b7280',
                      fontWeight: 600, flexShrink: 0,
                    }}>
                      {item.status}
                    </span>
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {formatRelativeTime(item.ts)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>

        {/* Live Audit Log */}
        <div>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '.75rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <Shield size={16} /> Audit Stream
            <span style={{ marginLeft: 'auto', fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              last {auditLog.length}
            </span>
          </h2>
          <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
            {auditLog.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>
                No audit events yet…
              </div>
            ) : (
              <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                {[...auditLog].reverse().map((entry, i) => (
                  <div key={entry.id || i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: '.75rem',
                    padding: '.65rem 1rem',
                    borderBottom: i < auditLog.length - 1 ? '1px solid var(--border)' : 'none',
                    animation: i === 0 ? 'fadeIn .3s ease' : 'none',
                  }}>
                    <Activity size={14} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 2 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '.8125rem', fontWeight: 500 }}>{entry.action}</div>
                      <div style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>
                        {[entry.resource_type, entry.resource_id].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)', flexShrink: 0, whiteSpace: 'nowrap' }}>
                      {formatRelativeTime(entry.created_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// ANALYTICS
// ══════════════════════════════════════════════════════════
function AnalyticsSection() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('churn')

  useEffect(() => {
    setLoading(true)
    api.get('/admin/analytics').then(({ data }) => setData(data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.25rem' }}>Analytics</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {Array.from({ length: 6 }).map((_, i) => <GlassCard key={i} style={{ padding: '1.125rem' }}><Skeleton height={100} /></GlassCard>)}
        </div>
      </div>
    )
  }

  const tabs = [
    { id: 'churn', label: 'Churn' },
    { id: 'power', label: 'Power Users' },
    { id: 'content', label: 'Popular Content' },
    { id: 'slow', label: 'Slow Queries' },
    { id: 'confidence', label: 'Low Confidence' },
    { id: 'hours', label: 'Peak Hours' },
    { id: 'mode', label: 'Mode Effectiveness' },
    { id: 'feedback', label: 'Feedback/Mode' },
    { id: 'courses', label: 'Course Engagement' },
    { id: 'files', label: 'File Types' },
    { id: 'plans', label: 'Plan Utilization' },
    { id: 'storage', label: 'Storage/User' },
    { id: 'ingestion', label: 'Ingestion' },
  ]

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1rem' }}>Analytics</h1>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '.35rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setActiveTab(t.id)} style={{
            padding: '.35rem .7rem', fontSize: '.75rem', borderRadius: 'var(--radius-sm)',
            border: 'none', cursor: 'pointer',
            background: activeTab === t.id ? 'var(--accent)' : 'rgba(255,255,255,0.05)',
            color: activeTab === t.id ? '#fff' : 'var(--text-muted)',
            fontWeight: activeTab === t.id ? 600 : 400,
          }}>{t.label}</button>
        ))}
      </div>

      {/* Content panels */}
      {activeTab === 'churn' && (
        <div>
          <p style={{ fontSize: '.8125rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Users who have messaged before but stopped — no activity in the last N days.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              { label: '30-Day Churn', value: data?.churn?.['30d'], total: data?.churn?.total_users_with_messages, color: '#fbbf24' },
              { label: '60-Day Churn', value: data?.churn?.['60d'], total: data?.churn?.total_users_with_messages, color: '#fb923c' },
              { label: '90-Day Churn', value: data?.churn?.['90d'], total: data?.churn?.total_users_with_messages, color: '#ef4444' },
            ].map(c => (
              <GlassCard key={c.label} style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '.35rem' }}>{c.label}</div>
                <div style={{ fontSize: '2rem', fontWeight: 700, color: c.color }}>{c.value ?? '-'}</div>
                <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
                  {c.total > 0 ? `${((c.value || 0) / c.total * 100).toFixed(1)}% of active users` : 'No data'}
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'power' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
          {[
            { title: 'Top by Messages', key: 'by_messages', valKey: 'messages' },
            { title: 'Top by Tokens', key: 'by_tokens', valKey: 'tokens' },
            { title: 'Top by Conversations', key: 'by_conversations', valKey: 'conversations' },
          ].map(({ title, key, valKey }) => (
            <GlassCard key={key} style={{ padding: '1rem' }}>
              <h3 style={{ fontSize: '.8125rem', fontWeight: 600, marginBottom: '.75rem' }}>{title}</h3>
              {(data?.power_users?.[key] || []).length === 0 ? (
                <p style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>No data</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                  {data?.power_users?.[key]?.map((u, i) => (
                    <div key={u.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.75rem', padding: '.25rem .4rem', background: 'rgba(255,255,255,0.03)', borderRadius: 'var(--radius-sm)' }}>
                      <span><span style={{ color: 'var(--text-muted)', marginRight: '.35rem' }}>#{i + 1}</span>{u.full_name || u.email}</span>
                      <span style={{ fontWeight: 600 }}>{u[valKey]?.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}

      {activeTab === 'content' && (
        <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
          {(!data?.popular_content || data.popular_content.length === 0) ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No cited documents yet</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>#</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Document</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Type</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Citations</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.popular_content?.map((d, i) => (
                    <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}>
                      <td style={{ padding: '.5rem .5rem', color: 'var(--text-muted)', fontSize: '.75rem' }}>{i + 1}</td>
                      <td style={{ padding: '.5rem .5rem' }}>{d.title || d.filename}</td>
                      <td style={{ padding: '.5rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{d.file_type}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontWeight: 600, color: '#fbbf24' }}>{d.citation_count}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontSize: '.75rem', color: 'var(--text-muted)' }}>{formatBytes(d.file_size)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'slow' && (
        <GlassCard style={{ padding: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1rem' }}>
            <span className="badge" style={{ fontSize: '.8125rem', background: 'rgba(251,191,36,0.15)', color: '#fbbf24', padding: '.35rem .75rem' }}>
              p95 Latency: {data?.slow_queries?.p95_ms}ms
            </span>
            <span className="badge" style={{ fontSize: '.8125rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '.35rem .75rem' }}>
              {data?.slow_queries?.total_slow ?? 0} slow queries sampled
            </span>
          </div>
          {(!data?.slow_queries?.samples || data.slow_queries.samples.length === 0) ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem', padding: '1rem' }}>No slow queries found</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'left' }}>Content</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Latency</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Tokens</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Confidence</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.slow_queries?.samples?.map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.75rem' }}>
                      <td style={{ padding: '.5rem .5rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content_preview}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontWeight: 600, color: '#ef4444' }}>{m.latency_ms}ms</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right' }}>{m.tokens_used}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right' }}>{m.confidence || '-'}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'confidence' && (
        <GlassCard style={{ padding: '1rem' }}>
          <div style={{ marginBottom: '1rem' }}>
            <span className="badge" style={{ fontSize: '.8125rem', background: 'rgba(239,68,68,0.15)', color: '#ef4444', padding: '.35rem .75rem' }}>
              {data?.low_confidence?.total ?? 0} messages with confidence &lt; 0.3
            </span>
          </div>
          {(!data?.low_confidence?.samples || data.low_confidence.samples.length === 0) ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1rem' }}>No low-confidence messages</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'left' }}>Content</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Confidence</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Latency</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Tokens</th>
                    <th style={{ padding: '.5rem .5rem', textAlign: 'right' }}>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.low_confidence?.samples?.map(m => (
                    <tr key={m.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.75rem' }}>
                      <td style={{ padding: '.5rem .5rem', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.content_preview}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontWeight: 600, color: '#ef4444' }}>{m.confidence}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right' }}>{m.latency_ms ? `${m.latency_ms}ms` : '-'}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right' }}>{m.tokens_used}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(m.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'hours' && (
        <GlassCard style={{ padding: '1rem' }}>
          <h3 style={{ fontSize: '.8125rem', fontWeight: 600, marginBottom: '.75rem' }}>Messages by Hour of Day</h3>
          {data?.peak_hours ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 120, marginBottom: '.5rem' }}>
                {data.peak_hours.map(h => {
                  const max = Math.max(...data.peak_hours.map(x => x.count), 1)
                  return (
                    <div key={h.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <span style={{ fontSize: '.6rem', color: 'var(--text-muted)' }}>{h.count || ''}</span>
                      <div style={{
                        width: '100%', height: `${(h.count / max) * 100}%`,
                        background: h.count > 0 ? '#60a5fa' : 'rgba(255,255,255,0.04)',
                        borderRadius: '2px 2px 0 0', minHeight: h.count > 0 ? 4 : 2,
                      }} />
                      <span style={{ fontSize: '.55rem', color: 'var(--text-muted)' }}>{String(h.hour).padStart(2, '0')}</span>
                    </div>
                  )
                })}
              </div>
              <p style={{ fontSize: '.7rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                Peak: hour {data.peak_hours.reduce((a, b) => a.count > b.count ? a : b).hour}:00 ({data.peak_hours.reduce((a, b) => a.count > b.count ? a : b).count} messages)
              </p>
            </div>
          ) : <p style={{ color: 'var(--text-muted)' }}>No data</p>}
        </GlassCard>
      )}

      {activeTab === 'mode' && (
        <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
          {(!data?.mode_effectiveness || data.mode_effectiveness.length === 0) ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No data</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Mode</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Avg Confidence</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Messages</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.mode_effectiveness?.map(m => (
                    <tr key={m.mode} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}>
                      <td style={{ padding: '.5rem .5rem' }}><span className="badge" style={statusStyle(m.mode)}>{m.mode}</span></td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontWeight: 600, color: m.avg_confidence > 0.7 ? '#34d399' : '#fbbf24' }}>{m.avg_confidence ?? '-'}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', color: 'var(--text-muted)' }}>{m.message_count?.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'feedback' && (
        <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
          {(!data?.feedback_by_mode || data.feedback_by_mode.length === 0) ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No feedback data</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Mode</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Good</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Bad</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Ratio</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.feedback_by_mode?.map(m => (
                    <tr key={m.mode} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}>
                      <td style={{ padding: '.5rem .5rem' }}><span className="badge" style={statusStyle(m.mode)}>{m.mode}</span></td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', color: '#34d399', fontWeight: 600 }}>{m.good}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', color: '#ef4444', fontWeight: 600 }}>{m.bad}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontWeight: 600 }}>{m.ratio ? `${(m.ratio * 100).toFixed(1)}%` : '-'}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', color: 'var(--text-muted)' }}>{m.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'courses' && (
        <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
          {(!data?.course_engagement || data.course_engagement.length === 0) ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No course data</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Course</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Conversations</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Messages</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Users</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.course_engagement?.map(c => (
                    <tr key={c.course_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}>
                      <td style={{ padding: '.5rem .5rem' }}>{c.course_name}{c.course_code ? ` (${c.course_code})` : ''}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right' }}>{c.conversations}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontWeight: 600 }}>{c.messages?.toLocaleString()}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', color: 'var(--text-muted)' }}>{c.users}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'files' && (
        <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
          {(!data?.file_type_distribution || data.file_type_distribution.length === 0) ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No documents uploaded</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>File Type</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Count</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Total Size</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.file_type_distribution?.map((f, i, arr) => {
                    const total = arr.reduce((s, x) => s + x.count, 0)
                    return (
                      <tr key={f.file_type} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}>
                        <td style={{ padding: '.5rem .5rem' }}><span className="badge" style={statusStyle(f.file_type)}>{f.file_type}</span></td>
                        <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontWeight: 600 }}>{f.count}</td>
                        <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontSize: '.75rem', color: 'var(--text-muted)' }}>{formatBytes(f.total_bytes)}</td>
                        <td style={{ padding: '.5rem .5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '.35rem' }}>
                            <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                              <div style={{ width: `${(f.count / total) * 100}%`, height: '100%', background: ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa'][i % 5], borderRadius: 3 }} />
                            </div>
                            <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>{((f.count / total) * 100).toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'plans' && (
        <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
          {(!data?.plan_utilization || data.plan_utilization.length === 0) ? (
            <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>No plan data</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Plan</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Organizations</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Users</th>
                    <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Storage</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.plan_utilization?.map(p => (
                    <tr key={p.plan} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}>
                      <td style={{ padding: '.5rem .5rem' }}><span className="badge" style={statusStyle(p.plan)}>{p.plan}</span></td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right' }}>{p.organizations}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right' }}>{p.users}</td>
                      <td style={{ padding: '.5rem .5rem', textAlign: 'right', fontSize: '.75rem', color: 'var(--text-muted)' }}>{formatBytes(p.storage_bytes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'storage' && (
        <GlassCard style={{ padding: '1rem' }}>
          <h3 style={{ fontSize: '.8125rem', fontWeight: 600, marginBottom: '.75rem' }}>Top Storage Consumers</h3>
          {(!data?.storage_per_user || data.storage_per_user.length === 0) ? (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>No data</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              {data?.storage_per_user?.map((u, i) => {
                const maxBytes = data.storage_per_user[0]?.storage_bytes || 1
                return (
                  <div key={u.user_id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', marginBottom: 2 }}>
                      <span><span style={{ color: 'var(--text-muted)' }}>#{i + 1}</span> {u.full_name || u.email}</span>
                      <span style={{ fontWeight: 600 }}>{formatBytes(u.storage_bytes)}</span>
                    </div>
                    <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ width: `${(u.storage_bytes / maxBytes) * 100}%`, height: '100%', background: '#a78bfa', borderRadius: 3 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </GlassCard>
      )}

      {activeTab === 'ingestion' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            {[
              { label: 'Total Documents', value: data?.ingestion_pipeline?.total_documents, color: '#60a5fa' },
              { label: 'Avg Processing Time', value: data?.ingestion_pipeline?.avg_processing_seconds ? `${data.ingestion_pipeline.avg_processing_seconds}s` : '-', color: '#fbbf24' },
              { label: 'Failure Rate', value: data?.ingestion_pipeline?.failure_rate_pct ? `${data.ingestion_pipeline.failure_rate_pct}%` : '0%', color: data?.ingestion_pipeline?.failure_rate_pct > 5 ? '#ef4444' : '#34d399' },
              { label: 'Recent 7d Fail Rate', value: data?.ingestion_pipeline?.recent_7d?.failure_rate_pct ? `${data.ingestion_pipeline.recent_7d.failure_rate_pct}%` : '0%', color: '#fb923c' },
            ].map(c => (
              <GlassCard key={c.label} style={{ padding: '1rem', textAlign: 'center' }}>
                <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '.25rem' }}>{c.label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: c.color }}>{c.value}</div>
              </GlassCard>
            ))}
          </div>
          {data?.ingestion_pipeline?.by_status && (
            <GlassCard style={{ padding: '1rem' }}>
              <h3 style={{ fontSize: '.8125rem', fontWeight: 600, marginBottom: '.75rem' }}>Documents by Status</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                {Object.entries(data.ingestion_pipeline.by_status).filter(([k]) => data.ingestion_pipeline.total_documents > 0).map(([status, count]) => {
                  const pct = (count / data.ingestion_pipeline.total_documents) * 100
                  return (
                    <div key={status}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', marginBottom: 2 }}>
                        <span style={{ textTransform: 'capitalize' }}>{status}</span>
                        <span style={{ fontWeight: 600 }}>{count} ({pct.toFixed(1)}%)</span>
                      </div>
                      <div style={{ height: 6, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: status === 'completed' ? '#34d399' : status === 'failed' ? '#ef4444' : status === 'processing' ? '#60a5fa' : '#fbbf24', borderRadius: 3 }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </GlassCard>
          )}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// OVERVIEW
// ══════════════════════════════════════════════════════════
function OverviewSection() {
  const [stats, setStats] = useState(null)
  const [trends, setTrends] = useState(null)
  const [breakdown, setBreakdown] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/stats/trends', { params: { days: 30 } }),
      api.get('/admin/stats/breakdown'),
    ]).then(([s, t, b]) => {
      setStats(s.data)
      setTrends(t.data)
      setBreakdown(b.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.25rem' }}>Overview</h1>
        <div className="grid grid-4" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
          {Array.from({ length: 8 }).map((_, i) => (
            <GlassCard key={i} style={{ padding: '1.125rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
              <Skeleton height={12} width="40%" />
              <Skeleton height={28} width="60%" />
              <Skeleton height={32} />
            </GlassCard>
          ))}
        </div>
      </div>
    )
  }

  const kpis = [
    { label: 'Total Users', value: stats?.users?.toLocaleString(), delta: stats?.user_growth, trend: trends?.series?.map(s => s.users), icon: <Users size={16} />, color: '#60a5fa' },
    { label: 'Daily Active Users', value: stats?.daily_active_users?.toLocaleString(), icon: <Activity size={16} />, color: '#f472b6' },
    { label: 'Documents', value: stats?.documents?.toLocaleString(), delta: stats?.document_growth, icon: <FileText size={16} />, color: '#a78bfa' },
    { label: 'Organizations', value: stats?.organizations?.toLocaleString(), icon: <Building2 size={16} />, color: '#34d399' },
    { label: 'Messages', value: stats?.messages?.toLocaleString(), delta: stats?.message_growth, trend: trends?.series?.map(s => s.messages), icon: <MessageSquare size={16} />, color: '#fbbf24' },
    { label: 'Conversations', value: stats?.conversations?.toLocaleString(), icon: <MessageCircle size={16} />, color: '#818cf8' },
    { label: 'Messages/Conv', value: stats?.messages_per_conversation, icon: <MessageSquare size={14} />, color: '#94a3b8' },
    { label: 'Avg Duration', value: stats?.avg_conversation_duration_min ? `${stats.avg_conversation_duration_min}m` : '-', icon: <Clock size={16} />, color: '#a78bfa' },
    { label: 'Active Users (7d)', value: stats?.active_users_7d?.toLocaleString(), icon: <Users size={16} />, color: '#f472b6' },
    { label: 'Active (30d)', value: stats?.active_users_30d?.toLocaleString(), icon: <Activity size={16} />, color: '#34d399' },
    { label: 'Idle Users', value: stats?.idle_users?.toLocaleString(), icon: <XCircle size={16} />, color: '#ef4444' },
    { label: 'API Calls (7d)', value: stats?.api_calls_7d?.toLocaleString(), delta: stats?.api_calls_growth, icon: <Hash size={16} />, color: '#fb923c' },
    { label: 'Tokens Used (7d)', value: stats?.tokens_used_7d?.toLocaleString(), delta: stats?.tokens_growth, icon: <Database size={16} />, color: '#818cf8' },
    { label: 'Tokens/Message', value: stats?.tokens_per_message?.toLocaleString(), icon: <Hash size={16} />, color: '#fbbf24' },
    { label: 'Storage', value: stats?.storage_gb ? `${stats.storage_gb} GB` : formatBytes(stats?.storage_bytes), delta: stats?.storage_growth, icon: <HardDrive size={16} />, color: '#94a3b8' },
  ]

  const usageSeries = trends?.series?.map(s => s.api_calls) || []
  const msgSeries = trends?.series?.map(s => s.messages) || []
  const docSeries = trends?.series?.map(s => s.documents) || []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Overview</h1>
        <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
          <span className="badge" style={{ fontSize: '.65rem' }}>Conf: {stats?.avg_confidence}</span>
          <span className="badge" style={{ fontSize: '.65rem' }}>Feedback: {((stats?.feedback_ratio || 0) * 100).toFixed(0)}%</span>
          <span className="badge" style={{ fontSize: '.65rem' }}>p50: {stats?.latency_p50_ms}ms</span>
          <span className="badge" style={{ fontSize: '.65rem' }}>p95: {stats?.latency_p95_ms}ms</span>
          <span className="badge" style={{ fontSize: '.65rem' }}>p99: {stats?.latency_p99_ms}ms</span>
          <span className="badge" style={{ fontSize: '.65rem' }}>Ingested/24h: {stats?.documents_ingested_24h}</span>
          <span className="badge" style={{ fontSize: '.65rem', color: stats?.failed_documents > 0 ? '#ef4444' : '#34d399' }}>Failed: {stats?.failed_documents} ({stats?.failed_documents_growth}%)</span>
        </div>
      </div>

      {/* KPI Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        {kpis.map(k => <KPICard key={k.label} {...k} />)}
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* API Calls Chart */}
        <GlassCard style={{ padding: '1.125rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '.75rem' }}>
            <h3 style={{ fontSize: '.8125rem', fontWeight: 600 }}>Daily API Calls (30d)</h3>
            <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>Total: {stats?.api_calls_7d?.toLocaleString()}</span>
          </div>
          <MiniBar data={usageSeries} color="#fb923c" height={80} />
        </GlassCard>

        {/* Breakdown Donut (simplified as stacked bar) */}
        <GlassCard style={{ padding: '1.125rem' }}>
          <h3 style={{ fontSize: '.8125rem', fontWeight: 600, marginBottom: '.75rem' }}>Usage by Mode</h3>
          {breakdown?.by_mode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.4rem' }}>
              {Object.entries(breakdown.by_mode).map(([mode, count], i, arr) => {
                const total = Object.values(breakdown.by_mode).reduce((a, b) => a + b, 0)
                const pct = total > 0 ? Math.round((count / total) * 100) : 0
                const colors = ['#60a5fa', '#34d399', '#fbbf24', '#f472b6', '#a78bfa']
                return (
                  <div key={mode}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', marginBottom: 2 }}>
                      <span style={{ textTransform: 'capitalize' }}>{mode}</span>
                      <span style={{ color: 'var(--text-muted)' }}>{count} ({pct}%)</span>
                    </div>
                    <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 4, overflow: 'hidden' }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: colors[i % colors.length], borderRadius: 4 }} />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : <p style={{ fontSize: '.8125rem', color: 'var(--text-muted)' }}>No data</p>}
        </GlassCard>
      </div>

      {/* Secondary Charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
        <GlassCard style={{ padding: '1.125rem' }}>
          <h3 style={{ fontSize: '.8125rem', fontWeight: 600, marginBottom: '.75rem' }}>Daily Messages</h3>
          <MiniBar data={msgSeries} color="#fbbf24" height={60} />
        </GlassCard>
        <GlassCard style={{ padding: '1.125rem' }}>
          <h3 style={{ fontSize: '.8125rem', fontWeight: 600, marginBottom: '.75rem' }}>Documents Uploaded</h3>
          <MiniBar data={docSeries} color="#a78bfa" height={60} />
        </GlassCard>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════════════
function UsersSection() {
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const [roleFilter, setRoleFilter] = useState('')
  const [detailUserId, setDetailUserId] = useState(null)
  const [selected, setSelected] = useState(new Set())
  const { addToast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/users', {
        params: { page, per_page: perPage, search, sort_by: sortBy, sort_dir: sortDir, role: roleFilter },
      })
      setUsers(data.users)
      setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }, [page, perPage, search, sortBy, sortDir, roleFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleRoleChange = async (userId, role) => {
    try {
      await api.patch(`/admin/users/${userId}`, null, { params: { role } })
      addToast('User role updated', 'success')
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Update failed', 'error') }
  }

  const handleToggleActive = async (userId, current) => {
    try {
      await api.patch(`/admin/users/${userId}`, null, { params: { is_active: !current } })
      addToast(`User ${current ? 'deactivated' : 'activated'}`, 'success')
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Update failed', 'error') }
  }

  const handleImpersonate = async (userId) => {
    try {
      const { data } = await api.post(`/admin/users/${userId}/impersonate`)
      const currentToken = useAuthStore.getState().token
      const currentUser = useAuthStore.getState().user
      localStorage.setItem('rag-admin-original-auth', JSON.stringify({ token: currentToken, user: currentUser }))
      useAuthStore.getState().setAuth(data.access_token, data.user)
      addToast(`Impersonating ${data.user.full_name} (${data.user.email})`, 'success')
      window.location.href = '/chat'
    } catch (e) {
      addToast(e.response?.data?.detail || 'Impersonation failed', 'error')
    }
  }

  const handleDelete = async (userId) => {
    if (!window.confirm('Delete this user? This cannot be undone.')) return
    try {
      await api.delete(`/admin/users/${userId}`)
      addToast('User deleted', 'success')
      setSelected(prev => { const n = new Set(prev); n.delete(userId); return n })
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Delete failed', 'error') }
  }

  const handleBulkAction = async (action, value) => {
    if (selected.size === 0) { addToast('No users selected', 'warning'); return }
    if (!window.confirm(`Apply "${action}" to ${selected.size} users?`)) return
    for (const uid of selected) {
      try {
        if (action === 'set_role') await api.patch(`/admin/users/${uid}`, null, { params: { role: value } })
        else if (action === 'toggle_active') await api.patch(`/admin/users/${uid}`, null, { params: { is_active: value } })
      } catch {}
    }
    addToast(`Bulk ${action} applied to ${selected.size} users`, 'success')
    setSelected(new Set())
    fetchData()
  }

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return null
    return <span style={{ fontSize: '.6rem', marginLeft: 2 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  const cols = [
    { key: 'full_name', label: 'Name' },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role' },
    { key: 'department', label: 'Dept' },
    { key: 'is_active', label: 'Status' },
    { key: 'created_at', label: 'Joined' },
  ]

  const tableHeader = (
    <thead>
      <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <th style={{ padding: '.65rem .5rem', width: 32 }}>
          <input type="checkbox" onChange={e => setSelected(e.target.checked ? new Set(users.map(u => u.id)) : new Set())} checked={selected.size === users.length && users.length > 0} />
        </th>
        {cols.map(c => (
          <th key={c.key} onClick={() => c.key !== 'is_active' && toggleSort(c.key)} style={{ padding: '.65rem .5rem', textAlign: 'left', cursor: c.key !== 'is_active' ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
            {c.label} <SortIcon col={c.key} />
          </th>
        ))}
        <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Actions</th>
      </tr>
    </thead>
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Users</h1>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchInput value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search name, email..." />
          <select value={roleFilter} onChange={e => { setRoleFilter(e.target.value); setPage(1) }} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)', padding: '.4rem .6rem', fontSize: '.75rem', color: 'var(--text-primary)',
          }}>
            <option value="">All Roles</option>
            <option value="student">Student</option>
            <option value="ta">TA</option>
            <option value="faculty">Faculty</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={() => downloadCSV(users.map(u => ({ ...u, created_at: formatDate(u.created_at) })), 'users.csv')} className="btn btn-ghost" style={{ padding: '.4rem .7rem', fontSize: '.75rem' }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      {/* Bulk actions */}
      {selected.size > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem', padding: '.5rem .75rem', background: 'rgba(96,165,250,0.1)', borderRadius: 'var(--radius)', fontSize: '.8125rem' }}>
          <span>{selected.size} selected</span>
          <button onClick={() => handleBulkAction('toggle_active', true)} className="btn btn-ghost" style={{ padding: '.2rem .5rem', fontSize: '.7rem' }}>Activate</button>
          <button onClick={() => handleBulkAction('toggle_active', false)} className="btn btn-ghost" style={{ padding: '.2rem .5rem', fontSize: '.7rem' }}>Deactivate</button>
          <select onChange={e => { if (e.target.value) handleBulkAction('set_role', e.target.value); e.target.value = '' }} style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 'var(--radius)', padding: '.2rem .5rem', fontSize: '.7rem', color: 'var(--text-primary)',
          }}>
            <option value="">Set role...</option>
            <option value="student">Student</option>
            <option value="ta">TA</option>
            <option value="faculty">Faculty</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={() => setSelected(new Set())} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: '.7rem' }}>Clear</button>
        </div>
      )}

      <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            {tableHeader}
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No users found</td></tr>
              ) : users.map(u => (
                <tr key={u.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem', transition: 'background .1s' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '.65rem .5rem' }}>
                    <input type="checkbox" checked={selected.has(u.id)} onChange={() => setSelected(prev => { const n = new Set(prev); n.has(u.id) ? n.delete(u.id) : n.add(u.id); return n })} />
                  </td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <div style={{ fontWeight: 500 }}>{u.full_name || u.username}</div>
                    <div style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{u.email}</div>
                  </td>
                  <td style={{ padding: '.65rem .5rem' }}>{u.email}</td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <select
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      style={{
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 'var(--radius-sm)', padding: '.15rem .35rem', fontSize: '.7rem',
                        color: STATUS_COLORS[u.role]?.text || 'var(--text-primary)',
                        fontWeight: 500,
                      }}
                    >
                      <option value="student">student</option>
                      <option value="ta">ta</option>
                      <option value="faculty">faculty</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{u.department || '-'}</td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <span className="badge" style={{ ...statusStyle(u.is_active ? 'active' : 'inactive'), fontSize: '.65rem', padding: '2px 8px' }}>
                      {u.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(u.created_at)}</td>
                  <td style={{ padding: '.65rem .5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: '.25rem', justifyContent: 'flex-end' }}>
                      <button onClick={() => setDetailUserId(u.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem' }} title="View details"><Eye size={14} /></button>
                      <button onClick={() => handleImpersonate(u.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem', color: '#fbbf24' }} title="Login as user (Impersonate)"><Zap size={14} /></button>
                      <button onClick={() => handleToggleActive(u.id, u.is_active)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem' }} title={u.is_active ? 'Deactivate' : 'Activate'}>
                        {u.is_active ? <XCircle size={14} /> : <CheckCircle size={14} />}
                      </button>
                      <button onClick={() => handleDelete(u.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem', color: '#ef4444' }} title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <Pagination page={page} perPage={perPage} total={total} onPageChange={setPage} onPerPageChange={v => { setPerPage(v); setPage(1) }} />
      <UserDetailModal userId={detailUserId} onClose={() => setDetailUserId(null)} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// DOCUMENTS
// ══════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════
// DOCUMENTS
// ══════════════════════════════════════════════════════════

function PipelineStageTracker({ status, errorMessage }) {
  const stages = [
    { key: 'upload', label: 'Upload' },
    { key: 'parse', label: 'Parse' },
    { key: 'chunk', label: 'Chunk' },
    { key: 'embed', label: 'Embed' },
    { key: 'index', label: 'Index' },
  ];

  const getStageState = (stageKey) => {
    if (status === 'indexed' || status === 'ready') return 'completed';
    if (status === 'failed') {
      const errorText = (errorMessage || '').toLowerCase();
      let failedAtIdx = 4; // default index
      if (errorText.includes('parse') || errorText.includes('extract') || errorText.includes('pdf')) failedAtIdx = 1;
      else if (errorText.includes('chunk') || errorText.includes('split')) failedAtIdx = 2;
      else if (errorText.includes('embed') || errorText.includes('vector') || errorText.includes('openai')) failedAtIdx = 3;
      else if (errorText.includes('index') || errorText.includes('bm25') || errorText.includes('search')) failedAtIdx = 4;

      const stageIdx = stages.findIndex(s => s.key === stageKey);
      if (stageIdx < failedAtIdx) return 'completed';
      if (stageIdx === failedAtIdx) return 'failed';
      return 'pending';
    }

    const statusMap = {
      'pending': 0,
      'processing:parsing': 1,
      'processing:chunking': 2,
      'processing:embedding': 3,
      'processing:indexing': 4,
    };

    const currentIdx = statusMap[status] !== undefined ? statusMap[status] : (status && status.startsWith('processing') ? 1 : 0);
    const stageIdx = stages.findIndex(s => s.key === stageKey);
    if (stageIdx < currentIdx) return 'completed';
    if (stageIdx === currentIdx) return 'active';
    return 'pending';
  };

  return (
    <div style={{ margin: '1rem 0' }}>
      <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: '.5rem' }}>Ingestion Progress</span>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '.75rem', background: 'rgba(255,255,255,0.02)', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.05)' }}>
        {stages.map((stage, idx) => {
          const state = getStageState(stage.key);
          let color = 'var(--text-muted)';
          let bg = 'rgba(255,255,255,0.03)';
          let border = '1px solid rgba(255,255,255,0.08)';

          if (state === 'completed') {
            color = '#34d399';
            bg = 'rgba(52,211,153,0.12)';
            border = '1px solid #34d399';
          } else if (state === 'active') {
            color = '#60a5fa';
            bg = 'rgba(96,165,250,0.18)';
            border = '1px solid #60a5fa';
          } else if (state === 'failed') {
            color = '#ef4444';
            bg = 'rgba(239,68,68,0.15)';
            border = '1px solid #ef4444';
          }

          return (
            <React.Fragment key={stage.key}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flex: 1, position: 'relative' }}>
                <div style={{
                  width: 26, height: 26, borderRadius: '50%', background: bg, border: border,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', color: color,
                  fontSize: '.7rem', fontWeight: 600, transition: 'all 0.3s ease'
                }}>
                  {state === 'completed' ? '✓' : (state === 'failed' ? '✗' : (idx + 1))}
                </div>
                <span style={{ fontSize: '.6rem', marginTop: 4, color: color, fontWeight: state !== 'pending' ? 600 : 400 }}>{stage.label}</span>
              </div>
              {idx < stages.length - 1 && (
                <div style={{
                  flex: 1, height: 2, background: state === 'completed' ? '#34d399' : 'rgba(255,255,255,0.06)',
                  margin: '0 -8px', alignSelf: 'center', marginTop: '-12px'
                }} />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}

function DocumentsSection() {
  const [docs, setDocs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [statusFilter, setStatusFilter] = useState('')
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDir, setSortDir] = useState('desc')
  const [detailDocId, setDetailDocId] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const { addToast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/documents', {
        params: { page, per_page: perPage, search, status: statusFilter, sort_by: sortBy, sort_dir: sortDir },
      })
      setDocs(data.documents)
      setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }, [page, perPage, search, statusFilter, sortBy, sortDir])

  useEffect(() => { fetchData() }, [fetchData])

  const handleReprocess = async (docId) => {
    try {
      await api.post(`/admin/documents/${docId}/reprocess`)
      addToast('Reprocessing started', 'success')
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Failed', 'error') }
  }

  const handleBatchReprocess = async () => {
    if (!selectedIds.length) return
    try {
      await api.post('/admin/documents/batch-reprocess', { document_ids: selectedIds })
      addToast(`Reprocessing triggered for ${selectedIds.length} documents`, 'success')
      setSelectedIds([])
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Batch reprocess failed', 'error') }
  }

  const handleBatchDelete = async () => {
    if (!selectedIds.length) return
    if (!window.confirm(`Delete ${selectedIds.length} selected documents?`)) return
    try {
      for (const id of selectedIds) {
        await api.delete(`/admin/documents/${id}`)
      }
      addToast('Selected documents deleted', 'success')
      setSelectedIds([])
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Batch delete failed', 'error') }
  }

  const handleDelete = async (docId) => {
    if (!window.confirm('Delete this document?')) return
    try {
      await api.delete(`/documents/${docId}`)
      addToast('Document deleted', 'success')
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Delete failed', 'error') }
  }

  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedIds(docs.map(d => d.id))
    } else {
      setSelectedIds([])
    }
  }

  const handleSelectRow = (docId) => {
    setSelectedIds(prev => prev.includes(docId) ? prev.filter(id => id !== docId) : [...prev, docId])
  }

  const toggleSort = (col) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('desc') }
    setPage(1)
  }

  const SortIcon = ({ col }) => {
    if (sortBy !== col) return null
    return <span style={{ fontSize: '.6rem', marginLeft: 2 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Documents</h1>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {selectedIds.length > 0 && (
            <div style={{ display: 'flex', gap: '.35rem', marginRight: '1rem', background: 'rgba(255,255,255,0.03)', padding: '.25rem .5rem', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontSize: '.7rem', alignSelf: 'center', marginRight: '.25rem', color: 'var(--text-muted)' }}>{selectedIds.length} selected</span>
              <button onClick={handleBatchReprocess} className="btn" style={{ padding: '.3rem .6rem', fontSize: '.7rem', display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(59,130,246,0.15)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.25)' }}>
                <RefreshCw size={11} /> Reprocess
              </button>
              <button onClick={handleBatchDelete} className="btn" style={{ padding: '.3rem .6rem', fontSize: '.7rem', display: 'flex', alignItems: 'center', gap: '3px', background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.25)' }}>
                <Trash2 size={11} /> Delete
              </button>
            </div>
          )}
          <SearchInput value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search filename..." />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)', padding: '.4rem .6rem', fontSize: '.75rem', color: 'var(--text-primary)',
          }}>
            <option value="">All Status</option>
            <option value="indexed">Indexed</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>
          <button onClick={() => downloadCSV(docs.map(d => ({ ...d, file_size: formatBytes(d.file_size), created_at: formatDate(d.created_at) })), 'documents.csv')} className="btn btn-ghost" style={{ padding: '.4rem .7rem', fontSize: '.75rem' }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '.65rem .5rem', width: 30, textAlign: 'center' }}>
                  <input type="checkbox" checked={docs.length > 0 && selectedIds.length === docs.length} onChange={handleSelectAll} style={{ accentColor: '#3b82f6' }} />
                </th>
                <th onClick={() => toggleSort('filename')} style={{ padding: '.65rem .5rem', textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap' }}>Filename <SortIcon col="filename" /></th>
                <th onClick={() => toggleSort('file_type')} style={{ padding: '.65rem .5rem', textAlign: 'left', cursor: 'pointer' }}>Type <SortIcon col="file_type" /></th>
                <th onClick={() => toggleSort('file_size')} style={{ padding: '.65rem .5rem', textAlign: 'left', cursor: 'pointer' }}>Size <SortIcon col="file_size" /></th>
                <th onClick={() => toggleSort('status')} style={{ padding: '.65rem .5rem', textAlign: 'left', cursor: 'pointer' }}>Status <SortIcon col="status" /></th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Owner</th>
                <th onClick={() => toggleSort('total_chunks')} style={{ padding: '.65rem .5rem', textAlign: 'left', cursor: 'pointer' }}>Chunks <SortIcon col="total_chunks" /></th>
                <th onClick={() => toggleSort('created_at')} style={{ padding: '.65rem .5rem', textAlign: 'left', cursor: 'pointer', whiteSpace: 'nowrap' }}>Uploaded <SortIcon col="created_at" /></th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No documents found</td></tr>
              ) : docs.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem', background: selectedIds.includes(d.id) ? 'rgba(59,130,246,0.03)' : 'transparent' }}
                  onMouseEnter={e => { if(!selectedIds.includes(d.id)) e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
                  onMouseLeave={e => { if(!selectedIds.includes(d.id)) e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ padding: '.65rem .5rem', textAlign: 'center' }}>
                    <input type="checkbox" checked={selectedIds.includes(d.id)} onChange={() => handleSelectRow(d.id)} style={{ accentColor: '#3b82f6' }} />
                  </td>
                  <td style={{ padding: '.65rem .5rem', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.filename}>{d.filename}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>{d.file_type}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem' }}>{formatBytes(d.file_size)}</td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <span className="badge" style={{ ...statusStyle(d.status), fontSize: '.65rem', padding: '2px 8px' }}>{d.status}</span>
                  </td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{d.owner_name || d.owner_email || d.owner_id?.slice(0, 8)}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem' }}>{d.total_chunks}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(d.created_at)}</td>
                  <td style={{ padding: '.65rem .5rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: '.25rem', justifyContent: 'flex-end' }}>
                      <button onClick={() => setDetailDocId(d.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem' }} title="Details"><Eye size={14} /></button>
                      <button onClick={() => handleReprocess(d.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem' }} title="Reprocess"><RefreshCw size={14} /></button>
                      <button onClick={() => handleDelete(d.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem', color: '#ef4444' }} title="Delete"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <Pagination page={page} perPage={perPage} total={total} onPageChange={setPage} onPerPageChange={v => { setPerPage(v); setPage(1) }} />
      <DocumentDetailModal docId={detailDocId} onClose={() => setDetailDocId(null)} />
    </div>
  )
}

function DocumentDetailModal({ docId, onClose }) {
  const [doc, setDoc] = useState(null)
  const [failedChunksData, setFailedChunksData] = useState(null)
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState('info') // info | chunks | failed | logs
  const [editingChunk, setEditingChunk] = useState(null)
  const { addToast } = useToast()

  const fetchAllData = useCallback(async () => {
    if (!docId) return
    Promise.all([
      api.get(`/admin/documents/${docId}`),
      api.get(`/admin/documents/${docId}/failed-chunks`).catch(() => null),
      api.get(`/admin/documents/${docId}/logs`).catch(() => null)
    ]).then(([resDetail, resFailed, resLogs]) => {
      setDoc(resDetail.data)
      if (resFailed) {
        setFailedChunksData(resFailed.data)
      }
      if (resLogs) {
        setLogs(resLogs.data.logs || [])
      }
    }).catch(() => {
      addToast('Failed to load document details', 'error')
    })
  }, [docId, addToast])

  useEffect(() => {
    if (!docId) return
    setLoading(true)
    setActiveTab('info')
    fetchAllData().finally(() => setLoading(false))
  }, [docId, fetchAllData])

  const handleReprocess = async () => {
    if (!doc) return
    try {
      await api.post(`/admin/documents/${doc.id}/reprocess`)
      addToast('Reprocessing started', 'success')
      onClose()
    } catch (e) { addToast(e.response?.data?.detail || 'Failed', 'error') }
  }

  const handleEditSave = async (chunkId, updatedData) => {
    try {
      await api.put(`/admin/chunks/${chunkId}`, updatedData)
      addToast('Chunk updated and re-indexed successfully', 'success')
      setEditingChunk(null)
      fetchAllData()
    } catch (e) {
      addToast(e.response?.data?.detail || 'Failed to update chunk', 'error')
    }
  }

  const failedCount = failedChunksData?.failed_count || 0

  return (
    <>
      <Modal open={!!docId} onClose={onClose} title="Document Details & Ingestion Status" maxWidth={750}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={16} />)}
          </div>
        ) : doc ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8125rem' }}>
            
            <PipelineStageTracker status={doc.status} errorMessage={doc.error_message} />

            <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '1rem', paddingBottom: '.25rem' }}>
              <button onClick={() => setActiveTab('info')} style={{
                background: 'none', border: 'none', padding: '.4rem .6rem', color: activeTab === 'info' ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === 'info' ? '2px solid #3b82f6' : 'none', cursor: 'pointer', fontWeight: activeTab === 'info' ? 600 : 400, fontSize: '.8rem'
              }}>General Info</button>
              <button onClick={() => setActiveTab('chunks')} style={{
                background: 'none', border: 'none', padding: '.4rem .6rem', color: activeTab === 'chunks' ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === 'chunks' ? '2px solid #3b82f6' : 'none', cursor: 'pointer', fontWeight: activeTab === 'chunks' ? 600 : 400, fontSize: '.8rem'
              }}>All Chunks ({doc.chunks?.length || 0})</button>
              <button onClick={() => setActiveTab('failed')} style={{
                background: 'none', border: 'none', padding: '.4rem .6rem', 
                color: failedCount > 0 ? '#ef4444' : (activeTab === 'failed' ? 'var(--text-primary)' : 'var(--text-muted)'),
                borderBottom: activeTab === 'failed' ? `2px solid ${failedCount > 0 ? '#ef4444' : '#3b82f6'}` : 'none', 
                cursor: 'pointer', fontWeight: activeTab === 'failed' ? 600 : 400, fontSize: '.8rem',
                display: 'flex', alignItems: 'center', gap: '4px'
              }}>
                Anomalies / Failures
                {failedCount > 0 && <span style={{ background: '#ef4444', color: '#fff', borderRadius: '50%', padding: '1px 6px', fontSize: '.6rem', fontWeight: 700 }}>{failedCount}</span>}
              </button>
              <button onClick={() => setActiveTab('logs')} style={{
                background: 'none', border: 'none', padding: '.4rem .6rem', color: activeTab === 'logs' ? 'var(--text-primary)' : 'var(--text-muted)',
                borderBottom: activeTab === 'logs' ? '2px solid #3b82f6' : 'none', cursor: 'pointer', fontWeight: activeTab === 'logs' ? 600 : 400, fontSize: '.8rem'
              }}>Execution Logs ({logs.length})</button>
            </div>

            {activeTab === 'info' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
                  {[
                    ['Filename', doc.filename],
                    ['Type', doc.file_type],
                    ['Size', formatBytes(doc.file_size)],
                    ['Status', <span key="s" className="badge" style={statusStyle(doc.status)}>{doc.status}</span>],
                    ['Chunks', doc.total_chunks],
                    ['Pages', doc.total_pages],
                    ['Title', doc.title || '-'],
                    ['Author', doc.author || '-'],
                    ['Subject', doc.subject || '-'],
                    ['Doc Type', doc.doc_type || '-'],
                    ['Language', doc.language],
                    ['OCR', doc.is_ocr_processed ? 'Yes' : 'No'],
                    ['Unit', doc.unit || '-'],
                    ['Semester', doc.semester || '-'],
                    ['Citations', doc.citation_count ?? 0],
                    ['Last Referenced', doc.last_referenced ? formatDate(doc.last_referenced) : '-'],
                    ['File Path', doc.file_path || '-'],
                    ['Course', doc.course_name || doc.course_id || '-'],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                      <div style={{ marginTop: 2, wordBreak: 'break-all' }}>{value}</div>
                    </div>
                  ))}
                </div>
                {doc.owner && (
                  <div>
                    <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Owner</span>
                    <div style={{ marginTop: 2 }}>{doc.owner.full_name} ({doc.owner.email})</div>
                  </div>
                )}
                {doc.error_message && (
                  <div style={{ padding: '.5rem .75rem', background: 'rgba(239,68,68,0.1)', borderRadius: 'var(--radius-sm)', color: '#ef4444', fontSize: '.75rem' }}>
                    Error: {doc.error_message}
                  </div>
                )}
              </div>
            )}

            {activeTab === 'chunks' && (
              <div>
                {doc.chunks?.length > 0 ? (
                  <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                    {doc.chunks.map(c => (
                      <div key={c.id} style={{ padding: '.4rem .6rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <span className="badge" style={statusStyle('processing')}>#{c.chunk_index}</span>
                          {c.page_number && <span style={{ color: 'var(--text-muted)', marginLeft: '.5rem' }}>p.{c.page_number}</span>}
                          <span style={{ color: 'var(--text-muted)', marginLeft: '.5rem' }}>{c.chunk_type} · {c.token_count}t</span>
                          <div style={{ color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.content}</div>
                        </div>
                        <button onClick={() => setEditingChunk(c)} className="btn btn-ghost btn-icon" style={{ padding: '.25rem', color: 'var(--text-muted)', marginLeft: '.5rem' }} title="Edit/Repair Chunk">
                          <Edit2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>No chunks extracted</p>
                )}
              </div>
            )}

            {activeTab === 'failed' && (
              <div>
                {failedCount > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <div style={{ color: '#ef4444', fontSize: '.75rem', fontWeight: 600, marginBottom: '.25rem' }}>
                      Warning: Found {failedCount} anomalous or failed chunks in this document.
                    </div>
                    <div style={{ maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                      {failedChunksData.failed_chunks.map(c => (
                        <div key={c.id} style={{ padding: '.5rem .75rem', background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                              <span className="badge" style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}>Chunk #{c.chunk_index}</span>
                              <span style={{ color: 'var(--text-muted)' }}>Page: {c.page_number || '-'} · Tokens: {c.token_count}</span>
                            </div>
                            <div style={{ color: '#ef4444', fontWeight: 500, margin: '4px 0' }}>
                              Reasons: {c.reasons.join(', ')}
                            </div>
                            <div style={{ color: 'var(--text-muted)', background: 'rgba(0,0,0,0.1)', padding: '.3rem', borderRadius: '4px', fontStyle: 'italic', fontSize: '.7rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              Preview: {c.content_preview || '(empty content)'}
                            </div>
                          </div>
                          <button onClick={() => setEditingChunk(c)} className="btn btn-ghost btn-icon" style={{ padding: '.25rem', color: '#ef4444', marginLeft: '.5rem' }} title="Repair Chunk">
                            <Edit2 size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: '2rem', textAlign: 'center', color: '#34d399' }}>
                    <div style={{ fontSize: '1.25rem', marginBottom: '.25rem' }}>✓ No Anomalies Found</div>
                    <p style={{ color: 'var(--text-muted)', fontSize: '.75rem' }}>All chunks have valid content, tokens, and are correctly indexed in the vector store.</p>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'logs' && (
              <div style={{ background: '#0a0a0a', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius)', padding: '.75rem', fontFamily: 'monospace', fontSize: '.7rem', maxHeight: 280, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                {logs.length > 0 ? logs.map((log, idx) => {
                  let color = '#a3a3a3';
                  if (log.level === 'error') color = '#ef4444';
                  else if (log.level === 'warning') color = '#fbbf24';
                  else if (log.level === 'success') color = '#34d399';
                  else if (log.stage === 'parse') color = '#c084fc';
                  else if (log.stage === 'chunk') color = '#60a5fa';
                  else if (log.stage === 'embed') color = '#f472b6';
                  else if (log.stage === 'index') color = '#34d399';

                  return (
                    <div key={idx} style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-start', borderBottom: '1px solid rgba(255,255,255,0.03)', paddingBottom: '.2rem' }}>
                      <span style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                      <span style={{ color: color, fontWeight: 700, textTransform: 'uppercase', minWidth: 60, display: 'inline-block' }}>{log.stage}</span>
                      <span style={{ color: log.level === 'error' ? '#ef4444' : 'var(--text-primary)', wordBreak: 'break-all' }}>{log.message}</span>
                    </div>
                  );
                }) : (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem', fontFamily: 'sans-serif' }}>No execution logs recorded yet for this document.</p>
                )}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '.75rem', marginTop: '.25rem' }}>
              <button onClick={handleReprocess} className="btn" style={{ background: '#3b82f6', color: '#fff', padding: '.4rem 1rem', fontSize: '.75rem', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <RefreshCw size={12} /> Force Reprocess Ingestion
              </button>
              <button onClick={onClose} className="btn btn-ghost" style={{ padding: '.4rem 1rem', fontSize: '.75rem' }}>Close</button>
            </div>

          </div>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>Document not found</p>
        )}
      </Modal>

      {/* Manual Chunk Repair Modal */}
      {editingChunk && (
        <Modal open={!!editingChunk} onClose={() => setEditingChunk(null)} title={`Manual Repair & Indexing: Chunk #${editingChunk.chunk_index}`} maxWidth={600}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8125rem' }}>
            <div style={{ display: 'flex', gap: '1rem' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Page Number</label>
                <input type="number" value={editingChunk.page_number || ''} onChange={e => setEditingChunk({ ...editingChunk, page_number: parseInt(e.target.value) || null })} style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff', fontSize: '.8rem'
                }} />
              </div>
              <div style={{ flex: 2 }}>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Chunk Type</label>
                <select value={editingChunk.chunk_type || 'text'} onChange={e => setEditingChunk({ ...editingChunk, chunk_type: e.target.value })} style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff', fontSize: '.8rem'
                }}>
                  <option value="text">Text</option>
                  <option value="table">Table</option>
                  <option value="code">Code</option>
                  <option value="formula">Formula</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Content</label>
              <textarea value={editingChunk.content || ''} rows={10} onChange={e => setEditingChunk({ ...editingChunk, content: e.target.value })} style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 'var(--radius)', padding: '.5rem', color: '#fff', fontSize: '.8rem', fontFamily: 'monospace', resize: 'vertical'
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem' }}>
              <button onClick={() => setEditingChunk(null)} className="btn btn-ghost" style={{ padding: '.4rem 1rem', fontSize: '.75rem' }}>Cancel</button>
              <button onClick={() => handleEditSave(editingChunk.id, { content: editingChunk.content, page_number: editingChunk.page_number, chunk_type: editingChunk.chunk_type })} className="btn" style={{ background: '#34d399', color: '#fff', padding: '.4rem 1rem', fontSize: '.75rem' }}>Save & Re-Index</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}

// ══════════════════════════════════════════════════════════
// ORGANIZATIONS
// ══════════════════════════════════════════════════════════
function OrganizationsSection() {
  const [orgs, setOrgs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [planFilter, setPlanFilter] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/organizations', {
        params: { page, per_page: perPage, search, plan: planFilter },
      })
      setOrgs(data.organizations)
      setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }, [page, perPage, search, planFilter])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Organizations</h1>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchInput value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search organizations..." />
          <select value={planFilter} onChange={e => { setPlanFilter(e.target.value); setPage(1) }} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)', padding: '.4rem .6rem', fontSize: '.75rem', color: 'var(--text-primary)',
          }}>
            <option value="">All Plans</option>
            <option value="free">Free</option>
            <option value="pro">Pro</option>
            <option value="enterprise">Enterprise</option>
          </select>
        </div>
      </div>

      <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Owner</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Members</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Plan</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Status</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left', whiteSpace: 'nowrap' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : orgs.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No organizations found</td></tr>
              ) : orgs.map(o => (
                <tr key={o.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '.65rem .5rem' }}>
                    <div style={{ fontWeight: 500 }}>{o.name}</div>
                    <div style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>{o.slug}</div>
                  </td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{o.owner_name || o.owner_email || o.owner_id?.slice(0, 8)}</td>
                  <td style={{ padding: '.65rem .5rem' }}>{o.member_count}</td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <span className="badge" style={statusStyle(o.plan === 'enterprise' ? 'admin' : o.plan === 'pro' ? 'ta' : 'student')}>{o.plan}</span>
                  </td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <span className="badge" style={statusStyle(o.is_active ? 'active' : 'inactive')}>{o.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(o.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <Pagination page={page} perPage={perPage} total={total} onPageChange={setPage} onPerPageChange={v => { setPerPage(v); setPage(1) }} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// COURSES
// ══════════════════════════════════════════════════════════
function CoursesSection() {
  const [courses, setCourses] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/courses', { params: { page, per_page: perPage, search } })
      setCourses(data.courses); setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }, [page, perPage, search])

  useEffect(() => { fetchData() }, [fetchData])

  const openDetail = async (id) => {
    setDetailId(id); setDetailLoading(true); setDetail(null)
    try {
      const { data } = await api.get(`/admin/courses/${id}`)
      setDetail(data)
    } catch {} finally { setDetailLoading(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Courses</h1>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <SearchInput value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search by name, code, professor..." />
          <button onClick={() => downloadCSV(courses, 'courses.csv')} className="btn btn-ghost" style={{ padding: '.4rem .7rem', fontSize: '.75rem' }}><Download size={14} /> Export</button>
        </div>
      </div>
      <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Name</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Code</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Semester</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Professor</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Members</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Docs</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Conversations</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Status</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : courses.length === 0 ? (
                <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No courses found</td></tr>
              ) : courses.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '.65rem .5rem' }}><span style={{ fontWeight: 500 }}>{c.icon} {c.name}</span></td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{c.code || '-'}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{c.semester || '-'} {c.year || ''}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem' }}>{c.professor || '-'}</td>
                  <td style={{ padding: '.65rem .5rem' }}>{c.member_count}</td>
                  <td style={{ padding: '.65rem .5rem' }}>{c.document_count}</td>
                  <td style={{ padding: '.65rem .5rem' }}>{c.conversation_count}</td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <span className="badge" style={statusStyle(c.is_active ? 'active' : 'inactive')}>{c.is_active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td style={{ padding: '.65rem .5rem', textAlign: 'right' }}>
                    <button onClick={() => openDetail(c.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem' }} title="Details"><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
      <Pagination page={page} perPage={perPage} total={total} onPageChange={setPage} onPerPageChange={v => { setPerPage(v); setPage(1) }} />

      <Modal open={!!detailId} onClose={() => setDetailId(null)} title={detail?.name || 'Course Details'} maxWidth={700}>
        {detailLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={16} />)}</div>
        ) : detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8125rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
              {[
                ['Name', `${detail.icon} ${detail.name}`],
                ['Code', detail.code || '-'],
                ['Description', detail.description || '-'],
                ['Semester', detail.semester || '-'],
                ['Year', detail.year || '-'],
                ['Department', detail.department || '-'],
                ['Professor', detail.professor || '-'],
                ['Status', <span key="s" className="badge" style={statusStyle(detail.is_active ? 'active' : 'inactive')}>{detail.is_active ? 'Active' : 'Inactive'}</span>],
                ['Public', detail.is_public ? 'Yes' : 'No'],
                ['Members', detail.members?.length || 0],
                ['Documents', detail.documents?.length || 0],
                ['Messages', detail.message_count],
              ].map(([label, value]) => (
                <div key={label}><span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span><div style={{ marginTop: 2 }}>{value}</div></div>
              ))}
            </div>
            {detail.members?.length > 0 && (
              <div>
                <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Members ({detail.members.length})</span>
                <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                  {detail.members.map(m => (
                    <div key={m.user_id} style={{ padding: '.35rem .5rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{m.name || m.email || m.user_id.slice(0, 8)}</span>
                      <span className="badge" style={statusStyle(m.role)}>{m.role}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detail.documents?.length > 0 && (
              <div>
                <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Documents ({detail.documents.length})</span>
                <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                  {detail.documents.map(d => (
                    <div key={d.id} style={{ padding: '.35rem .5rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{d.filename}</span>
                      <span className="badge" style={statusStyle(d.status)}>{d.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detail.conversations?.length > 0 && (
              <div>
                <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recent Conversations ({detail.conversations.length})</span>
                <div style={{ maxHeight: 120, overflowY: 'auto', marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.25rem' }}>
                  {detail.conversations.map(c => (
                    <div key={c.id} style={{ padding: '.35rem .5rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem', display: 'flex', justifyContent: 'space-between' }}>
                      <span>{c.title} <span className="badge" style={statusStyle(c.mode)}>{c.mode}</span></span>
                      <span style={{ color: 'var(--text-muted)' }}>{formatDate(c.created_at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : <p style={{ color: 'var(--text-muted)' }}>Course not found</p>}
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// CONVERSATIONS
// ══════════════════════════════════════════════════════════
function ConversationsSection() {
  const [convs, setConvs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [modeFilter, setModeFilter] = useState('')
  const [detailId, setDetailId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/conversations', { params: { page, per_page: perPage, search, mode: modeFilter } })
      setConvs(data.conversations); setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }, [page, perPage, search, modeFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const openDetail = async (id) => {
    setDetailId(id); setDetailLoading(true); setDetail(null)
    try {
      const { data } = await api.get(`/admin/conversations/${id}`)
      setDetail(data)
    } catch {} finally { setDetailLoading(false) }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Conversations</h1>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <SearchInput value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search by title..." />
          <select value={modeFilter} onChange={e => { setModeFilter(e.target.value); setPage(1) }} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)', padding: '.4rem .6rem', fontSize: '.75rem', color: 'var(--text-primary)',
          }}>
            <option value="">All Modes</option>
            <option value="normal">Normal</option>
            <option value="strict">Strict</option>
            <option value="tutor">Tutor</option>
            <option value="exam">Exam</option>
            <option value="revision">Revision</option>
          </select>
          <button onClick={() => downloadCSV(convs.map(c => ({ ...c, created_at: formatDate(c.created_at) })), 'conversations.csv')} className="btn btn-ghost" style={{ padding: '.4rem .7rem', fontSize: '.75rem' }}><Download size={14} /> Export</button>
        </div>
      </div>
      <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Title</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>User</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Mode</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Messages</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Tokens</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Latency</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Confidence</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Feedback</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Bookmarked</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : convs.length === 0 ? (
                <tr><td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No conversations found</td></tr>
              ) : convs.map(c => (
                <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '.65rem .5rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.title}>{c.title}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{c.user_name || c.user_email || c.user_id?.slice(0, 8)}</td>
                  <td style={{ padding: '.65rem .5rem' }}><span className="badge" style={statusStyle(c.mode)}>{c.mode}</span></td>
                  <td style={{ padding: '.65rem .5rem' }}>{c.message_count}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{(c.total_tokens || 0).toLocaleString()}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{c.avg_latency ? `${c.avg_latency}ms` : '-'}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{c.avg_confidence || '-'}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem' }}>
                    {c.good_count || c.bad_count ? (
                      <span><span style={{ color: '#34d399' }}>+{c.good_count}</span>/<span style={{ color: '#ef4444' }}>-{c.bad_count}</span></span>
                    ) : '-'}
                  </td>
                  <td style={{ padding: '.65rem .5rem' }}>{c.is_bookmarked ? <span style={{ color: '#fbbf24' }}>&#9733;</span> : '-'}</td>
                  <td style={{ padding: '.65rem .5rem', textAlign: 'right' }}>
                    <button onClick={() => openDetail(c.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem' }} title="View Messages"><Eye size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
      <Pagination page={page} perPage={perPage} total={total} onPageChange={setPage} onPerPageChange={v => { setPerPage(v); setPage(1) }} />

      <Modal open={!!detailId} onClose={() => setDetailId(null)} title={detail?.title || 'Conversation'} maxWidth={800}>
        {detailLoading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={20} />)}</div>
        ) : detail ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8125rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '.75rem' }}>
              {[
                ['Title', detail.title],
                ['Mode', <span key="m" className="badge" style={statusStyle(detail.mode)}>{detail.mode}</span>],
                ['User', detail.user ? `${detail.user.full_name} (${detail.user.email})` : detail.user_id],
                ['Course ID', detail.course_id || '-'],
                ['Bookmarked', detail.is_bookmarked ? 'Yes' : 'No'],
                ['Messages', detail.message_count],
                ['Total Tokens', detail.total_tokens?.toLocaleString()],
                ['Avg Latency', detail.avg_latency ? `${detail.avg_latency}ms` : '-'],
                ['Avg Confidence', detail.avg_confidence || '-'],
              ].map(([label, value]) => (
                <div key={label}><span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span><div style={{ marginTop: 2 }}>{value}</div></div>
              ))}
            </div>
            {detail.messages?.length > 0 && (
              <div>
                <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Messages ({detail.messages.length})</span>
                <div style={{ maxHeight: 400, overflowY: 'auto', marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  {detail.messages.map(m => (
                    <div key={m.id} style={{
                      padding: '.6rem .75rem', borderRadius: 'var(--radius)',
                      background: m.role === 'user' ? 'rgba(96,165,250,0.08)' : 'rgba(52,211,153,0.06)',
                      borderLeft: `3px solid ${m.role === 'user' ? '#60a5fa' : '#34d399'}`,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.35rem', fontSize: '.7rem' }}>
                        <span style={{ fontWeight: 600, textTransform: 'uppercase' }}>{m.role}</span>
                        <span style={{ color: 'var(--text-muted)' }}>
                          {m.latency_ms ? `${m.latency_ms}ms` : ''}
                          {m.tokens_used ? ` · ${m.tokens_used}t` : ''}
                          {m.confidence ? ` · ${m.confidence}` : ''}
                          {m.feedback ? ` · ${m.feedback === 'good' ? '👍' : '👎'}` : ''}
                        </span>
                      </div>
                      <div style={{ fontSize: '.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word', lineHeight: 1.5 }}>{m.content}</div>
                      {m.citations && (
                        <div style={{ fontSize: '.65rem', color: 'var(--text-muted)', marginTop: '.35rem' }}>
                          Citations: {JSON.stringify(m.citations).slice(0, 300)}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : <p style={{ color: 'var(--text-muted)' }}>Conversation not found</p>}
      </Modal>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// BOOKMARKS
// ══════════════════════════════════════════════════════════
function BookmarksSection() {
  const [bookmarks, setBookmarks] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/bookmarks', { params: { page, per_page: perPage, search } })
      setBookmarks(data.bookmarks); setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }, [page, perPage, search])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Bookmarks</h1>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <SearchInput value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search bookmarks..." />
          <button onClick={() => downloadCSV(bookmarks, 'bookmarks.csv')} className="btn btn-ghost" style={{ padding: '.4rem .7rem', fontSize: '.75rem' }}><Download size={14} /> Export</button>
        </div>
      </div>
      <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Title</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>User</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Content Preview</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Tags</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left', whiteSpace: 'nowrap' }}>Created</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={5} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : bookmarks.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No bookmarks found</td></tr>
              ) : bookmarks.map(b => (
                <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '.65rem .5rem', fontWeight: 500 }}>{b.title}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>{b.user_name || b.user_email || b.user_id?.slice(0, 8)}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.content_preview}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem' }}>{b.tags ? Object.values(b.tags).join(', ') || '-' : '-'}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(b.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
      <Pagination page={page} perPage={perPage} total={total} onPageChange={setPage} onPerPageChange={v => { setPerPage(v); setPage(1) }} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// AUDIT
// ══════════════════════════════════════════════════════════
function AuditSection() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [actionFilter, setActionFilter] = useState('')
  const { addToast } = useToast()

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await api.get('/admin/audit', {
        params: { page, per_page: perPage, action: actionFilter },
      })
      setLogs(data.logs)
      setTotal(data.total)
    } catch {} finally { setLoading(false) }
  }, [page, perPage, actionFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const actions = [...new Set(logs.map(l => l.action))]

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Audit Log</h1>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={actionFilter} onChange={e => { setActionFilter(e.target.value); setPage(1) }} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)', padding: '.4rem .6rem', fontSize: '.75rem', color: 'var(--text-primary)',
          }}>
            <option value="">All Actions</option>
            {actions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <button onClick={() => downloadCSV(logs.map(l => ({ ...l, created_at: formatDate(l.created_at), details: JSON.stringify(l.details) })), 'audit.csv')} className="btn btn-ghost" style={{ padding: '.4rem .7rem', fontSize: '.75rem' }}>
            <Download size={14} /> Export
          </button>
        </div>
      </div>

      <GlassCard style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Time</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>User</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Action</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Resource</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>IP</th>
                <th style={{ padding: '.65rem .5rem', textAlign: 'left' }}>Details</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No audit entries found</td></tr>
              ) : logs.map(l => (
                <tr key={l.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{formatDate(l.created_at)}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem' }}>{l.user_id?.slice(0, 8)}...</td>
                  <td style={{ padding: '.65rem .5rem' }}>
                    <span className="badge" style={statusStyle('pending')}>{l.action}</span>
                  </td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>
                    {l.resource_type && <span>{l.resource_type}</span>}
                    {l.resource_id && <span style={{ marginLeft: '.35rem', fontSize: '.65rem', color: 'var(--text-muted)' }}>/ {l.resource_id.slice(0, 8)}</span>}
                  </td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>{l.ip_address || '-'}</td>
                  <td style={{ padding: '.65rem .5rem', fontSize: '.7rem', color: 'var(--text-muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.details ? JSON.stringify(l.details) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>

      <Pagination page={page} perPage={perPage} total={total} onPageChange={setPage} onPerPageChange={v => { setPerPage(v); setPage(1) }} />
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// SYSTEM
// ══════════════════════════════════════════════════════════
function SystemSection() {
  const [sys, setSys] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/admin/system').then(({ data }) => setSys(data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const fmtUptime = (s) => {
    if (!s) return '-'
    const d = Math.floor(s / 86400)
    const h = Math.floor((s % 86400) / 3600)
    const m = Math.floor((s % 3600) / 60)
    return `${d}d ${h}h ${m}m`
  }

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.25rem' }}>System Health</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {Array.from({ length: 6 }).map((_, i) => <GlassCard key={i} style={{ padding: '1.125rem' }}><Skeleton height={80} /></GlassCard>)}
        </div>
      </div>
    )
  }

  const cards = [
    {
      title: 'Server', icon: <Activity size={18} />,
      color: '#60a5fa',
      items: [
        ['Version', sys?.server?.version],
        ['Name', sys?.server?.name],
        ['Python', sys?.server?.python_version],
        ['OS', sys?.server?.os],
        ['OS Version', sys?.server?.os_version],
        ['Uptime', fmtUptime(sys?.server?.uptime_seconds)],
      ],
    },
    {
      title: 'Performance', icon: <TrendingUp size={18} />,
      color: '#fbbf24',
      items: [
        ['Avg Latency (7d)', sys?.performance?.avg_latency_7d_ms ? `${sys.performance.avg_latency_7d_ms}ms` : '-'],
        ['Error Rate', sys?.performance?.error_rate_pct ? `${sys.performance.error_rate_pct}%` : '0%'],
        ['RPS', sys?.performance?.rps],
        ['Msgs (24h)', sys?.performance?.msgs_24h?.toLocaleString()],
        ['Failed Tasks (7d)', sys?.performance?.failed_tasks_7d],
      ],
    },
    {
      title: 'Database', icon: <Database size={18} />,
      color: sys?.database?.status === 'connected' ? '#34d399' : '#ef4444',
      items: [
        ['Status', sys?.database?.status],
      ],
    },
    {
      title: 'Vector Store', icon: <Hash size={18} />,
      color: sys?.vector_store?.status === 'connected' ? '#34d399' : '#fbbf24',
      items: [
        ['Status', sys?.vector_store?.status],
        ['Total Chunks', sys?.vector_store?.total_chunks?.toLocaleString()],
      ],
    },
    {
      title: 'Ollama', icon: <Activity size={18} />,
      color: sys?.ollama?.status === 'connected' ? '#34d399' : '#ef4444',
      items: [
        ['Status', sys?.ollama?.status],
      ],
    },
    {
      title: 'Ingestion', icon: <FileText size={18} />,
      color: '#a78bfa',
      items: [
        ['Total Documents', sys?.ingestion?.total_documents?.toLocaleString()],
        ['Failure Rate', sys?.ingestion?.failure_rate_pct ? `${sys.ingestion.failure_rate_pct}%` : '0%'],
        ...Object.entries(sys?.ingestion?.by_status || {}).map(([k, v]) => [k, v]),
      ],
    },
  ]

  return (
    <div>
      <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.25rem' }}>System Health</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {cards.map(card => (
          <GlassCard key={card.title} style={{ padding: '1.125rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '.75rem' }}>
              <span style={{ color: card.color }}>{card.icon}</span>
              <h3 style={{ fontSize: '.8125rem', fontWeight: 600 }}>{card.title}</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
              {card.items.map(([label, value]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.75rem' }}>
                  <span style={{ color: 'var(--text-muted)', textTransform: 'capitalize' }}>{label}</span>
                  <span style={{ fontWeight: 500 }}>{value ?? '-'}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════
// SECURITY & ACCESS MANAGEMENT
// ══════════════════════════════════════════════════════════
function SecuritySection() {
  const [activeTab, setActiveTab] = useState('rbac') // rbac | apikeys | webhooks | flags
  const { addToast } = useToast()

  // 1. RBAC State
  const [rbacMatrix, setRbacMatrix] = useState({})
  const [loadingRbac, setLoadingRbac] = useState(false)

  // 2. API Keys State
  const [apiKeys, setApiKeys] = useState([])
  const [loadingKeys, setLoadingKeys] = useState(false)
  const [showKeyModal, setShowKeyModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyOrg, setNewKeyOrg] = useState('')
  const [newKeyOwner, setNewKeyOwner] = useState('')
  const [generatedKey, setGeneratedKey] = useState(null)

  // 3. Webhooks State
  const [webhooks, setWebhooks] = useState([])
  const [loadingWebhooks, setLoadingWebhooks] = useState(false)
  const [showWebhookModal, setShowWebhookModal] = useState(false)
  const [webhookUrl, setWebhookUrl] = useState('')
  const [webhookEvents, setWebhookEvents] = useState(['document.ingested'])
  const [webhookOrg, setWebhookOrg] = useState('')

  // 4. Feature Flags State
  const [orgs, setOrgs] = useState([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [loadingFlags, setLoadingFlags] = useState(false)
  const [featureFlags, setFeatureFlags] = useState({})

  // Constants
  const ALL_PERMISSIONS = [
    'documents:read', 'documents:write', 'documents:delete',
    'courses:read', 'courses:write',
    'chats:create', 'chats:delete',
    'web_search:use', 'custom_models:use',
    'org:edit_settings', 'org:manage_billing'
  ]
  const ALL_ROLES = ['student', 'ta', 'faculty', 'admin']
  const WEBHOOK_EVENT_OPTIONS = ['document.ingested', 'user.created', 'alert.triggered', 'billing.invoice_paid']

  // Fetch functions
  const fetchRbac = async () => {
    setLoadingRbac(true)
    try {
      const { data } = await api.get('/admin/security/roles')
      setRbacMatrix(data)
    } catch {
      addToast('Failed to load RBAC permissions', 'error')
    } finally { setLoadingRbac(false) }
  }

  const fetchApiKeys = async () => {
    setLoadingKeys(true)
    try {
      const { data } = await api.get('/admin/api-keys')
      setApiKeys(data)
    } catch {
      addToast('Failed to load API keys', 'error')
    } finally { setLoadingKeys(false) }
  }

  const fetchWebhooks = async () => {
    setLoadingWebhooks(true)
    try {
      const { data } = await api.get('/admin/webhook-subscriptions')
      setWebhooks(data)
    } catch {
      addToast('Failed to load webhook subscriptions', 'error')
    } finally { setLoadingWebhooks(false) }
  }

  const fetchOrgs = async () => {
    try {
      const { data } = await api.get('/admin/organizations')
      setOrgs(data.organizations || [])
      if (data.organizations?.length > 0) {
        setSelectedOrgId(data.organizations[0].id)
      }
    } catch {}
  }

  const fetchFlagsForOrg = async (orgId) => {
    if (!orgId) return
    setLoadingFlags(true)
    try {
      const { data } = await api.get(`/admin/organizations/${orgId}/feature-flags`)
      setFeatureFlags(data.feature_flags)
    } catch {
      addToast('Failed to load organization feature flags', 'error')
    } finally { setLoadingFlags(false) }
  }

  // UseEffects
  useEffect(() => {
    if (activeTab === 'rbac') fetchRbac()
    if (activeTab === 'apikeys') fetchApiKeys()
    if (activeTab === 'webhooks') fetchWebhooks()
    if (activeTab === 'flags') {
      fetchOrgs()
    }
  }, [activeTab])

  useEffect(() => {
    if (selectedOrgId) {
      fetchFlagsForOrg(selectedOrgId)
    }
  }, [selectedOrgId])

  // RBAC Handler
  const handleRbacCheckbox = (role, permission) => {
    setRbacMatrix(prev => {
      const current = prev[role] || []
      const updated = current.includes(permission)
        ? current.filter(p => p !== permission)
        : [...current, permission]
      return { ...prev, [role]: updated }
    })
  }

  const handleSaveRbac = async () => {
    try {
      await api.post('/admin/security/roles', { matrix: rbacMatrix })
      addToast('RBAC permissions updated successfully', 'success')
    } catch {
      addToast('Failed to save RBAC matrix', 'error')
    }
  }

  // API Key Handlers
  const handleCreateApiKey = async (e) => {
    e.preventDefault()
    if (!newKeyName || !newKeyOwner) {
      addToast('Please fill out all required fields', 'warning')
      return
    }
    try {
      const { data } = await api.post('/admin/api-keys', {
        name: newKeyName,
        organization_id: newKeyOrg || null,
        owner_id: newKeyOwner
      })
      setGeneratedKey(data)
      fetchApiKeys()
      setNewKeyName('')
      setNewKeyOrg('')
      setNewKeyOwner('')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to create key', 'error')
    }
  }

  const handleToggleKey = async (id) => {
    try {
      await api.put(`/admin/api-keys/${id}/toggle`)
      addToast('API key status toggled', 'success')
      fetchApiKeys()
    } catch {
      addToast('Failed to update API key status', 'error')
    }
  }

  const handleDeleteKey = async (id) => {
    if (!window.confirm('Are you sure you want to revoke and delete this API key? This will break any systems using it.')) return
    try {
      await api.delete(`/admin/api-keys/${id}`)
      addToast('API key revoked and deleted', 'success')
      fetchApiKeys()
    } catch {
      addToast('Failed to delete API key', 'error')
    }
  }

  // Webhook Handlers
  const handleCreateWebhook = async (e) => {
    e.preventDefault()
    if (!webhookUrl) {
      addToast('Please specify a webhook URL', 'warning')
      return
    }
    try {
      const { data } = await api.post('/admin/webhook-subscriptions', {
        url: webhookUrl,
        event_types: webhookEvents,
        organization_id: webhookOrg || null
      })
      addToast('Webhook subscription created', 'success')
      setShowWebhookModal(false)
      fetchWebhooks()
      setWebhookUrl('')
      setWebhookEvents(['document.ingested'])
      setWebhookOrg('')
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to create webhook', 'error')
    }
  }

  const handleToggleWebhook = async (id) => {
    try {
      await api.put(`/admin/webhook-subscriptions/${id}/toggle`)
      addToast('Webhook subscription status toggled', 'success')
      fetchWebhooks()
    } catch {
      addToast('Failed to update webhook subscription status', 'error')
    }
  }

  const handleDeleteWebhook = async (id) => {
    if (!window.confirm('Delete this webhook subscription?')) return
    try {
      await api.delete(`/admin/webhook-subscriptions/${id}`)
      addToast('Webhook subscription deleted', 'success')
      fetchWebhooks()
    } catch {
      addToast('Failed to delete webhook subscription', 'error')
    }
  }

  // Feature Flag Handlers
  const handleToggleFlag = async (flagName, currentValue) => {
    const updatedFlags = { ...featureFlags, [flagName]: !currentValue }
    setFeatureFlags(updatedFlags)
    try {
      await api.put(`/admin/organizations/${selectedOrgId}/feature-flags`, {
        feature_flags: updatedFlags
      })
      addToast(`Feature flag "${flagName}" updated successfully`, 'success')
    } catch {
      addToast('Failed to update feature flag', 'error')
      setFeatureFlags(featureFlags)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Security & Access Management</h1>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '1.5rem', paddingBottom: '.25rem' }}>
        {[
          ['rbac', 'Visual RBAC Editor'],
          ['apikeys', 'API Key Management'],
          ['webhooks', 'Webhook Subscriptions'],
          ['flags', 'Feature Flags (per Org)'],
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            style={{
              background: 'none', border: 'none', padding: '.4rem .6rem',
              color: activeTab === id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeTab === id ? '2px solid #3b82f6' : 'none',
              cursor: 'pointer', fontWeight: activeTab === id ? 600 : 400, fontSize: '.8rem'
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <GlassCard style={{ padding: '1.25rem' }}>
        
        {activeTab === 'rbac' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '.9rem', fontWeight: 600 }}>Visual Role-Based Access Control (RBAC)</h3>
                <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Directly toggle user capabilities and functional permissions across system roles.
                </p>
              </div>
              <button onClick={handleSaveRbac} className="btn" style={{ background: '#3b82f6', color: '#fff', fontSize: '.75rem', padding: '.4rem 1rem' }}>
                Save Matrix Configuration
              </button>
            </div>

            {loadingRbac ? (
              <div className="spinner" style={{ margin: '2rem auto' }} />
            ) : (
              <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 'var(--radius)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.75rem' }}>
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <th style={{ padding: '.75rem', textAlign: 'left', fontWeight: 600 }}>Capability / Permission</th>
                      {ALL_ROLES.map(role => (
                        <th key={role} style={{ padding: '.75rem', textAlign: 'center', fontWeight: 600, textTransform: 'capitalize', width: '120px' }}>
                          {role}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {ALL_PERMISSIONS.map(perm => (
                      <tr key={perm} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '.75rem', fontWeight: 500, fontFamily: 'monospace' }}>
                          {perm}
                        </td>
                        {ALL_ROLES.map(role => {
                          const checked = rbacMatrix[role]?.includes(perm) || false
                          return (
                            <td key={role} style={{ padding: '.75rem', textAlign: 'center' }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleRbacCheckbox(role, perm)}
                                style={{ transform: 'scale(1.1)', cursor: 'pointer' }}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'apikeys' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '.9rem', fontWeight: 600 }}>System Access API Keys</h3>
                <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Create and manage client keys for querying internal indexes and ingestion.
                </p>
              </div>
              <button onClick={() => { setShowKeyModal(true); setGeneratedKey(null); }} className="btn" style={{ background: '#3b82f6', color: '#fff', fontSize: '.75rem', padding: '.4rem 1rem' }}>
                + Generate API Key
              </button>
            </div>

            {loadingKeys ? (
              <div className="spinner" style={{ margin: '2rem auto' }} />
            ) : apiKeys.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.8rem' }}>
                No active API Keys found.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.75rem' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.06)', textTransform: 'uppercase', fontSize: '.65rem' }}>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Key Name</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Prefix</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Owner ID</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Organization ID</th>
                      <th style={{ padding: '.5rem', textAlign: 'center' }}>Active</th>
                      <th style={{ padding: '.5rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiKeys.map(k => (
                      <tr key={k.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '.65rem .5rem', fontWeight: 500 }}>{k.name}</td>
                        <td style={{ padding: '.65rem .5rem', fontFamily: 'monospace', color: '#fbbf24' }}>{k.key_prefix}...</td>
                        <td style={{ padding: '.65rem .5rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>{k.owner_id}</td>
                        <td style={{ padding: '.65rem .5rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>{k.organization_id || 'Global'}</td>
                        <td style={{ padding: '.65rem .5rem', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={k.is_active}
                            onChange={() => handleToggleKey(k.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '.65rem .5rem', textAlign: 'right' }}>
                          <button onClick={() => handleDeleteKey(k.id)} className="btn btn-ghost" style={{ padding: '.2rem .5rem', fontSize: '.7rem', color: '#ef4444' }}>
                            Revoke
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'webhooks' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '.9rem', fontWeight: 600 }}>Outgoing Webhook Receivers</h3>
                <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Receive live HTTP POST payloads for specific database and pipeline events.
                </p>
              </div>
              <button onClick={() => setShowWebhookModal(true)} className="btn" style={{ background: '#3b82f6', color: '#fff', fontSize: '.75rem', padding: '.4rem 1rem' }}>
                + Add Webhook Receiver
              </button>
            </div>

            {loadingWebhooks ? (
              <div className="spinner" style={{ margin: '2rem auto' }} />
            ) : webhooks.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.8rem' }}>
                No active Webhook Receivers registered.
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.75rem' }}>
                  <thead>
                    <tr style={{ color: 'var(--text-muted)', borderBottom: '1px solid rgba(255,255,255,0.06)', textTransform: 'uppercase', fontSize: '.65rem' }}>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Receiver URL</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Subscribed Events</th>
                      <th style={{ padding: '.5rem', textAlign: 'left' }}>Organization</th>
                      <th style={{ padding: '.5rem', textAlign: 'center' }}>Active</th>
                      <th style={{ padding: '.5rem', textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {webhooks.map(w => (
                      <tr key={w.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '.65rem .5rem', fontWeight: 500, wordBreak: 'break-all' }}>{w.url}</td>
                        <td style={{ padding: '.65rem .5rem' }}>
                          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
                            {w.event_types.map(ev => (
                              <span key={ev} style={{ background: 'rgba(255,255,255,0.06)', borderRadius: '3px', padding: '1px 5px', fontSize: '.65rem', fontFamily: 'monospace' }}>
                                {ev}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '.65rem .5rem', fontSize: '.7rem', color: 'var(--text-muted)' }}>{w.organization_id || 'Global'}</td>
                        <td style={{ padding: '.65rem .5rem', textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={w.is_active}
                            onChange={() => handleToggleWebhook(w.id)}
                            style={{ cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '.65rem .5rem', textAlign: 'right' }}>
                          <button onClick={() => handleDeleteWebhook(w.id)} className="btn btn-ghost" style={{ padding: '.2rem .5rem', fontSize: '.7rem', color: '#ef4444' }}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'flags' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ fontSize: '.9rem', fontWeight: 600 }}>Organization Feature Flags</h3>
                <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  Dynamically turn feature suites on or off for specific organization groups.
                </p>
              </div>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>Select Org:</span>
                <select
                  value={selectedOrgId}
                  onChange={e => setSelectedOrgId(e.target.value)}
                  style={{
                    background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--radius)', padding: '.4rem .6rem', fontSize: '.75rem', color: '#fff'
                  }}
                >
                  {orgs.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {loadingFlags ? (
              <div className="spinner" style={{ margin: '2rem auto' }} />
            ) : !selectedOrgId ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.8rem' }}>
                No Organizations available to manage feature flags.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                {[
                  ['enable_ocr', 'Enable OCR processing', 'Force OCR parsing on scanned/image-only documents during ingestion.'],
                  ['enable_web_search', 'Allow Web Search Queries', 'Allow users in this organization to query search engines for contextual answers.'],
                  ['custom_models', 'Advanced Model Access', 'Allow users to select custom high-capacity models (e.g. GPT-4, Claude).'],
                  ['voice_chat', 'Voice Integrations', 'Enable text-to-speech and speech-to-text features inside chats.'],
                  ['sandbox_mode', 'Sandbox Usage Plan', 'Mock org credit card payments and storage limitation thresholds.'],
                ].map(([flag, title, desc]) => {
                  const val = featureFlags[flag] || false
                  return (
                    <div key={flag} style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '.75rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)',
                      borderRadius: 'var(--radius)', transition: 'background .15s'
                    }} onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'} onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '.8rem' }}>{title}</div>
                        <div style={{ fontSize: '.7rem', color: 'var(--text-muted)', marginTop: 2 }}>{desc}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                        <span style={{ fontSize: '.7rem', color: val ? '#34d399' : 'var(--text-muted)', fontWeight: 600 }}>
                          {val ? 'ENABLED' : 'DISABLED'}
                        </span>
                        <input
                          type="checkbox"
                          checked={val}
                          onChange={() => handleToggleFlag(flag, val)}
                          style={{
                            width: '32px', height: '18px', cursor: 'pointer',
                            accentColor: '#3b82f6'
                          }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </GlassCard>

      {/* Generate API Key Modal */}
      {showKeyModal && (
        <Modal open={showKeyModal} onClose={() => setShowKeyModal(false)} title="Generate Client API Key" maxWidth={500}>
          {generatedKey ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8rem' }}>
              <div style={{ padding: '.75rem', background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 'var(--radius)', color: '#34d399' }}>
                <strong>Success!</strong> API Key has been generated. Copy it now; you will not be able to retrieve it again.
              </div>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Key Secret Token</label>
                <textarea
                  readOnly
                  value={generatedKey.raw_key}
                  style={{
                    width: '100%', background: '#000', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 'var(--radius)', padding: '.5rem', color: '#fbbf24', fontFamily: 'monospace',
                    fontSize: '.85rem', height: '60px', resize: 'none'
                  }}
                  onClick={e => e.target.select()}
                />
                <span style={{ fontSize: '.65rem', color: 'var(--text-muted)' }}>Click text box to select all.</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '.5rem' }}>
                <button onClick={() => setShowKeyModal(false)} className="btn" style={{ background: '#3b82f6', color: '#fff', fontSize: '.75rem', padding: '.4rem 1.2rem' }}>
                  Done & Close
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreateApiKey} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8rem' }}>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Key Identification Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ingestion Pipeline System"
                  value={newKeyName}
                  onChange={e => setNewKeyName(e.target.value)}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Owner User ID (System Admin / User)</label>
                <input
                  type="text"
                  required
                  placeholder="Paste SQLite User UUID"
                  value={newKeyOwner}
                  onChange={e => setNewKeyOwner(e.target.value)}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
                  }}
                />
              </div>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Organization Scope (Optional)</label>
                <select
                  value={newKeyOrg}
                  onChange={e => setNewKeyOrg(e.target.value)}
                  style={{
                    width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
                  }}
                >
                  <option value="">Global / Scope All</option>
                  {orgs.map(org => (
                    <option key={org.id} value={org.id}>{org.name}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '.75rem', marginTop: '.25rem' }}>
                <button type="button" onClick={() => setShowKeyModal(false)} className="btn btn-ghost" style={{ padding: '.4rem 1rem', fontSize: '.75rem' }}>Cancel</button>
                <button type="submit" className="btn" style={{ background: '#3b82f6', color: '#fff', padding: '.4rem 1.2rem', fontSize: '.75rem' }}>Generate</button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {/* Add Webhook Modal */}
      {showWebhookModal && (
        <Modal open={showWebhookModal} onClose={() => setShowWebhookModal(false)} title="Register Outgoing Webhook Receiver" maxWidth={500}>
          <form onSubmit={handleCreateWebhook} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8rem' }}>
            <div>
              <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Webhook HTTP Endpoint URL</label>
              <input
                type="url"
                required
                placeholder="https://yourdomain.com/webhooks/incoming"
                value={webhookUrl}
                onChange={e => setWebhookUrl(e.target.value)}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Subscribe to Events</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', padding: '.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)', borderRadius: 'var(--radius)' }}>
                {WEBHOOK_EVENT_OPTIONS.map(opt => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: '.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={webhookEvents.includes(opt)}
                      onChange={() => {
                        setWebhookEvents(prev =>
                          prev.includes(opt) ? prev.filter(x => x !== opt) : [...prev, opt]
                        )
                      }}
                    />
                    <span style={{ fontFamily: 'monospace', fontSize: '.7rem' }}>{opt}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Organization Scope (Optional)</label>
              <select
                value={webhookOrg}
                onChange={e => setWebhookOrg(e.target.value)}
                style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
                }}
              >
                <option value="">Global / Scope All</option>
                {orgs.map(org => (
                  <option key={org.id} value={org.id}>{org.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '.75rem', marginTop: '.25rem' }}>
              <button type="button" onClick={() => setShowWebhookModal(false)} className="btn btn-ghost" style={{ padding: '.4rem 1rem', fontSize: '.75rem' }}>Cancel</button>
              <button type="submit" className="btn" style={{ background: '#3b82f6', color: '#fff', padding: '.4rem 1.2rem', fontSize: '.75rem' }}>Add Receiver</button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  )
}

// ══════════════════════════════════════════════════════════
// DATA LIFECYCLE MANAGEMENT
// ══════════════════════════════════════════════════════════
function LifecycleSection() {
  const [activeSubTab, setActiveSubTab] = useState('retention')
  const [policies, setPolicies] = useState([])
  const [backups, setBackups] = useState([])
  const [gdprRequests, setGdprRequests] = useState([])
  const [archivedDocs, setArchivedDocs] = useState([])
  const [orgs, setOrgs] = useState([])
  
  const [loading, setLoading] = useState(false)
  const [triggeringCleanup, setTriggeringCleanup] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  
  // Modals state
  const [showPolicyModal, setShowPolicyModal] = useState(false)
  const [showGdprModal, setShowGdprModal] = useState(false)
  
  // Policy form state
  const [policyType, setPolicyType] = useState('document_age')
  const [policyOrgId, setPolicyOrgId] = useState('')
  const [policyRetentionDays, setPolicyRetentionDays] = useState(30)
  const [policyAction, setPolicyAction] = useState('archive')
  const [policyIsActive, setPolicyIsActive] = useState(true)
  
  // GDPR request form state
  const [gdprEmail, setGdprEmail] = useState('')
  const [gdprType, setGdprType] = useState('export')
  
  const { addToast } = useToast()

  const fetchRetentionPolicies = async () => {
    try {
      const { data } = await api.get('/admin/lifecycle/retention')
      setPolicies(data)
    } catch (e) {
      addToast('Failed to load retention policies', 'error')
    }
  }

  const fetchBackups = async () => {
    try {
      const { data } = await api.get('/admin/lifecycle/backups')
      setBackups(data)
    } catch (e) {
      addToast('Failed to load database backups', 'error')
    }
  }

  const fetchGdprRequests = async () => {
    try {
      const { data } = await api.get('/admin/lifecycle/gdpr')
      setGdprRequests(data)
    } catch (e) {
      addToast('Failed to load GDPR requests', 'error')
    }
  }

  const fetchArchivedDocs = async () => {
    try {
      const { data } = await api.get('/admin/documents', { params: { status: 'archived' } })
      setArchivedDocs(data.documents || [])
    } catch (e) {
      addToast('Failed to load archived documents', 'error')
    }
  }

  const fetchOrgs = async () => {
    try {
      const { data } = await api.get('/admin/organizations')
      setOrgs(data.organizations || data || [])
    } catch (e) {
      console.error(e)
    }
  }

  const loadData = useCallback(() => {
    setLoading(true)
    const promises = []
    if (activeSubTab === 'retention') {
      promises.push(fetchRetentionPolicies())
      promises.push(fetchOrgs())
    } else if (activeSubTab === 'backups') {
      promises.push(fetchBackups())
    } else if (activeSubTab === 'gdpr') {
      promises.push(fetchGdprRequests())
    } else if (activeSubTab === 'archive') {
      promises.push(fetchArchivedDocs())
    }
    
    Promise.all(promises).finally(() => setLoading(false))
  }, [activeSubTab])

  useEffect(() => {
    loadData()
  }, [loadData])

  // --- Retention Policies actions ---
  const handleCreatePolicy = async (e) => {
    e.preventDefault()
    try {
      await api.post('/admin/lifecycle/retention', {
        organization_id: policyOrgId || null,
        policy_type: policyType,
        retention_days: parseInt(policyRetentionDays),
        action: policyAction,
        is_active: policyIsActive
      })
      addToast('Retention policy saved successfully', 'success')
      setShowPolicyModal(false)
      fetchRetentionPolicies()
    } catch (e) {
      addToast(e.response?.data?.detail || 'Failed to save retention policy', 'error')
    }
  }

  const handleDeletePolicy = async (policyId) => {
    if (!window.confirm('Are you sure you want to delete this policy?')) return
    try {
      await api.delete(`/admin/lifecycle/retention/${policyId}`)
      addToast('Policy deleted successfully', 'success')
      fetchRetentionPolicies()
    } catch (e) {
      addToast('Failed to delete policy', 'error')
    }
  }

  const handleTriggerCleanup = async () => {
    setTriggeringCleanup(true)
    try {
      await api.post('/admin/lifecycle/retention/cleanup/trigger')
      addToast('Retention policy cleanup triggered in background', 'success')
    } catch (e) {
      addToast('Failed to trigger retention cleanup', 'error')
    } finally {
      setTriggeringCleanup(false)
    }
  }

  // --- Backups actions ---
  const handleTriggerBackup = async () => {
    setCreatingBackup(true)
    try {
      await api.post('/admin/lifecycle/backups')
      addToast('Database backup completed successfully', 'success')
      fetchBackups()
    } catch (e) {
      addToast(e.response?.data?.detail || 'Backup failed', 'error')
    } finally {
      setCreatingBackup(false)
    }
  }

  const handleRestoreBackup = async (backup) => {
    if (!window.confirm(`Warning: Restoring backup "${backup.filename}" will overwrite all current system data. Are you absolutely sure?`)) return
    try {
      await api.post(`/admin/lifecycle/backups/${backup.id}/restore`)
      addToast('System database restored successfully', 'success')
    } catch (e) {
      addToast('Failed to restore backup', 'error')
    }
  }

  // --- GDPR actions ---
  const handleCreateGdprRequest = async (e) => {
    e.preventDefault()
    try {
      await api.post('/admin/lifecycle/gdpr', {
        user_email: gdprEmail,
        request_type: gdprType
      })
      addToast(`GDPR ${gdprType} request submitted successfully`, 'success')
      setShowGdprModal(false)
      setGdprEmail('')
      fetchGdprRequests()
    } catch (e) {
      addToast(e.response?.data?.detail || 'Failed to submit GDPR request', 'error')
    }
  }

  const handleDownloadExport = (req) => {
    const downloadUrl = `${api.defaults.baseURL || ''}${req.download_url}`
    window.open(downloadUrl, '_blank')
  }

  // --- Archive Tier actions ---
  const handleRestoreDoc = async (docId) => {
    try {
      await api.post(`/admin/lifecycle/documents/${docId}/restore`)
      addToast('Document restored and chunks re-indexed successfully', 'success')
      fetchArchivedDocs()
    } catch (e) {
      addToast(e.response?.data?.detail || 'Failed to restore document', 'error')
    }
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <h1 style={{ fontSize: '1.35rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            <HardDrive size={22} style={{ color: '#3b82f6' }} />
            Data Lifecycle & Compliance
          </h1>
          <p style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: 2 }}>
            Manage document retention, backups, GDPR user export/deletion, and archive tiers.
          </p>
        </div>
      </div>

      {/* Sub tabs switcher */}
      <div style={{ display: 'flex', gap: '.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '1.25rem' }}>
        {[
          { id: 'retention', label: 'Retention Policies', count: policies.length },
          { id: 'backups', label: 'Database Backups', count: backups.length },
          { id: 'gdpr', label: 'GDPR / Governance', count: gdprRequests.length },
          { id: 'archive', label: 'Cold Storage / Archive', count: archivedDocs.length }
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setActiveSubTab(t.id)}
            style={{
              background: 'none', border: 'none', padding: '.6rem .9rem',
              color: activeSubTab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: activeSubTab === t.id ? '2px solid #3b82f6' : 'none',
              cursor: 'pointer', fontWeight: activeSubTab === t.id ? 600 : 400,
              fontSize: '.8rem', transition: 'all .15s', display: 'flex', alignItems: 'center', gap: '.4rem'
            }}
          >
            {t.label}
            {t.count > 0 && (
              <span style={{ fontSize: '.65rem', background: 'rgba(255,255,255,0.06)', padding: '1px 6px', borderRadius: 99, color: 'var(--text-muted)' }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Retention Policies Tab */}
      {activeSubTab === 'retention' && (
        <div>
          <div style={{ display: 'flex', gap: '.5rem', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button
              onClick={handleTriggerCleanup}
              disabled={triggeringCleanup}
              className="btn btn-ghost"
              style={{ padding: '.4rem .9rem', fontSize: '.75rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}
            >
              <RefreshCw size={14} className={triggeringCleanup ? 'spin' : ''} />
              Run Cleanup Task
            </button>
            <button
              onClick={() => {
                setPolicyOrgId('')
                setPolicyType('document_age')
                setPolicyRetentionDays(30)
                setPolicyAction('archive')
                setPolicyIsActive(true)
                setShowPolicyModal(true)
              }}
              className="btn"
              style={{ background: '#3b82f6', color: '#fff', padding: '.4rem .9rem', fontSize: '.75rem' }}
            >
              + Create Policy
            </button>
          </div>

          <GlassCard style={{ padding: '0' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Policy Type</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Org Scope</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Retention Period</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Action</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Created</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <RefreshCw size={18} className="spin" style={{ marginBottom: '.5rem' }} />
                        <div>Loading policies...</div>
                      </td>
                    </tr>
                  ) : policies.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No retention policies configured yet.
                      </td>
                    </tr>
                  ) : (
                    policies.map(p => (
                      <tr key={p.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '.75rem 1rem', fontFamily: 'monospace', color: '#60a5fa' }}>{p.policy_type}</td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          {p.organization_id ? orgs.find(o => o.id === p.organization_id)?.name || p.organization_id : (
                            <span style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Global / All</span>
                          )}
                        </td>
                        <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>{p.retention_days} Days</td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          <span style={{
                            fontSize: '.7rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                            background: p.action === 'delete' ? 'rgba(239,68,68,0.12)' : 'rgba(251,191,36,0.12)',
                            color: p.action === 'delete' ? '#ef4444' : '#fbbf24'
                          }}>
                            {p.action.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          <span style={{
                            fontSize: '.7rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                            background: p.is_active ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.06)',
                            color: p.is_active ? '#34d399' : 'var(--text-muted)'
                          }}>
                            {p.is_active ? 'ACTIVE' : 'INACTIVE'}
                          </span>
                        </td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{new Date(p.created_at).toLocaleDateString()}</td>
                        <td style={{ padding: '.75rem 1rem', textAlign: 'right' }}>
                          <button
                            onClick={() => handleDeletePolicy(p.id)}
                            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '.2rem' }}
                            title="Delete Policy"
                          >
                            <Trash2 size={15} />
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Database Backups Tab */}
      {activeSubTab === 'backups' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button
              onClick={handleTriggerBackup}
              disabled={creatingBackup}
              className="btn"
              style={{ background: '#3b82f6', color: '#fff', padding: '.4rem .9rem', fontSize: '.75rem', display: 'flex', alignItems: 'center', gap: '.4rem' }}
            >
              <Database size={14} />
              {creatingBackup ? 'Backing up...' : 'Create Backup'}
            </button>
          </div>

          <GlassCard style={{ padding: '0' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>File Name</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>File Size</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Created</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <RefreshCw size={18} className="spin" style={{ marginBottom: '.5rem' }} />
                        <div>Loading backup history...</div>
                      </td>
                    </tr>
                  ) : backups.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No backups created yet.
                      </td>
                    </tr>
                  ) : (
                    backups.map(b => (
                      <tr key={b.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>{b.filename}</td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{formatBytes(b.file_size)}</td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          <span style={{
                            fontSize: '.7rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                            background: b.status === 'completed' ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
                            color: b.status === 'completed' ? '#34d399' : '#ef4444'
                          }}>
                            {b.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{new Date(b.created_at).toLocaleString()}</td>
                        <td style={{ padding: '.75rem 1rem', textAlign: 'right' }}>
                          <button
                            onClick={() => handleRestoreBackup(b)}
                            className="btn btn-ghost"
                            style={{ padding: '.2rem .5rem', fontSize: '.7rem', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}
                          >
                            Restore Data
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      )}

      {/* GDPR & Governance Tab */}
      {activeSubTab === 'gdpr' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
            <button
              onClick={() => {
                setGdprEmail('')
                setGdprType('export')
                setShowGdprModal(true)
              }}
              className="btn"
              style={{ background: '#3b82f6', color: '#fff', padding: '.4rem .9rem', fontSize: '.75rem' }}
            >
              + Submit GDPR Request
            </button>
          </div>

          <GlassCard style={{ padding: '0' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>User ID Scope</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Request Type</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Submitted</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Completed</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Download / Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <RefreshCw size={18} className="spin" style={{ marginBottom: '.5rem' }} />
                        <div>Loading GDPR logs...</div>
                      </td>
                    </tr>
                  ) : gdprRequests.length === 0 ? (
                    <tr>
                      <td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No GDPR export or deletion requests submitted.
                      </td>
                    </tr>
                  ) : (
                    gdprRequests.map(r => (
                      <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '.75rem 1rem', fontFamily: 'monospace' }}>{r.user_id}</td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          <span style={{
                            fontSize: '.7rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                            background: r.request_type === 'delete' ? 'rgba(239,68,68,0.12)' : 'rgba(96,165,250,0.12)',
                            color: r.request_type === 'delete' ? '#ef4444' : '#60a5fa'
                          }}>
                            {r.request_type.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '.75rem 1rem' }}>
                          <span style={{
                            fontSize: '.7rem', padding: '2px 8px', borderRadius: 4, fontWeight: 600,
                            background: r.status === 'completed' ? 'rgba(52,211,153,0.12)' : 'rgba(251,191,36,0.12)',
                            color: r.status === 'completed' ? '#34d399' : '#fbbf24'
                          }}>
                            {r.status.toUpperCase()}
                          </span>
                        </td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{new Date(r.created_at).toLocaleString()}</td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>
                          {r.completed_at ? new Date(r.completed_at).toLocaleString() : '-'}
                        </td>
                        <td style={{ padding: '.75rem 1rem', textAlign: 'right' }}>
                          {r.request_type === 'export' && r.status === 'completed' && r.download_url && (
                            <button
                              onClick={() => handleDownloadExport(r)}
                              className="btn btn-ghost"
                              style={{ padding: '.2rem .5rem', fontSize: '.7rem', color: '#34d399', border: '1px solid rgba(52,211,153,0.2)', display: 'inline-flex', alignItems: 'center', gap: '.25rem' }}
                            >
                              <Download size={12} />
                              Download Zip
                            </button>
                          )}
                          {r.request_type === 'delete' && r.status === 'completed' && (
                            <span style={{ color: 'var(--text-muted)', fontSize: '.7rem', fontStyle: 'italic' }}>Permanently Cleared</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Cold Storage / Archive Tab */}
      {activeSubTab === 'archive' && (
        <div>
          <GlassCard style={{ padding: '0', marginTop: '1rem' }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Document Name</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>File Type</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>File Size</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>Archived Date</th>
                    <th style={{ padding: '.75rem 1rem', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        <RefreshCw size={18} className="spin" style={{ marginBottom: '.5rem' }} />
                        <div>Loading archived files...</div>
                      </td>
                    </tr>
                  ) : archivedDocs.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                        No archived/cold documents found.
                      </td>
                    </tr>
                  ) : (
                    archivedDocs.map(d => (
                      <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>{d.original_filename}</td>
                        <td style={{ padding: '.75rem 1rem', fontFamily: 'monospace' }}>{d.file_type.toUpperCase()}</td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{formatBytes(d.file_size)}</td>
                        <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{new Date(d.updated_at || d.created_at).toLocaleDateString()}</td>
                        <td style={{ padding: '.75rem 1rem', textAlign: 'right' }}>
                          <button
                            onClick={() => handleRestoreDoc(d.id)}
                            className="btn btn-ghost"
                            style={{ padding: '.2rem .5rem', fontSize: '.7rem', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}
                          >
                            Restore to Active Index
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </div>
      )}

      {/* Retention Policy Modal */}
      <Modal open={showPolicyModal} title="Create Retention Policy" onClose={() => setShowPolicyModal(false)}>
        <form onSubmit={handleCreatePolicy} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Policy Type</label>
            <select
              value={policyType}
              onChange={e => setPolicyType(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
              }}
            >
              <option value="document_age">Document Age</option>
              <option value="audit_log_age">Audit Log Age</option>
            </select>
          </div>
          
          <div>
            <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Organization Scope</label>
            <select
              value={policyOrgId}
              onChange={e => setPolicyOrgId(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
              }}
            >
              <option value="">Global / Scope All</option>
              {orgs.map(org => (
                <option key={org.id} value={org.id}>{org.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Retention Period (Days)</label>
            <input
              type="number"
              min="1"
              required
              value={policyRetentionDays}
              onChange={e => setPolicyRetentionDays(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
              }}
            />
          </div>

          <div>
            <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Action Type</label>
            <select
              value={policyAction}
              onChange={e => setPolicyAction(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
              }}
            >
              <option value="archive">Archive (Cold Storage)</option>
              <option value="delete">Hard Delete (Clear completely)</option>
            </select>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', margin: '.25rem 0' }}>
            <input
              type="checkbox"
              id="policyIsActive"
              checked={policyIsActive}
              onChange={e => setPolicyIsActive(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            <label htmlFor="policyIsActive" style={{ fontSize: '.75rem', cursor: 'pointer', color: '#fff' }}>
              Enable this retention policy immediately
            </label>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '.75rem', marginTop: '.25rem' }}>
            <button type="button" onClick={() => setShowPolicyModal(false)} className="btn btn-ghost" style={{ padding: '.4rem 1rem', fontSize: '.75rem' }}>Cancel</button>
            <button type="submit" className="btn" style={{ background: '#3b82f6', color: '#fff', padding: '.4rem 1.2rem', fontSize: '.75rem' }}>Save Policy</button>
          </div>
        </form>
      </Modal>

      {/* GDPR Submit Modal */}
      <Modal open={showGdprModal} title="Submit GDPR Request" onClose={() => setShowGdprModal(false)}>
        <form onSubmit={handleCreateGdprRequest} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div>
            <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>User Email</label>
            <input
              type="email"
              required
              placeholder="user@example.com"
              value={gdprEmail}
              onChange={e => setGdprEmail(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
              }}
            />
          </div>
          
          <div>
            <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Request Action</label>
            <select
              value={gdprType}
              onChange={e => setGdprType(e.target.value)}
              style={{
                width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff'
              }}
            >
              <option value="export">Data Export (ZIP package)</option>
              <option value="delete">Right to be Forgotten (Delete & Anonymize)</option>
            </select>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '.75rem', marginTop: '.25rem' }}>
            <button type="button" onClick={() => setShowGdprModal(false)} className="btn btn-ghost" style={{ padding: '.4rem 1rem', fontSize: '.75rem' }}>Cancel</button>
            <button type="submit" className="btn" style={{ background: '#3b82f6', color: '#fff', padding: '.4rem 1.2rem', fontSize: '.75rem' }}>Submit Request</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function SearchVectorSection() {
  const [tuning, setTuning] = useState({
    hybrid_alpha: 0.5,
    query_expansion_enabled: true,
    hyde_enabled: true,
    rerank_enabled: true,
    rerank_top_k: 5,
    retrieval_top_k: 10,
  })
  const [metrics, setMetrics] = useState(null)
  const [drift, setDrift] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [recalculating, setRecalculating] = useState(false)
  const { addToast } = useToast()

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const [tRes, mRes, dRes] = await Promise.all([
        api.get('/admin/search/tuning'),
        api.get('/admin/search/metrics'),
        api.get('/admin/search/drift'),
      ])
      setTuning(tRes.data)
      setMetrics(mRes.data)
      setDrift(dRes.data)
    } catch (err) {
      addToast('Failed to load search and retrieval configurations', 'error')
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    loadData()
  }, [loadData])

  const handleSaveTuning = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/admin/search/tuning', tuning)
      addToast('Search tuning configuration saved successfully', 'success')
    } catch (err) {
      addToast('Failed to save tuning configuration', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleRecalculateDrift = async () => {
    setRecalculating(true)
    try {
      const dRes = await api.get('/admin/search/drift')
      setDrift(dRes.data)
      addToast('Embedding drift recalculated successfully', 'success')
    } catch (err) {
      addToast('Failed to recalculate embedding drift', 'error')
    } finally {
      setRecalculating(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: '2rem 0' }}>
        <div style={{ marginBottom: '2rem' }}>
          <Skeleton height={24} width={200} style={{ marginBottom: 8 }} />
          <Skeleton height={16} width={350} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
          <GlassCard style={{ padding: '1.5rem' }}><Skeleton height={250} /></GlassCard>
          <GlassCard style={{ padding: '1.5rem' }}><Skeleton height={250} /></GlassCard>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0 }}>Search & Vector Retrieval</h1>
        <p style={{ fontSize: '.8125rem', color: 'var(--text-muted)', marginTop: '.25rem' }}>
          Tune hybrid search parameters, monitor search CTR quality, and audit embedding space drift.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr', lg: 'repeat(2, 1fr)', gap: '1.5rem', alignItems: 'start' }} className="search-grid">
        {/* Left Column: Tuning Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <GlassCard style={{ padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '.75rem' }}>
              <Zap size={18} style={{ color: '#fbbf24' }} />
              <h2 style={{ fontSize: '.95rem', fontWeight: 700, margin: 0 }}>Hybrid Search Optimization</h2>
            </div>

            <form onSubmit={handleSaveTuning} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.5rem', alignItems: 'center' }}>
                  <label style={{ fontSize: '.8rem', fontWeight: 600 }}>Hybrid Retrieval Blend (Alpha)</label>
                  <span style={{ fontSize: '.8rem', fontWeight: 700, color: '#3b82f6', background: 'rgba(59,130,246,0.12)', padding: '2px 8px', borderRadius: 4 }}>
                    {tuning.hybrid_alpha.toFixed(2)}
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={tuning.hybrid_alpha}
                  onChange={e => setTuning({ ...tuning, hybrid_alpha: parseFloat(e.target.value) })}
                  style={{ width: '100%', cursor: 'pointer', height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.1)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: '.7rem', color: 'var(--text-muted)' }}>
                  <span>Keyword (BM25 Only)</span>
                  <span>Balanced</span>
                  <span>Dense Vector (ChromaDB Only)</span>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem' }}>
                <div>
                  <label style={{ fontSize: '.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Retrieval Top-K (Raw)</label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={tuning.retrieval_top_k}
                    onChange={e => setTuning({ ...tuning, retrieval_top_k: parseInt(e.target.value) || 10 })}
                    style={{
                      width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff', fontSize: '.8rem'
                    }}
                  />
                </div>
                <div>
                  <label style={{ fontSize: '.75rem', color: 'var(--text-muted)', display: 'block', marginBottom: 4 }}>Rerank Top-K (Final)</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={tuning.rerank_top_k}
                    onChange={e => setTuning({ ...tuning, rerank_top_k: parseInt(e.target.value) || 5 })}
                    style={{
                      width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 'var(--radius)', padding: '.4rem .6rem', color: '#fff', fontSize: '.8rem'
                    }}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', marginTop: '.25rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '.8rem', fontWeight: 600, display: 'block' }}>Query Expansion</span>
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>Generate LLM search query variants</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={tuning.query_expansion_enabled}
                    onChange={e => setTuning({ ...tuning, query_expansion_enabled: e.target.checked })}
                    style={{ width: 34, height: 18, cursor: 'pointer' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '.8rem', fontWeight: 600, display: 'block' }}>HyDE (Hypothetical Doc Embeddings)</span>
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>Use hypothetical answers for retrieval</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={tuning.hyde_enabled}
                    onChange={e => setTuning({ ...tuning, hyde_enabled: e.target.checked })}
                    style={{ width: 34, height: 18, cursor: 'pointer' }}
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <span style={{ fontSize: '.8rem', fontWeight: 600, display: 'block' }}>Cohere / Cross-Encoder Reranking</span>
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>Enable high-precision ranking stage</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={tuning.rerank_enabled}
                    onChange={e => setTuning({ ...tuning, rerank_enabled: e.target.checked })}
                    style={{ width: 34, height: 18, cursor: 'pointer' }}
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={saving}
                className="btn"
                style={{
                  background: '#3b82f6', color: '#fff', marginTop: '.5rem',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem'
                }}
              >
                {saving ? 'Saving...' : 'Apply Tuning Parameters'}
              </button>
            </form>
          </GlassCard>

          {/* Drift Detection Panel */}
          {drift && (
            <GlassCard style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '.75rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                  <Gauge size={18} style={{ color: drift.status === 'stable' ? '#34d399' : (drift.status === 'warning' ? '#fbbf24' : '#ef4444') }} />
                  <h2 style={{ fontSize: '.95rem', fontWeight: 700, margin: 0 }}>Embedding Space Drift</h2>
                </div>
                <button
                  onClick={handleRecalculateDrift}
                  disabled={recalculating}
                  className="btn btn-ghost"
                  style={{ padding: '.25rem .5rem', fontSize: '.75rem', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <RefreshCw size={11} className={recalculating ? 'spin' : ''} />
                  Recalculate
                </button>
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', marginBottom: '1.25rem' }}>
                <div style={{
                  width: 80, height: 80, borderRadius: '50%',
                  border: `4px solid ${drift.status === 'stable' ? '#34d399' : (drift.status === 'warning' ? '#fbbf24' : '#ef4444')}`,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(255,255,255,0.02)', flexShrink: 0
                }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 800 }}>{drift.drift_score.toFixed(3)}</span>
                  <span style={{ fontSize: '.55rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Drift</span>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.4rem', marginBottom: 6 }}>
                    <span style={{
                      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                      background: drift.status === 'stable' ? '#34d399' : (drift.status === 'warning' ? '#fbbf24' : '#ef4444')
                    }} />
                    <span style={{ fontSize: '.8rem', fontWeight: 700, textTransform: 'uppercase' }}>
                      Status: {drift.status.replace('_', ' ')}
                    </span>
                  </div>
                  <p style={{ fontSize: '.72rem', color: 'var(--text-muted)', margin: 0 }}>
                    {drift.status === 'stable' && 'The embedding space is highly stable. Vector distances match current models.'}
                    {drift.status === 'warning' && 'Mild drift detected. Monitor accuracy or check for model/content updates.'}
                    {drift.status === 'drift_detected' && 'Significant embedding drift! Retrieval precision may be degraded.'}
                    {drift.status === 'insufficient_data' && 'Insufficient document chunks to calculate vector stability index.'}
                  </p>
                </div>
              </div>

              {drift.history && (
                <div>
                  <h3 style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '.5rem' }}>Vector Drift Index Trend</h3>
                  <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: 60, paddingBottom: 4 }}>
                    {drift.history.map((h, idx) => {
                      const pct = Math.min((h.drift / 0.15) * 100, 100)
                      const isLast = idx === drift.history.length - 1
                      return (
                        <div key={idx} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}>
                          <div style={{
                            width: '100%',
                            height: `${pct}%`,
                            background: isLast ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                            borderRadius: '2px 2px 0 0',
                            transition: 'height 0.3s ease'
                          }} title={`${h.month}: ${h.drift.toFixed(3)}`} />
                          <span style={{ fontSize: '.6rem', color: 'var(--text-muted)', marginTop: 4 }}>{h.month}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </GlassCard>
          )}
        </div>

        {/* Right Column: Search Quality Analytics */}
        {metrics && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <GlassCard style={{ padding: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginBottom: '1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', paddingBottom: '.75rem' }}>
                <TrendingUp size={18} style={{ color: '#34d399' }} />
                <h2 style={{ fontSize: '.95rem', fontWeight: 700, margin: 0 }}>Search Quality Metrics</h2>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#60a5fa' }}>{metrics.total_queries}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Total Queries Logged</div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#34d399' }}>{metrics.click_through_rate}%</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Click-Through Rate (CTR)</div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#fbbf24' }}>{metrics.reformulation_rate}%</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Reformulation Rate</div>
                </div>

                <div style={{ background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#a78bfa' }}>{metrics.average_click_rank || 'N/A'}</div>
                  <div style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>Avg Click Rank (Top-K)</div>
                </div>
              </div>

              {metrics.daily_trends && metrics.daily_trends.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: '1rem' }}>Search Volume & CTR Trend</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.85rem' }}>
                    {metrics.daily_trends.map((day, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
                        <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', width: 75, flexShrink: 0 }}>{day.date}</span>
                        <div style={{ flex: 1, background: 'rgba(255,255,255,0.04)', height: 16, borderRadius: 8, overflow: 'hidden', position: 'relative' }}>
                          <div style={{
                            width: `${Math.min((day.queries / Math.max(...metrics.daily_trends.map(t => t.queries), 1)) * 100, 100)}%`,
                            background: 'linear-gradient(90deg, rgba(59,130,246,0.3) 0%, rgba(59,130,246,0.7) 100%)',
                            height: '100%', borderRadius: 8
                          }} />
                          <span style={{ position: 'absolute', left: 8, top: '50%', transform: 'translateY(-50%)', fontSize: '.65rem', fontWeight: 700 }}>
                            {day.queries} searches
                          </span>
                        </div>
                        <span style={{
                          fontSize: '.72rem', fontWeight: 700, color: '#34d399', width: 60, textAlign: 'right',
                          background: 'rgba(52,211,243,0.08)', padding: '2px 6px', borderRadius: 4
                        }}>
                          CTR: {day.ctr}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </GlassCard>

            {/* Explanation card */}
            <GlassCard style={{ padding: '1.25rem', background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.1)' }}>
              <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start' }}>
                <BookOpen size={16} style={{ color: '#60a5fa', marginTop: 2, flexShrink: 0 }} />
                <div>
                  <h4 style={{ fontSize: '.8rem', fontWeight: 700, margin: '0 0 4px 0', color: '#60a5fa' }}>Retrieval Engineering Guide</h4>
                  <ul style={{ margin: 0, paddingLeft: '1.1rem', fontSize: '.72rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <li><strong>Blend (Alpha)</strong>: High alpha favors dense embeddings (best for conceptual matching); lower alpha favors lexical BM25 keyword matching.</li>
                    <li><strong>Reformulation</strong> detects if users immediately tweak their keyword query, suggesting a poor initial retrieval response.</li>
                    <li><strong>Embedding space drift</strong> measures semantic shift between oldest and newest data, warning you when models need fine-tuning.</li>
                  </ul>
                </div>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    </div>
  )
}


// ══════════════════════════════════════════════════════════
// COMPLIANCE SECTION
// ══════════════════════════════════════════════════════════
function ComplianceSection() {
  const { addToast } = useToast()
  const [activeTab, setActiveTab] = useState('audit_export')
  
  // Audit Export State
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [actionFilter, setActionFilter] = useState('')

  // Residency State
  const [residencyConfigs, setResidencyConfigs] = useState([])
  const [allowedRegions, setAllowedRegions] = useState([])
  const [enforceStrict, setEnforceStrict] = useState(true)
  const [residencyScope, setResidencyScope] = useState('system')
  const [residencyOrgId, setResidencyOrgId] = useState('')
  const [orgs, setOrgs] = useState([])

  // Key Rotation State
  const [keys, setKeys] = useState([])
  const [rotatingKey, setRotatingKey] = useState(false)

  // Fetch initial data
  useEffect(() => {
    fetchResidencyConfigs()
    fetchKeys()
    fetchOrgs()
  }, [])

  const fetchResidencyConfigs = async () => {
    try {
      const { data } = await api.get('/admin/compliance/residency')
      setResidencyConfigs(data)
      // Populate defaults from system config
      const systemConfig = data.find(c => c.scope === 'system')
      if (systemConfig) {
        setAllowedRegions(systemConfig.allowed_regions || [])
        setEnforceStrict(systemConfig.enforce_strict)
      }
    } catch {
      addToast('Failed to fetch data residency configs', 'error')
    }
  }

  const fetchKeys = async () => {
    try {
      const { data } = await api.get('/admin/compliance/keys')
      setKeys(data)
    } catch {
      addToast('Failed to fetch encryption keys', 'error')
    }
  }

  const fetchOrgs = async () => {
    try {
      const { data } = await api.get('/admin/organizations')
      setOrgs(data.organizations || data || [])
    } catch {
      // ignore
    }
  }

  const handleSaveResidency = async () => {
    try {
      await api.post('/admin/compliance/residency', allowedRegions, {
        params: {
          enforce_strict: enforceStrict,
          scope: residencyScope,
          scope_id: residencyScope === 'organization' ? residencyOrgId : null
        }
      })
      addToast('Data residency policy saved successfully', 'success')
      fetchResidencyConfigs()
    } catch (err) {
      addToast(err.response?.data?.detail || 'Failed to save residency config', 'error')
    }
  }

  const handleRotateKey = async () => {
    if (!window.confirm('Are you sure you want to rotate the master encryption key? This will retire the active version and begin background re-encryption.')) return
    setRotatingKey(true)
    try {
      await api.post('/admin/compliance/keys/rotate')
      addToast('Master encryption key rotated successfully', 'success')
      fetchKeys()
    } catch (err) {
      addToast('Failed to rotate encryption key', 'error')
    } finally {
      setRotatingKey(false)
    }
  }

  const handleExport = async (format) => {
    try {
      let queryParams = `?format=${format}`
      if (startDate) queryParams += `&start_date=${startDate}`
      if (endDate) queryParams += `&end_date=${endDate}`
      if (actionFilter) queryParams += `&action=${actionFilter}`

      if (format === 'csv') {
        const response = await api.get(`/admin/compliance/audit/export${queryParams}`, { responseType: 'blob' })
        const url = window.URL.createObjectURL(new Blob([response.data]))
        const link = document.createElement('a')
        link.href = url
        link.setAttribute('download', `soc2_audit_export_${new Date().toISOString().split('T')[0]}.csv`)
        document.body.appendChild(link)
        link.click()
        link.remove()
      } else {
        const response = await api.get(`/admin/compliance/audit/export${queryParams}`)
        const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(response.data, null, 2))
        const link = document.createElement('a')
        link.href = dataStr
        link.setAttribute('download', `soc2_audit_export_${new Date().toISOString().split('T')[0]}.json`)
        document.body.appendChild(link)
        link.click()
        link.remove()
      }
      addToast('SOC2 audit export generated successfully', 'success')
    } catch {
      addToast('Failed to export audit logs', 'error')
    }
  }

  const toggleRegion = (region) => {
    if (allowedRegions.includes(region)) {
      setAllowedRegions(allowedRegions.filter(r => r !== region))
    } else {
      setAllowedRegions([...allowedRegions, region])
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.25rem', margin: 0 }}>Compliance & Governance</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '.75rem', margin: '4px 0 0 0' }}>Manage SOC2 audit exports, data residency constraints, and document encryption keys.</p>
        </div>
        <span style={{
          background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.2)',
          color: '#34d399', fontSize: '.7rem', fontWeight: 700, padding: '.3rem .6rem', borderRadius: 99,
          display: 'flex', alignItems: 'center', gap: '.25rem'
        }}>
          <CheckCircle size={12} /> SOC2-READY
        </span>
      </div>

      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.06)', gap: '1.5rem', marginBottom: '.5rem' }}>
        <button onClick={() => setActiveTab('audit_export')} style={{
          background: 'none', border: 'none', color: activeTab === 'audit_export' ? '#fff' : 'var(--text-muted)',
          borderBottom: activeTab === 'audit_export' ? '2px solid #3b82f6' : '2px solid transparent',
          paddingBottom: '.75rem', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600, transition: 'all .15s'
        }}>SOC2 Audit Exports</button>
        <button onClick={() => setActiveTab('residency')} style={{
          background: 'none', border: 'none', color: activeTab === 'residency' ? '#fff' : 'var(--text-muted)',
          borderBottom: activeTab === 'residency' ? '2px solid #3b82f6' : '2px solid transparent',
          paddingBottom: '.75rem', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600, transition: 'all .15s'
        }}>Data Residency Controls</button>
        <button onClick={() => setActiveTab('key_rotation')} style={{
          background: 'none', border: 'none', color: activeTab === 'key_rotation' ? '#fff' : 'var(--text-muted)',
          borderBottom: activeTab === 'key_rotation' ? '2px solid #3b82f6' : '2px solid transparent',
          paddingBottom: '.75rem', cursor: 'pointer', fontSize: '.8rem', fontWeight: 600, transition: 'all .15s'
        }}>Encryption Key Rotation</button>
      </div>

      {activeTab === 'audit_export' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <GlassCard style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '.9rem', fontWeight: 700, margin: '0 0 .5rem 0' }}>Generate SOC2-Ready System Export</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '.75rem', margin: '0 0 1.25rem 0', lineHeight: 1.5 }}>
              Create signed audit trail reports containing system configurations, access logs, and core actions.
              Each log entry is cryptographically proofed using HMAC-SHA256 to ensure authenticity and non-repudiation.
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Start Date</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius)', padding: '.45rem .6rem', color: '#fff', fontSize: '.75rem'
                }} />
              </div>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>End Date</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius)', padding: '.45rem .6rem', color: '#fff', fontSize: '.75rem'
                }} />
              </div>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Action Filter</label>
                <input type="text" placeholder="e.g. auth:login" value={actionFilter} onChange={e => setActionFilter(e.target.value)} style={{
                  width: '100%', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                  borderRadius: 'var(--radius)', padding: '.45rem .6rem', color: '#fff', fontSize: '.75rem'
                }} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: '1rem', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1.25rem' }}>
              <button onClick={() => handleExport('csv')} className="btn" style={{
                background: '#3b82f6', color: '#fff', padding: '.45rem 1.25rem', fontSize: '.75rem',
                display: 'flex', alignItems: 'center', gap: '.4rem'
              }}>
                <Download size={14} /> Export CSV Format
              </button>
              <button onClick={() => handleExport('json')} className="btn btn-ghost" style={{
                padding: '.45rem 1.25rem', fontSize: '.75rem', border: '1px solid rgba(255,255,255,0.1)',
                display: 'flex', alignItems: 'center', gap: '.4rem'
              }}>
                <Download size={14} /> Export JSON Format
              </button>
            </div>
          </GlassCard>

          <GlassCard style={{ padding: '1.25rem', borderLeft: '3px solid #10b981', background: 'rgba(16,185,129,0.03)' }}>
            <div style={{ display: 'flex', gap: '.75rem', alignItems: 'flex-start' }}>
              <ShieldCheck size={16} style={{ color: '#10b981', marginTop: 2, flexShrink: 0 }} />
              <div>
                <h4 style={{ fontSize: '.8rem', fontWeight: 700, margin: '0 0 4px 0', color: '#10b981' }}>SOC2 Audit Checklist & Authenticity</h4>
                <p style={{ margin: 0, fontSize: '.72rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  To verify file integrity outside the RAG platform, execute <code>openssl dgst -sha256 -hmac [your-secret-key]</code> against the output entries.
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      )}

      {activeTab === 'residency' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <GlassCard style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '.9rem', fontWeight: 700, margin: '0 0 .5rem 0' }}>Configure Data Residency Controls</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '.75rem', margin: '0 0 1.25rem 0', lineHeight: 1.5 }}>
              Restrict document uploads, vector storage, and model execution to specific geographical zones to adhere to GDPR, CCPA, or regional data laws.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Scope level</label>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <select value={residencyScope} onChange={e => setResidencyScope(e.target.value)} style={{
                    background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 'var(--radius)', padding: '.45rem .6rem', color: '#fff', fontSize: '.75rem', width: 180
                  }}>
                    <option value="system">Global System-wide</option>
                    <option value="organization">Organization-level</option>
                  </select>

                  {residencyScope === 'organization' && (
                    <select value={residencyOrgId} onChange={e => setResidencyOrgId(e.target.value)} style={{
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: 'var(--radius)', padding: '.45rem .6rem', color: '#fff', fontSize: '.75rem', width: 220
                    }}>
                      <option value="">Select Organization...</option>
                      {orgs.map(o => (
                        <option key={o.id} value={o.id}>{o.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>Allowed Regions</label>
                <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
                  {['US', 'EU', 'APAC', 'GLOBAL'].map(region => {
                    const isAllowed = allowedRegions.includes(region)
                    return (
                      <button key={region} onClick={() => toggleRegion(region)} style={{
                        background: isAllowed ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.02)',
                        border: isAllowed ? '1px solid rgba(59,130,246,0.3)' : '1px solid rgba(255,255,255,0.06)',
                        color: isAllowed ? '#60a5fa' : 'var(--text-muted)',
                        padding: '.35rem .85rem', borderRadius: 99, fontSize: '.72rem', fontWeight: 600,
                        cursor: 'pointer', transition: 'all .15s'
                      }}>
                        {region}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', marginTop: '.25rem' }}>
                <input type="checkbox" id="enforceStrict" checked={enforceStrict} onChange={e => setEnforceStrict(e.target.checked)} style={{ cursor: 'pointer' }} />
                <label htmlFor="enforceStrict" style={{ fontSize: '.75rem', cursor: 'pointer', color: 'var(--text-muted)' }}>
                  Enforce strict residency verification (Block requests failing geographic IP checks)
                </label>
              </div>
            </div>

            <button onClick={handleSaveResidency} className="btn" style={{ background: '#3b82f6', color: '#fff', padding: '.45rem 1.25rem', fontSize: '.75rem' }}>
              Save Residency Policy
            </button>
          </GlassCard>

          <GlassCard style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
              <h4 style={{ fontSize: '.8rem', fontWeight: 700, margin: 0 }}>Active Residency Policies</h4>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.75rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.01)' }}>
                  <th style={{ padding: '.75rem 1rem' }}>Scope</th>
                  <th style={{ padding: '.75rem 1rem' }}>Scope ID / Detail</th>
                  <th style={{ padding: '.75rem 1rem' }}>Regions</th>
                  <th style={{ padding: '.75rem 1rem' }}>Strict Enforcement</th>
                  <th style={{ padding: '.75rem 1rem', textAlign: 'right' }}>Last Updated</th>
                </tr>
              </thead>
              <tbody>
                {residencyConfigs.map(c => (
                  <tr key={c.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>{c.scope}</td>
                    <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{c.scope_id || 'System Default'}</td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {c.allowed_regions?.map(r => (
                          <span key={r} style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4, fontSize: '.65rem' }}>{r}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: '.75rem 1rem' }}>{c.enforce_strict ? 'Yes' : 'No'}</td>
                    <td style={{ padding: '.75rem 1rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {new Date(c.updated_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </div>
      )}

      {activeTab === 'key_rotation' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <GlassCard style={{ padding: '1.5rem' }}>
            <h3 style={{ fontSize: '.9rem', fontWeight: 700, margin: '0 0 .5rem 0' }}>Document Encryption Key Rotation</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '.75rem', margin: '0 0 1.25rem 0', lineHeight: 1.5 }}>
              Rotate the master document encryption keys. Rotating the active key will automatically retire the active version,
              create a new active key, and trigger background re-encryption of all database indexes and documents.
            </p>

            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '.75rem 1.25rem', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.05)', flex: 1 }}>
                <div style={{ fontSize: '.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Current Active Key Alias</div>
                <div style={{ fontSize: '.8rem', fontWeight: 700 }}>{keys.find(k => k.status === 'active')?.key_alias || 'master-doc-key'}</div>
              </div>
              <div style={{ background: 'rgba(255,255,255,0.03)', padding: '.75rem 1.25rem', borderRadius: 'var(--radius)', border: '1px solid rgba(255,255,255,0.05)', flex: 1 }}>
                <div style={{ fontSize: '.625rem', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 2 }}>Current Key Version</div>
                <div style={{ fontSize: '.8rem', fontWeight: 700 }}>v{keys.find(k => k.status === 'active')?.version || 1}</div>
              </div>
            </div>

            <button onClick={handleRotateKey} disabled={rotatingKey} className="btn" style={{
              background: '#ef4444', color: '#fff', padding: '.45rem 1.25rem', fontSize: '.75rem',
              display: 'flex', alignItems: 'center', gap: '.4rem'
            }}>
              {rotatingKey ? 'Rotating Master Key...' : 'Rotate Encryption Key'}
            </button>
          </GlassCard>

          <GlassCard style={{ padding: '0', overflow: 'hidden' }}>
            <div style={{ padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)' }}>
              <h4 style={{ fontSize: '.8rem', fontWeight: 700, margin: 0 }}>Key Rotation History</h4>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.75rem', textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.01)' }}>
                  <th style={{ padding: '.75rem 1rem' }}>Version</th>
                  <th style={{ padding: '.75rem 1rem' }}>Alias</th>
                  <th style={{ padding: '.75rem 1rem' }}>Algorithm</th>
                  <th style={{ padding: '.75rem 1rem' }}>Status</th>
                  <th style={{ padding: '.75rem 1rem' }}>Created At</th>
                  <th style={{ padding: '.75rem 1rem', textAlign: 'right' }}>Rotated At</th>
                </tr>
              </thead>
              <tbody>
                {keys.map(k => (
                  <tr key={k.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '.75rem 1rem', fontWeight: 600 }}>v{k.version}</td>
                    <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>{k.key_alias}</td>
                    <td style={{ padding: '.75rem 1rem' }}>{k.algorithm}</td>
                    <td style={{ padding: '.75rem 1rem' }}>
                      <span style={{
                        background: k.status === 'active' ? 'rgba(52,211,153,0.15)' : 'rgba(156,163,175,0.15)',
                        color: k.status === 'active' ? '#34d399' : '#9ca3af',
                        padding: '2px 8px', borderRadius: 4, fontSize: '.65rem', fontWeight: 700
                      }}>
                        {k.status.toUpperCase()}
                      </span>
                    </td>
                    <td style={{ padding: '.75rem 1rem', color: 'var(--text-muted)' }}>
                      {new Date(k.created_at).toLocaleString()}
                    </td>
                    <td style={{ padding: '.75rem 1rem', textAlign: 'right', color: 'var(--text-muted)' }}>
                      {k.rotated_at ? new Date(k.rotated_at).toLocaleString() : 'N/A'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </GlassCard>
        </div>
      )}
    </div>
  )
}


// Placeholder components if needed (so we keep exact exports clean)
const ShieldCheck = ({ size, style }) => (
  <svg style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="m9 12 2 2 4-4" />
  </svg>
)




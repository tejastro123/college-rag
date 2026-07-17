import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'
import api from '../api'
import GlassCard from '../components/shared/GlassCard'
import AnimatedPage from '../components/shared/AnimatedPage'
import Modal from '../components/shared/Modal'
import { Skeleton } from '../components/shared/Skeleton'
import { useToast } from '../components/shared/Toast'
import {
  LayoutDashboard, Users, FileText, Building2, Shield, Activity,
  ChevronRight, Search, Download, Trash2, RefreshCw, Eye,
  MoreHorizontal, CheckCircle, XCircle, AlertTriangle, Clock,
  BookOpen, MessageSquare, Database, HardDrive, Hash, TrendingUp,
  ArrowUpRight, ArrowDownRight, ChevronDown, X, Filter,
  GraduationCap, MessageCircle, Bookmark, BarChart3,
} from 'lucide-react'

// ── Sidebar config ──────────────────────────────────────
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'courses', label: 'Courses', icon: GraduationCap },
  { id: 'conversations', label: 'Conversations', icon: MessageCircle },
  { id: 'bookmarks', label: 'Bookmarks', icon: Bookmark },
  { id: 'organizations', label: 'Organizations', icon: Building2 },
  { id: 'audit', label: 'Audit Log', icon: Shield },
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
}

function statusStyle(status) {
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

  // Auth guard
  useEffect(() => {
    if (!user || user.role !== 'admin') navigate('/login', { replace: true })
  }, [user, navigate])

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
          <div style={{ fontSize: '1rem', fontWeight: 700, fontFamily: 'var(--font-display)', padding: '0 .75rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '.75rem' }}>
            &#9733; Admin
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
                </button>
              )
            })}
          </nav>
        </aside>

        {/* Main */}
        <main style={{ flex: 1, padding: '1.5rem 2rem', minWidth: 0 }}>
          <div className="tab-bar" style={{ display: 'none' }} />
          {section === 'overview' && <OverviewSection />}
          {section === 'users' && <UsersSection />}
          {section === 'documents' && <DocumentsSection />}
          {section === 'organizations' && <OrganizationsSection />}
          {section === 'courses' && <CoursesSection />}
          {section === 'conversations' && <ConversationsSection />}
          {section === 'bookmarks' && <BookmarksSection />}
          {section === 'audit' && <AuditSection />}
          {section === 'analytics' && <AnalyticsSection />}
          {section === 'system' && <SystemSection />}
        </main>
      </div>
    </AnimatedPage>
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
      await api.post(`/documents/${docId}/reprocess`)
      addToast('Reprocessing started', 'success')
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Failed', 'error') }
  }

  const handleDelete = async (docId) => {
    if (!window.confirm('Delete this document?')) return
    try {
      await api.delete(`/documents/${docId}`)
      addToast('Document deleted', 'success')
      fetchData()
    } catch (e) { addToast(e.response?.data?.detail || 'Delete failed', 'error') }
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
          <SearchInput value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} placeholder="Search filename..." />
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }} style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 'var(--radius)', padding: '.4rem .6rem', fontSize: '.75rem', color: 'var(--text-primary)',
          }}>
            <option value="">All Status</option>
            <option value="ready">Ready</option>
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
                <tr><td colSpan={8} style={{ padding: '2rem' }}><div className="spinner" style={{ margin: '0 auto' }} /></td></tr>
              ) : docs.length === 0 ? (
                <tr><td colSpan={8} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '.875rem' }}>No documents found</td></tr>
              ) : docs.map(d => (
                <tr key={d.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)', fontSize: '.8125rem' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
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
                      {d.status === 'failed' && (
                        <button onClick={() => handleReprocess(d.id)} className="btn btn-ghost btn-icon" style={{ padding: '.3rem' }} title="Reprocess"><RefreshCw size={14} /></button>
                      )}
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
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!docId) return
    setLoading(true)
    api.get(`/admin/documents/${docId}`).then(({ data }) => setDoc(data)).catch(() => {}).finally(() => setLoading(false))
  }, [docId])

  return (
    <Modal open={!!docId} onClose={onClose} title="Document Details" maxWidth={700}>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={16} />)}
        </div>
      ) : doc ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '.8125rem' }}>
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
                <div style={{ marginTop: 2 }}>{value}</div>
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
          {doc.chunks?.length > 0 && (
            <div>
              <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Chunks ({doc.chunks.length})</span>
              <div style={{ maxHeight: 200, overflowY: 'auto', marginTop: '.35rem', display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
                {doc.chunks.map(c => (
                  <div key={c.id} style={{ padding: '.4rem .6rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)', fontSize: '.75rem' }}>
                    <span className="badge" style={statusStyle('processing')}>#{c.chunk_index}</span>
                    {c.page_number && <span style={{ color: 'var(--text-muted)', marginLeft: '.5rem' }}>p.{c.page_number}</span>}
                    <span style={{ color: 'var(--text-muted)', marginLeft: '.5rem' }}>{c.chunk_type} · {c.token_count}t</span>
                    <div style={{ color: 'var(--text-muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.content_preview}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <p style={{ color: 'var(--text-muted)' }}>Document not found</p>
      )}
    </Modal>
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

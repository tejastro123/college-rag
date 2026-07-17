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
} from 'lucide-react'

// ── Sidebar config ──────────────────────────────────────
const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'documents', label: 'Documents', icon: FileText },
  { id: 'organizations', label: 'Organizations', icon: Building2 },
  { id: 'audit', label: 'Audit Log', icon: Shield },
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
    <Modal open={!!userId} onClose={onClose} title="User Details" maxWidth={600}>
      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={16} />)}
        </div>
      ) : user ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
            {[
              ['Email', user.email],
              ['Full Name', user.full_name],
              ['Username', user.username],
              ['Role', <span key="role" className="badge" style={statusStyle(user.role)}>{user.role}</span>],
              ['Department', user.department || '-'],
              ['Semester', user.semester || '-'],
              ['Status', <span key="status" className="badge" style={statusStyle(user.is_active ? 'active' : 'inactive')}>{user.is_active ? 'Active' : 'Inactive'}</span>],
              ['Verified', user.is_verified ? 'Yes' : 'No'],
              ['Documents', user.doc_count],
              ['Conversations', user.conv_count],
              ['Joined', formatDate(user.created_at)],
              ['Last Updated', formatDate(user.updated_at)],
            ].map(([label, value]) => (
              <div key={label}>
                <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>{label}</span>
                <div style={{ fontSize: '.875rem', marginTop: 2 }}>{value}</div>
              </div>
            ))}
          </div>
          {user.courses?.length > 0 && (
            <div>
              <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Enrolled Courses</span>
              <div style={{ display: 'flex', gap: '.5rem', marginTop: '.35rem', flexWrap: 'wrap' }}>
                {user.courses.map(c => (
                  <span key={c.course_id} style={{ fontSize: '.75rem', background: 'rgba(255,255,255,0.06)', padding: '.2rem .5rem', borderRadius: 'var(--radius-sm)' }}>
                    {c.course_id.slice(0, 8)}... <span className="badge" style={statusStyle(c.role)}>{c.role}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
          {user.recent_messages?.length > 0 && (
            <div>
              <span style={{ fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Recent Activity</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', marginTop: '.35rem', maxHeight: 200, overflowY: 'auto' }}>
                {user.recent_messages.map(m => (
                  <div key={m.id} style={{ fontSize: '.75rem', padding: '.4rem .6rem', background: 'rgba(255,255,255,0.04)', borderRadius: 'var(--radius-sm)' }}>
                    <span className="badge" style={statusStyle(m.role === 'user' ? 'active' : 'ready')}>{m.role}</span>
                    {' '}{m.content_preview}
                    <span style={{ color: 'var(--text-muted)', marginLeft: '.5rem', fontSize: '.65rem' }}>{formatDate(m.created_at)}</span>
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
          {section === 'audit' && <AuditSection />}
          {section === 'system' && <SystemSection />}
        </main>
      </div>
    </AnimatedPage>
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
    { label: 'Documents', value: stats?.documents?.toLocaleString(), icon: <FileText size={16} />, color: '#a78bfa' },
    { label: 'Organizations', value: stats?.organizations?.toLocaleString(), icon: <Building2 size={16} />, color: '#34d399' },
    { label: 'Messages', value: stats?.messages?.toLocaleString(), delta: stats?.message_growth, trend: trends?.series?.map(s => s.messages), icon: <MessageSquare size={16} />, color: '#fbbf24' },
    { label: 'Active Users (7d)', value: stats?.active_users_7d?.toLocaleString(), icon: <Activity size={16} />, color: '#f472b6' },
    { label: 'API Calls (7d)', value: stats?.api_calls_7d?.toLocaleString(), delta: stats?.api_calls_growth, icon: <Hash size={16} />, color: '#fb923c' },
    { label: 'Tokens Used (7d)', value: stats?.tokens_used_7d?.toLocaleString(), delta: stats?.tokens_growth, icon: <Database size={16} />, color: '#818cf8' },
    { label: 'Storage', value: stats?.storage_gb ? `${stats.storage_gb} GB` : formatBytes(stats?.storage_bytes), icon: <HardDrive size={16} />, color: '#94a3b8' },
  ]

  const usageSeries = trends?.series?.map(s => s.api_calls) || []
  const msgSeries = trends?.series?.map(s => s.messages) || []
  const docSeries = trends?.series?.map(s => s.documents) || []

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '.5rem' }}>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700 }}>Overview</h1>
        <div style={{ display: 'flex', gap: '.5rem' }}>
          <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', padding: '.35rem .75rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>Avg Confidence: {stats?.avg_confidence}</span>
          <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', padding: '.35rem .75rem', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>Feedback Ratio: {((stats?.feedback_ratio || 0) * 100).toFixed(0)}%</span>
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

  if (loading) {
    return (
      <div>
        <h1 style={{ fontSize: '1.35rem', fontWeight: 700, marginBottom: '1.25rem' }}>System Health</h1>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {Array.from({ length: 4 }).map((_, i) => <GlassCard key={i} style={{ padding: '1.125rem' }}><Skeleton height={80} /></GlassCard>)}
        </div>
      </div>
    )
  }

  const cards = [
    {
      title: 'Database', icon: <Database size={18} />,
      color: sys?.database?.status === 'connected' ? '#34d399' : '#ef4444',
      items: [
        ['Status', sys?.database?.status],
        ['Pool Size', sys?.database?.pool_size || 'N/A'],
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
      title: 'Documents', icon: <FileText size={18} />,
      color: '#a78bfa',
      items: sys?.documents ? Object.entries(sys.documents).map(([k, v]) => [k, v]) : [['Total', sys?.total_documents]],
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

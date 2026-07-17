import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store'
import api from '../api'
import GlassCard from '../components/shared/GlassCard'
import AnimatedPage from '../components/shared/AnimatedPage'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'users', label: 'Users' },
  { id: 'documents', label: 'Documents' },
  { id: 'organizations', label: 'Organizations' },
]

function UserRow({ user, onUpdate }) {
  return (
    <tr className="border-b border-white/5 text-sm">
      <td className="py-2 px-3">{user.email}</td>
      <td className="py-2 px-3">{user.username}</td>
      <td className="py-2 px-3">
        <select
          value={user.role}
          onChange={(e) => onUpdate(user.id, e.target.value)}
          className="bg-black/20 border border-white/10 rounded px-2 py-1 text-xs"
        >
          <option value="student">student</option>
          <option value="ta">ta</option>
          <option value="faculty">faculty</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="py-2 px-3">{user.department || '-'}</td>
      <td className="py-2 px-3">
        <span className={`text-xs px-2 py-0.5 rounded ${user.is_active ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>
          {user.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="py-2 px-3 text-xs text-white/50">{new Date(user.created_at).toLocaleDateString()}</td>
    </tr>
  )
}

export default function AdminDashboard() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('overview')
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [documents, setDocuments] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    if (!user || user.role !== 'admin') {
      navigate('/login', { replace: true })
    }
  }, [user, navigate])

  const fetchData = useCallback(async (tab) => {
    setLoading(true)
    setError(null)
    try {
      switch (tab) {
        case 'overview': {
          const { data } = await api.get('/admin/stats')
          setStats(data)
          break
        }
        case 'users': {
          const { data } = await api.get('/admin/users', { params: { page, per_page: 20, search } })
          setUsers(data.users)
          setTotal(data.total)
          break
        }
        case 'documents': {
          const { data } = await api.get('/admin/documents', { params: { page, per_page: 20 } })
          setDocuments(data.documents)
          setTotal(data.total)
          break
        }
        case 'organizations': {
          const { data } = await api.get('/admin/organizations')
          setOrganizations(data)
          break
        }
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [page, search])

  useEffect(() => { fetchData(activeTab) }, [activeTab, fetchData])

  const handleRoleUpdate = async (userId, role) => {
    await api.patch(`/admin/users/${userId}`, null, { params: { role } })
    fetchData('users')
  }

  const handleUserDelete = async (userId) => {
    if (!window.confirm('Delete this user? This cannot be undone.')) return
    await api.delete(`/admin/users/${userId}`)
    fetchData('users')
  }

  return (
    <AnimatedPage>
      <div className="max-w-6xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

        {error && <p className="text-red-400 mb-4">{error}</p>}

        <div className="flex gap-2 mb-6 border-b border-white/10 pb-2">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setPage(1) }}
              className={`px-4 py-2 rounded-t text-sm transition-colors ${
                activeTab === tab.id ? 'bg-white/10 text-white border-b-2 border-accent' : 'text-white/50 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {loading && <p className="text-white/50">Loading...</p>}

        {!loading && activeTab === 'overview' && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <GlassCard><p className="text-3xl font-bold">{stats.users}</p><p className="text-xs text-white/50">Users</p></GlassCard>
            <GlassCard><p className="text-3xl font-bold">{stats.organizations}</p><p className="text-xs text-white/50">Organizations</p></GlassCard>
            <GlassCard><p className="text-3xl font-bold">{stats.documents}</p><p className="text-xs text-white/50">Documents</p></GlassCard>
            <GlassCard><p className="text-3xl font-bold">{stats.messages}</p><p className="text-xs text-white/50">Messages</p></GlassCard>
            <GlassCard><p className="text-xl font-bold">{stats.api_calls_7d?.toLocaleString()}</p><p className="text-xs text-white/50">API calls (7d)</p></GlassCard>
            <GlassCard><p className="text-xl font-bold">{stats.tokens_used_7d?.toLocaleString()}</p><p className="text-xs text-white/50">Tokens used (7d)</p></GlassCard>
          </div>
        )}

        {!loading && activeTab === 'users' && (
          <div>
            <div className="flex gap-2 mb-4">
              <input
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                placeholder="Search users..."
                className="flex-1 bg-black/20 border border-white/10 rounded px-3 py-2 text-sm"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead><tr className="text-xs text-white/50 uppercase border-b border-white/10">
                  <th className="py-2 px-3">Email</th><th className="py-2 px-3">Username</th>
                  <th className="py-2 px-3">Role</th><th className="py-2 px-3">Dept</th>
                  <th className="py-2 px-3">Status</th><th className="py-2 px-3">Joined</th>
                </tr></thead>
                <tbody>
                  {users.map(u => <UserRow key={u.id} user={u} onUpdate={handleRoleUpdate} />)}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between items-center mt-4 text-sm">
              <span className="text-white/50">{total} total</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1 rounded bg-white/10 disabled:opacity-30">Prev</button>
                <button disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)} className="px-3 py-1 rounded bg-white/10 disabled:opacity-30">Next</button>
              </div>
            </div>
          </div>
        )}

        {!loading && activeTab === 'documents' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="text-xs text-white/50 uppercase border-b border-white/10">
                <th className="py-2 px-3">Filename</th><th className="py-2 px-3">Type</th>
                <th className="py-2 px-3">Size</th><th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Chunks</th><th className="py-2 px-3">Uploaded</th>
              </tr></thead>
              <tbody>
                {documents.map(d => (
                  <tr key={d.id} className="border-b border-white/5 text-sm">
                    <td className="py-2 px-3 truncate max-w-[200px]">{d.filename}</td>
                    <td className="py-2 px-3 text-xs">{d.file_type}</td>
                    <td className="py-2 px-3 text-xs">{(d.file_size / 1024).toFixed(1)} KB</td>
                    <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded ${
                      d.status === 'ready' ? 'bg-green-900/50 text-green-300' : d.status === 'failed' ? 'bg-red-900/50 text-red-300' : 'bg-yellow-900/50 text-yellow-300'
                    }`}>{d.status}</span></td>
                    <td className="py-2 px-3 text-xs">{d.total_chunks}</td>
                    <td className="py-2 px-3 text-xs text-white/50">{new Date(d.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && activeTab === 'organizations' && (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead><tr className="text-xs text-white/50 uppercase border-b border-white/10">
                <th className="py-2 px-3">Name</th><th className="py-2 px-3">Slug</th>
                <th className="py-2 px-3">Owner</th><th className="py-2 px-3">Members</th>
                <th className="py-2 px-3">Active</th><th className="py-2 px-3">Created</th>
              </tr></thead>
              <tbody>
                {organizations.map(o => (
                  <tr key={o.id} className="border-b border-white/5 text-sm">
                    <td className="py-2 px-3">{o.name}</td>
                    <td className="py-2 px-3 text-xs text-white/50">{o.slug}</td>
                    <td className="py-2 px-3 text-xs">{o.owner_id?.slice(0, 8)}...</td>
                    <td className="py-2 px-3 text-xs">{o.member_count}</td>
                    <td className="py-2 px-3"><span className={`text-xs px-2 py-0.5 rounded ${o.is_active ? 'bg-green-900/50 text-green-300' : 'bg-red-900/50 text-red-300'}`}>{o.is_active ? 'Yes' : 'No'}</span></td>
                    <td className="py-2 px-3 text-xs text-white/50">{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}

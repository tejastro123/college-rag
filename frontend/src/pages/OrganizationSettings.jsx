import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import api from '../api'
import GlassCard from '../components/shared/GlassCard'
import Modal from '../components/shared/Modal'
import AnimatedPage from '../components/shared/AnimatedPage'

const ROLES = ['member', 'admin']

export default function OrganizationSettings() {
  const { orgId } = useParams()
  const navigate = useNavigate()
  const [org, setOrg] = useState(null)
  const [workspaces, setWorkspaces] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activeSection, setActiveSection] = useState('general')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showCreateWsModal, setShowCreateWsModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [wsName, setWsName] = useState('')
  const [wsSlug, setWsSlug] = useState('')

  const fetchOrg = useCallback(async () => {
    try {
      const { data } = await api.get(`/orgs/${orgId}`)
      setOrg(data)
      setWorkspaces(data.workspaces || [])
      setMembers(data.members || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to load organization')
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => { fetchOrg() }, [fetchOrg])

  const handleInvite = async () => {
    try {
      await api.post(`/orgs/${orgId}/members`, { email: inviteEmail, role: inviteRole })
      setShowInviteModal(false)
      setInviteEmail('')
      fetchOrg()
    } catch (err) {
      alert(err.response?.data?.detail || 'Invite failed')
    }
  }

  const handleRemoveMember = async (memberId) => {
    if (!window.confirm('Remove this member?')) return
    await api.delete(`/orgs/${orgId}/members/${memberId}`)
    fetchOrg()
  }

  const handleCreateWorkspace = async () => {
    try {
      await api.post(`/orgs/${orgId}/workspaces`, { name: wsName, slug: wsSlug })
      setShowCreateWsModal(false)
      setWsName('')
      setWsSlug('')
      fetchOrg()
    } catch (err) {
      alert(err.response?.data?.detail || 'Failed to create workspace')
    }
  }

  const handleDeleteWorkspace = async (wsId) => {
    if (!window.confirm('Delete this workspace?')) return
    await api.delete(`/orgs/${orgId}/workspaces/${wsId}`)
    fetchOrg()
  }

  const handleUpdateRole = async (memberId, role) => {
    await api.patch(`/orgs/${orgId}/members/${memberId}`, null, { params: { role } })
    fetchOrg()
  }

  if (loading) return <div className="p-8 text-white/50">Loading...</div>
  if (error) return <div className="p-8 text-red-400">{error}</div>

  return (
    <AnimatedPage>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold mb-2">{org?.name}</h1>
        <p className="text-sm text-white/50 mb-6">/{org?.slug} &middot; {org?.role} role</p>

        <div className="flex gap-2 mb-6 border-b border-white/10 pb-2">
          {[
            { id: 'general', label: 'General' },
            { id: 'workspaces', label: 'Workspaces' },
            { id: 'members', label: 'Members' },
          ].map(s => (
            <button
              key={s.id}
              onClick={() => setActiveSection(s.id)}
              className={`px-4 py-2 rounded-t text-sm transition-colors ${
                activeSection === s.id ? 'bg-white/10 text-white border-b-2 border-accent' : 'text-white/50 hover:text-white'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {activeSection === 'general' && (
          <GlassCard>
            <h3 className="font-semibold mb-4">Organization Settings</h3>
            <div className="space-y-3 text-sm">
              <div><span className="text-white/50">Name:</span> {org?.name}</div>
              <div><span className="text-white/50">Slug:</span> {org?.slug}</div>
              <div><span className="text-white/50">Description:</span> {org?.description || '-'}</div>
            </div>
          </GlassCard>
        )}

        {activeSection === 'workspaces' && (
          <div>
            <button onClick={() => setShowCreateWsModal(true)} className="mb-4 px-4 py-2 bg-white/10 rounded text-sm hover:bg-white/20 transition-colors">
              + New Workspace
            </button>
            <div className="space-y-3">
              {workspaces.map(ws => (
                <GlassCard key={ws.id} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{ws.name} <span className="text-xs text-white/50">/{ws.slug}</span></p>
                    {ws.is_default && <span className="text-xs text-accent">Default</span>}
                  </div>
                  {!ws.is_default && (
                    <button onClick={() => handleDeleteWorkspace(ws.id)} className="text-xs text-red-400 hover:text-red-300">
                      Delete
                    </button>
                  )}
                </GlassCard>
              ))}
            </div>

            <Modal open={showCreateWsModal} onClose={() => setShowCreateWsModal(false)} title="Create Workspace">
              <div className="space-y-3">
                <input value={wsName} onChange={e => setWsName(e.target.value)} placeholder="Workspace name" className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm" />
                <input value={wsSlug} onChange={e => setWsSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))} placeholder="workspace-slug" className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm" />
                <button onClick={handleCreateWorkspace} className="w-full py-2 bg-accent text-black rounded text-sm font-semibold">Create</button>
              </div>
            </Modal>
          </div>
        )}

        {activeSection === 'members' && (
          <div>
            <button onClick={() => setShowInviteModal(true)} className="mb-4 px-4 py-2 bg-white/10 rounded text-sm hover:bg-white/20 transition-colors">
              + Invite Member
            </button>
            <div className="space-y-2">
              {members.map(m => (
                <GlassCard key={m.id} className="flex justify-between items-center">
                  <div>
                    <p className="font-medium">{m.username || m.email || m.user_id?.slice(0, 8)}</p>
                    <p className="text-xs text-white/50">{m.email || ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {m.role !== 'owner' && (
                      <>
                        <select
                          value={m.role}
                          onChange={e => handleUpdateRole(m.id, e.target.value)}
                          className="bg-black/20 border border-white/10 rounded px-2 py-1 text-xs"
                        >
                          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                        </select>
                        <button onClick={() => handleRemoveMember(m.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                      </>
                    )}
                    {m.role === 'owner' && <span className="text-xs text-accent">Owner</span>}
                  </div>
                </GlassCard>
              ))}
            </div>

            <Modal open={showInviteModal} onClose={() => setShowInviteModal(false)} title="Invite Member">
              <div className="space-y-3">
                <input value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} placeholder="Email address" type="email" className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm" />
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded px-3 py-2 text-sm">
                  {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                <button onClick={handleInvite} className="w-full py-2 bg-accent text-black rounded text-sm font-semibold">Invite</button>
              </div>
            </Modal>
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}

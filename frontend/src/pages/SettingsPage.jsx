import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { User, Palette, Settings, HelpCircle, Save, Key, Shield, Info, Check } from 'lucide-react'
import { useAuthStore } from '../store'
import { authApi } from '../api'

const accentPresets = {
  stone: { name: 'Neutral Stone', color: '#a3a3a3', accent: '#a3a3a3', light: '#d4d4d4', dark: '#737373' },
  violet: { name: 'Royal Violet', color: '#8b5cf6', accent: '#8b5cf6', light: '#a78bfa', dark: '#6d28d9' },
  cyan: { name: 'Deep Cyan', color: '#06b6d4', accent: '#06b6d4', light: '#22d3ee', dark: '#0e7490' },
  emerald: { name: 'Emerald Green', color: '#10b981', accent: '#10b981', light: '#34d399', dark: '#047857' },
  amber: { name: 'Warm Amber', color: '#f59e0b', accent: '#f59e0b', light: '#fbbf24', dark: '#b45309' },
  rose: { name: 'Rose Red', color: '#f43f5e', accent: '#f43f5e', light: '#fb7185', dark: '#be123c' }
}

const lightPresets = {
  stone: { accent: '#525252', light: '#262626', dark: '#a3a3a3' },
  violet: { accent: '#7c3aed', light: '#6d28d9', dark: '#ddd6fe' },
  cyan: { accent: '#0891b2', light: '#0e7490', dark: '#cffafe' },
  emerald: { accent: '#059669', light: '#047857', dark: '#d1fae5' },
  amber: { accent: '#d97706', light: '#b45309', dark: '#fef3c7' },
  rose: { accent: '#e11d48', light: '#be123c', dark: '#ffe4e6' }
}

export function applyAccentColor(colorName, themeMode) {
  const currentTheme = themeMode || document.documentElement.getAttribute('data-theme') || 'dark'
  const preset = currentTheme === 'light' ? lightPresets[colorName] : accentPresets[colorName]
  if (!preset) return

  document.documentElement.style.setProperty('--accent', preset.accent)
  document.documentElement.style.setProperty('--accent-light', preset.light)
  document.documentElement.style.setProperty('--accent-dark', preset.dark)

  if (currentTheme === 'light') {
    document.documentElement.style.setProperty('--grad-brand', `linear-gradient(135deg, ${preset.accent} 0%, ${preset.light} 50%, ${preset.dark} 100%)`)
  } else {
    document.documentElement.style.setProperty('--grad-brand', `linear-gradient(135deg, ${preset.dark} 0%, ${preset.accent} 50%, ${preset.light} 100%)`)
  }
}

export default function SettingsPage() {
  const { user, token, setAuth } = useAuthStore()
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'profile'

  // Profile Form States
  const [fullName, setFullName] = useState(user?.full_name || '')
  const [username, setUsername] = useState(user?.username || '')
  const [department, setDepartment] = useState(user?.department || '')
  const [semester, setSemester] = useState(user?.semester || '')
  const [profileMsg, setProfileMsg] = useState(null)
  const [profileError, setProfileError] = useState(null)
  const [profileLoading, setProfileLoading] = useState(false)

  // Password Form States
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwMsg, setPwMsg] = useState(null)
  const [pwError, setPwError] = useState(null)
  const [pwLoading, setPwLoading] = useState(false)

  // Personalization States
  const [theme, setTheme] = useState(() => document.documentElement.getAttribute('data-theme') || 'dark')
  const [accent, setAccent] = useState(() => localStorage.getItem('rag-accent-color') || 'stone')

  // RAG States
  const [ragMode, setRagMode] = useState(() => localStorage.getItem('rag-default-mode') || 'normal')
  const [topK, setTopK] = useState(() => Number(localStorage.getItem('rag-top-k') || '10'))
  const [rerankK, setRerankK] = useState(() => Number(localStorage.getItem('rag-rerank-k') || '5'))
  const [ragMsg, setRagMsg] = useState(null)

  // Sync state if user details change in store
  useEffect(() => {
    if (user) {
      setFullName(user.full_name || '')
      setUsername(user.username || '')
      setDepartment(user.department || '')
      setSemester(user.semester || '')
    }
  }, [user])

  const setTab = (tab) => {
    setSearchParams({ tab })
  }

  // Profile Form Save
  const handleSaveProfile = async (e) => {
    e.preventDefault()
    setProfileMsg(null)
    setProfileError(null)
    setProfileLoading(true)
    try {
      const res = await authApi.updateProfile({
        full_name: fullName,
        username,
        department: department || null,
        semester: semester || null
      })
      // Update local Zustand auth store
      setAuth(token, { ...user, ...res.data })
      setProfileMsg('Profile updated successfully!')
    } catch (err) {
      setProfileError(err.response?.data?.detail || 'Failed to update profile.')
    } finally {
      setProfileLoading(false)
    }
  }

  // Password Change
  const handleChangePassword = async (e) => {
    e.preventDefault()
    setPwMsg(null)
    setPwError(null)
    if (newPassword !== confirmPassword) {
      setPwError('New passwords do not match.')
      return
    }
    setPwLoading(true)
    try {
      await authApi.updatePassword({
        old_password: oldPassword,
        new_password: newPassword
      })
      setPwMsg('Password updated successfully!')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPwError(err.response?.data?.detail || 'Failed to change password. Make sure old password is correct.')
    } finally {
      setPwLoading(false)
    }
  }

  // Personalization Change
  const handleThemeChange = (newTheme) => {
    setTheme(newTheme)
    document.documentElement.setAttribute('data-theme', newTheme)
    localStorage.setItem('rag-theme', newTheme)
    applyAccentColor(accent, newTheme)
  }

  const handleAccentChange = (newAccent) => {
    setAccent(newAccent)
    localStorage.setItem('rag-accent-color', newAccent)
    applyAccentColor(newAccent, theme)
  }

  // RAG settings save
  const handleSaveRAG = (e) => {
    e.preventDefault()
    localStorage.setItem('rag-default-mode', ragMode)
    localStorage.setItem('rag-top-k', String(topK))
    localStorage.setItem('rag-rerank-k', String(rerankK))
    setRagMsg('RAG settings saved locally!')
    setTimeout(() => setRagMsg(null), 3000)
  }

  return (
    <div className="fade-in-scale" style={{ maxWidth: 1000, margin: '0 auto', padding: '1.5rem 2rem' }}>
      <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '2rem', marginBottom: '1.5rem' }}>
        Settings & Account
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: '2rem' }}>
        {/* Sidebar Nav */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
          <button
            onClick={() => setTab('profile')}
            className={`btn ${activeTab === 'profile' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
          >
            <User size={16} />
            <span>Profile Settings</span>
          </button>
          <button
            onClick={() => setTab('personalization')}
            className={`btn ${activeTab === 'personalization' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
          >
            <Palette size={16} />
            <span>Personalization</span>
          </button>
          <button
            onClick={() => setTab('general')}
            className={`btn ${activeTab === 'general' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
          >
            <Settings size={16} />
            <span>RAG settings</span>
          </button>
          <button
            onClick={() => setTab('help')}
            className={`btn ${activeTab === 'help' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ justifyContent: 'flex-start', width: '100%' }}
          >
            <HelpCircle size={16} />
            <span>Help & FAQ</span>
          </button>
        </div>

        {/* Content Box */}
        <div className="glass-card" style={{ padding: '2rem', borderRadius: 'var(--radius-lg)' }}>
          {/* TAB 1: Profile Settings */}
          {activeTab === 'profile' && (
            <div className="fade-in">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <User size={20} style={{ color: 'var(--accent)' }} /> Profile details
              </h2>

              {profileMsg && <div className="badge badge-emerald" style={{ padding: '.5rem 1rem', width: '100%', marginBottom: '1rem', display: 'block' }}>{profileMsg}</div>}
              {profileError && <div className="badge badge-rose" style={{ padding: '.5rem 1rem', width: '100%', marginBottom: '1rem', display: 'block' }}>{profileError}</div>}

              <form onSubmit={handleSaveProfile} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Full Name</label>
                    <input
                      type="text"
                      className="input"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Username</label>
                    <input
                      type="text"
                      className="input"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Department</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., Computer Science"
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Semester</label>
                    <input
                      type="text"
                      className="input"
                      placeholder="e.g., Fall 2026"
                      value={semester}
                      onChange={(e) => setSemester(e.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <button type="submit" disabled={profileLoading} className="btn btn-primary" style={{ marginTop: '.5rem' }}>
                    <Save size={16} />
                    <span>{profileLoading ? 'Saving...' : 'Save Profile'}</span>
                  </button>
                </div>
              </form>

              <div className="divider" style={{ margin: '2rem 0' }} />

              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <Key size={20} style={{ color: 'var(--accent)' }} /> Change password
              </h2>

              {pwMsg && <div className="badge badge-emerald" style={{ padding: '.5rem 1rem', width: '100%', marginBottom: '1rem', display: 'block' }}>{pwMsg}</div>}
              {pwError && <div className="badge badge-rose" style={{ padding: '.5rem 1rem', width: '100%', marginBottom: '1rem', display: 'block' }}>{pwError}</div>}

              <form onSubmit={handleChangePassword} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Old Password</label>
                  <input
                    type="password"
                    className="input"
                    value={oldPassword}
                    onChange={(e) => setOldPassword(e.target.value)}
                    required
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>New Password</label>
                    <input
                      type="password"
                      className="input"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Confirm New Password</label>
                    <input
                      type="password"
                      className="input"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div>
                  <button type="submit" disabled={pwLoading} className="btn btn-primary" style={{ marginTop: '.5rem' }}>
                    <Key size={16} />
                    <span>{pwLoading ? 'Updating...' : 'Update Password'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 2: Personalization */}
          {activeTab === 'personalization' && (
            <div className="fade-in">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <Palette size={20} style={{ color: 'var(--accent)' }} /> App theme & Accent color
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {/* Theme Mode */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                  <label style={{ fontSize: '.9rem', fontWeight: 600 }}>Color Theme</label>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <button
                      onClick={() => handleThemeChange('dark')}
                      className={`btn ${theme === 'dark' ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ flex: 1, padding: '1rem' }}
                    >
                      🌙 Dark Mode
                    </button>
                    <button
                      onClick={() => handleThemeChange('light')}
                      className={`btn ${theme === 'light' ? 'btn-primary' : 'btn-ghost'}`}
                      style={{ flex: 1, padding: '1rem' }}
                    >
                      ☀️ Light Mode
                    </button>
                  </div>
                </div>

                {/* Accent Colors */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                  <label style={{ fontSize: '.9rem', fontWeight: 600 }}>Accent Color Theme</label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    {Object.entries(accentPresets).map(([key, config]) => (
                      <button
                        key={key}
                        onClick={() => handleAccentChange(key)}
                        className="btn btn-ghost"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '.75rem',
                          justifyContent: 'flex-start',
                          padding: '.75rem 1rem',
                          borderColor: accent === key ? 'var(--accent-light)' : 'var(--border)',
                          background: accent === key ? 'rgba(255,255,255,0.05)' : 'transparent',
                        }}
                      >
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%',
                          background: config.color, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: '#0a0a0a', flexShrink: 0
                        }}>
                          {accent === key && <Check size={10} style={{ color: '#0a0a0a' }} />}
                        </div>
                        <span style={{ fontSize: '.85rem', fontWeight: accent === key ? 600 : 400 }}>{config.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: App / RAG Settings */}
          {activeTab === 'general' && (
            <div className="fade-in">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <Settings size={20} style={{ color: 'var(--accent)' }} /> Chat & Retrieval preferences
              </h2>

              {ragMsg && <div className="badge badge-emerald" style={{ padding: '.5rem 1rem', width: '100%', marginBottom: '1rem', display: 'block' }}>{ragMsg}</div>}

              <form onSubmit={handleSaveRAG} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                  <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Default Assistant Mode</label>
                  <select
                    className="input"
                    value={ragMode}
                    onChange={(e) => setRagMode(e.target.value)}
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                  >
                    <option value="normal">Normal (Standard Contextual QA)</option>
                    <option value="strict">Strict (Strict RAG without generalization)</option>
                    <option value="tutor">Socratic Tutor (Guides through queries)</option>
                    <option value="exam">Exam prep (Simulates test conditions)</option>
                    <option value="revision">Quick revision (High summary output)</option>
                  </select>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Document Retrieval Top-K</label>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={30}
                      value={topK}
                      onChange={(e) => setTopK(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>Number of semantic segments to retrieve.</span>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem' }}>
                    <label style={{ fontSize: '.875rem', fontWeight: 500 }}>Reranking Top-N</label>
                    <input
                      type="number"
                      className="input"
                      min={1}
                      max={15}
                      value={rerankK}
                      onChange={(e) => setRerankK(Number(e.target.value))}
                    />
                    <span style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>Number of top results to pass to the LLM.</span>
                  </div>
                </div>

                <div>
                  <button type="submit" className="btn btn-primary" style={{ marginTop: '.5rem' }}>
                    <Save size={16} />
                    <span>Save Settings</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 4: Help & FAQ */}
          {activeTab === 'help' && (
            <div className="fade-in">
              <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '.5rem' }}>
                <HelpCircle size={20} style={{ color: 'var(--accent)' }} /> Help & System FAQs
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                <div className="neo-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
                  <Shield size={22} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: '.2rem' }} />
                  <div>
                    <h3 style={{ fontSize: '.95rem', fontWeight: 600, marginBottom: '.25rem' }}>System Access Role</h3>
                    <p style={{ fontSize: '.8125rem', color: 'var(--text-secondary)' }}>
                      You are logged in as a <strong>{user?.role?.toUpperCase()}</strong>. Administrative options are restricted to verified accounts.
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 600 }}>Frequently Asked Questions</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
                    <details style={{ padding: '.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
                      <summary style={{ fontSize: '.875rem', fontWeight: 500, padding: '.25rem' }}>How does the strict mode work?</summary>
                      <p style={{ fontSize: '.8125rem', color: 'var(--text-secondary)', padding: '.5rem .25rem' }}>
                        Strict mode relies solely on verified context from uploaded textbooks. The model is penalized for bringing in outside training knowledge, ensuring factual accuracy for exam study.
                      </p>
                    </details>
                    <details style={{ padding: '.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
                      <summary style={{ fontSize: '.875rem', fontWeight: 500, padding: '.25rem' }}>Where are my documents stored?</summary>
                      <p style={{ fontSize: '.8125rem', color: 'var(--text-secondary)', padding: '.5rem .25rem' }}>
                        All indexed documents are stored securely in the local vector DB. Your uploads are segmented and parsed using OCR pipeline tools.
                      </p>
                    </details>
                    <details style={{ padding: '.5rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', cursor: 'pointer' }}>
                      <summary style={{ fontSize: '.875rem', fontWeight: 500, padding: '.25rem' }}>Can I customize the chat models?</summary>
                      <p style={{ fontSize: '.8125rem', color: 'var(--text-secondary)', padding: '.5rem .25rem' }}>
                        By default, the server links to local Ollama endpoints (Mistral/Llama3). Custom API setups are handled in the backend configuration file.
                      </p>
                    </details>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

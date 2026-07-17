import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../api'
import { useAuthStore } from '../store'
import { Mail, Lock, User, BookOpen } from 'lucide-react'

const ROLES = ['student', 'ta', 'faculty']

export default function RegisterPage() {
  const [form, setForm] = useState({ email: '', username: '', full_name: '', password: '', role: 'student', department: '', semester: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { token, user, setAuth } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (token) {
      navigate(user?.role === 'admin' ? '/admin' : '/chat', { replace: true })
    }
  }, [token, user, navigate])

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await authApi.register(form)
      setAuth(r.data.access_token, r.data.user)
      navigate(r.data.user?.role === 'admin' ? '/admin' : '/chat')
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(Array.isArray(detail) ? detail.map(e => e.msg).join(', ') : detail || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  const inputRow = (id, label, type, key, placeholder, Icon) => (
    <div className="floating-label-wrap">
      <input
        id={id}
        className="input"
        type={type}
        value={form[key]}
        onChange={set(key)}
        placeholder=" "
        required
        style={{ paddingLeft: '2.5rem' }}
      />
      <Icon size={15} style={{ position: 'absolute', left: '.75rem', top: '1.1rem', color: 'var(--text-muted)', pointerEvents: 'none' }} />
      <label>{label}</label>
    </div>
  )

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '1.5rem',
      position: 'relative',
      overflow: 'hidden',
      background:
        'radial-gradient(ellipse at 30% 20%, rgba(255,255,255,0.04) 0%, transparent 50%),' +
        'radial-gradient(ellipse at 70% 80%, rgba(255,255,255,0.03) 0%, transparent 50%),' +
        'radial-gradient(ellipse at 50% 50%, rgba(255,255,255,0.015) 0%, transparent 50%)',
    }}>
      {/* Morphing blobs */}
      <div style={{
        position: 'absolute', width: 500, height: 500,
        background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
        top: -100, right: -100,
        animation: 'morphBlob 15s ease-in-out infinite',
        filter: 'blur(60px)', pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', width: 400, height: 400,
        background: 'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(16,185,129,0.04))',
        bottom: -80, left: -80,
        animation: 'morphBlob 20s ease-in-out infinite reverse',
        filter: 'blur(60px)', pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 480, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '1.75rem' }}>
          <div className="float-anim" style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'var(--grad-brand)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.5rem', marginBottom: '.875rem',
            boxShadow: '0 0 40px rgba(255,255,255,0.06)',
          }}>🎓</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 800 }}>
            Create your <span className="gradient-text">CollegeRAG</span> account
          </h1>
        </div>

        <div className="glass-card" style={{ padding: '2rem', borderRadius: 'var(--radius-xl)' }}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            {inputRow('reg-fullname', 'Full Name', 'text', 'full_name', 'Your full name', User)}
            {inputRow('reg-email', 'Email', 'email', 'email', 'you@college.edu', Mail)}
            {inputRow('reg-username', 'Username', 'text', 'username', 'coolstudent123', User)}
            {inputRow('reg-password', 'Password', 'password', 'password', '••••••••', Lock)}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
              <div className="floating-label-wrap">
                <select
                  id="reg-role"
                  className="input"
                  value={form.role}
                  onChange={set('role')}
                  style={{ cursor: 'pointer', paddingTop: '1.25rem', paddingBottom: '.5rem' }}
                >
                  {ROLES.map(r => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
                <label style={{ fontSize: '.65rem', color: 'var(--accent-light)', top: '.35rem' }}>Role</label>
              </div>
              <div className="floating-label-wrap">
                <input
                  id="reg-semester"
                  className="input"
                  type="text"
                  value={form.semester}
                  onChange={set('semester')}
                  placeholder=" "
                  style={{ paddingTop: '1.25rem', paddingBottom: '.5rem' }}
                />
                <label>Semester</label>
              </div>
            </div>

            {error && (
              <div style={{
                background: 'rgba(244,63,94,.1)', border: '1px solid rgba(244,63,94,.3)',
                borderRadius: 'var(--radius-sm)', padding: '.65rem .875rem',
                color: 'var(--rose)', fontSize: '.875rem',
              }}>{error}</div>
            )}
            <button id="reg-submit" className="btn btn-primary w-full" type="submit" disabled={loading} style={{ justifyContent: 'center', marginTop: '.25rem' }}>
              {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Creating account...</> : 'Create Account'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', color: 'var(--text-secondary)', fontSize: '.875rem' }}>
          Already have an account?{' '}
          <Link to="/login" style={{ color: 'var(--accent-light)', textDecoration: 'none', fontWeight: 500 }}>Sign in</Link>
        </p>
      </div>
    </div>
  )
}

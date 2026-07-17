import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { authApi } from '../api'
import { useAuthStore } from '../store'
import { Mail, Lock, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setAuth } = useAuthStore()
  const navigate = useNavigate()

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const r = await authApi.login({ email, password })
      setAuth(r.data.access_token, r.data.user)
      navigate('/chat')
    } catch (err) {
      const detail = err.response?.data?.detail
      setError(Array.isArray(detail) ? detail.map(e => e.msg).join(', ') : detail || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

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
        filter: 'blur(60px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', width: 400, height: 400,
        background: 'linear-gradient(135deg, rgba(34,211,238,0.08), rgba(16,185,129,0.04))',
        bottom: -80, left: -80,
        animation: 'morphBlob 20s ease-in-out infinite reverse',
        filter: 'blur(60px)',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', width: 300, height: 300,
        background: 'rgba(255,255,255,0.02)',
        top: '40%', right: '10%',
        animation: 'morphBlob 18s ease-in-out infinite 5s',
        filter: 'blur(60px)',
        pointerEvents: 'none',
      }} />

      <div style={{ width: '100%', maxWidth: 420, position: 'relative', zIndex: 1 }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="float-anim" style={{
            width: 60, height: 60, borderRadius: 18,
            background: 'var(--grad-brand)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.75rem', marginBottom: '1rem',
            boxShadow: '0 0 40px rgba(255,255,255,0.06)',
          }}>🎓</div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.875rem', fontWeight: 800 }}>
            Welcome back to <span className="gradient-text">CollegeRAG</span>
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '.5rem' }}>Your AI academic assistant</p>
        </div>

        <div className="glass-card" style={{ padding: '2rem', borderRadius: 'var(--radius-xl)' }}>
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="floating-label-wrap">
              <input
                id="login-email"
                className="input"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder=" "
                required
                style={{ paddingLeft: '2.5rem' }}
              />
              <Mail size={15} style={{ position: 'absolute', left: '.75rem', top: '1.1rem', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <label>Email</label>
            </div>
            <div className="floating-label-wrap">
              <input
                id="login-password"
                className="input"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder=" "
                required
                style={{ paddingLeft: '2.5rem' }}
              />
              <Lock size={15} style={{ position: 'absolute', left: '.75rem', top: '1.1rem', color: 'var(--text-muted)', pointerEvents: 'none' }} />
              <label>Password</label>
            </div>
            {error && (
              <div style={{
                background: 'rgba(244,63,94,.1)', border: '1px solid rgba(244,63,94,.3)',
                borderRadius: 'var(--radius-sm)', padding: '.65rem .875rem',
                color: 'var(--rose)', fontSize: '.875rem',
              }}>{error}</div>
            )}
            <button id="login-submit" className="btn btn-primary w-full" type="submit" disabled={loading} style={{ justifyContent: 'center', marginTop: '.25rem' }}>
              {loading ? <><div className="spinner" style={{ width: 16, height: 16 }} /> Signing in...</> : 'Sign In'}
            </button>
          </form>
        </div>

        <p style={{ textAlign: 'center', marginTop: '1.25rem', color: 'var(--text-secondary)', fontSize: '.875rem' }}>
          Don't have an account?{' '}
          <Link to="/register" style={{ color: 'var(--accent-light)', textDecoration: 'none', fontWeight: 500 }}>Register</Link>
        </p>
      </div>
    </div>
  )
}

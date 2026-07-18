import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store'
import AppLayout from './components/AppLayout'
import { ToastProvider } from './components/shared/Toast'
import { Skeleton } from './components/shared/Skeleton'

const ChatLayout = lazy(() => import('./components/ChatLayout'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'))
const CoursesPage = lazy(() => import('./pages/CoursesPage'))
const StudyToolsPage = lazy(() => import('./pages/StudyToolsPage'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const OrganizationSettings = lazy(() => import('./pages/OrganizationSettings'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const WebSearchPage = lazy(() => import('./pages/WebSearchPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

function PageFallback() {
  return (
    <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
      <Skeleton height={32} width="40%" style={{ marginBottom: '1rem' }} />
      <Skeleton height={120} style={{ marginBottom: '.75rem' }} />
      <Skeleton height={80} style={{ marginBottom: '.75rem' }} />
      <Skeleton height={200} />
    </div>
  )
}

function PrivateRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  if (!token) return <Navigate to="/login" replace />
  if (user?.role === 'admin') return <Navigate to="/admin" replace />
  return children
}

function AdminRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  if (!token) return <Navigate to="/login" replace />
  if (user?.role !== 'admin') return <Navigate to="/chat" replace />
  return children
}

import { useEffect } from 'react'

function ImpersonationBanner() {
  const setAuth = useAuthStore((s) => s.setAuth)
  const user = useAuthStore((s) => s.user)
  const hasOriginal = !!localStorage.getItem('rag-admin-original-auth')

  if (!hasOriginal) return null

  const handleReturn = () => {
    try {
      const orig = JSON.parse(localStorage.getItem('rag-admin-original-auth'))
      if (orig && orig.token && orig.user) {
        setAuth(orig.token, orig.user)
        localStorage.removeItem('rag-admin-original-auth')
        window.location.href = '/admin'
      }
    } catch (e) {
      localStorage.removeItem('rag-admin-original-auth')
      window.location.href = '/login'
    }
  }

  return (
    <div style={{
      background: 'linear-gradient(90deg, #b45309, #d97706)',
      color: '#fff',
      padding: '.5rem 1rem',
      fontSize: '.8rem',
      fontWeight: 600,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '1rem',
      zIndex: 9999,
      position: 'relative'
    }}>
      <span>⚠️ You are impersonating user <strong>{user?.full_name || user?.email}</strong> ({user?.role})</span>
      <button onClick={handleReturn} style={{
        background: '#fff',
        color: '#b45309',
        border: 'none',
        padding: '2px 8px',
        borderRadius: 4,
        cursor: 'pointer',
        fontSize: '.75rem',
        fontWeight: 700
      }}>
        Return to Admin Dashboard
      </button>
    </div>
  )
}

export default function App() {
  useEffect(() => {
    const savedTheme = localStorage.getItem('rag-theme') || 'dark'
    const savedAccent = localStorage.getItem('rag-accent-color') || 'stone'
    document.documentElement.setAttribute('data-theme', savedTheme)

    const accentPresets = {
      stone: { accent: '#a3a3a3', light: '#d4d4d4', dark: '#737373' },
      violet: { accent: '#8b5cf6', light: '#a78bfa', dark: '#6d28d9' },
      cyan: { accent: '#06b6d4', light: '#22d3ee', dark: '#0e7490' },
      emerald: { accent: '#10b981', light: '#34d399', dark: '#047857' },
      amber: { accent: '#f59e0b', light: '#fbbf24', dark: '#b45309' },
      rose: { accent: '#f43f5e', light: '#fb7185', dark: '#be123c' }
    }
    const lightPresets = {
      stone: { accent: '#525252', light: '#262626', dark: '#a3a3a3' },
      violet: { accent: '#7c3aed', light: '#6d28d9', dark: '#ddd6fe' },
      cyan: { accent: '#0891b2', light: '#0e7490', dark: '#cffafe' },
      emerald: { accent: '#059669', light: '#047857', dark: '#d1fae5' },
      amber: { accent: '#d97706', light: '#b45309', dark: '#fef3c7' },
      rose: { accent: '#e11d48', light: '#be123c', dark: '#ffe4e6' }
    }
    const preset = savedTheme === 'light' ? lightPresets[savedAccent] : accentPresets[savedAccent]
    if (preset) {
      document.documentElement.style.setProperty('--accent', preset.accent)
      document.documentElement.style.setProperty('--accent-light', preset.light)
      document.documentElement.style.setProperty('--accent-dark', preset.dark)
      if (savedTheme === 'light') {
        document.documentElement.style.setProperty('--grad-brand', `linear-gradient(135deg, ${preset.accent} 0%, ${preset.light} 50%, ${preset.dark} 100%)`)
      } else {
        document.documentElement.style.setProperty('--grad-brand', `linear-gradient(135deg, ${preset.dark} 0%, ${preset.accent} 50%, ${preset.light} 100%)`)
      }
    }
  }, [])

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <ImpersonationBanner />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/chat" element={<PrivateRoute><ChatLayout /></PrivateRoute>} />
            <Route path="/" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="courses" element={<CoursesPage />} />
              <Route path="study" element={<StudyToolsPage />} />
              <Route path="org/:orgId" element={<OrganizationSettings />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="web-search" element={<WebSearchPage />} />
              <Route path="settings" element={<SettingsPage />} />
            </Route>
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  )
}

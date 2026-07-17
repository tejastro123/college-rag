import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react'

const ToastContext = createContext()

let toastId = 0

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = ++toastId
    setToasts(prev => [...prev, { id, message, type }])
    if (duration > 0) {
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id))
      }, duration)
    }
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast }}>
      {children}
      <div style={{
        position: 'fixed', top: '1rem', right: '1rem', zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: '.5rem',
        pointerEvents: 'none', maxWidth: 360,
      }}>
        {toasts.map(toast => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

const TOAST_ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
}

const TOAST_COLORS = {
  success: { bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.3)', icon: '#d4d4d4' },
  error: { bg: 'rgba(120,113,108,0.15)', border: 'rgba(120,113,108,0.3)', icon: '#a8a29e' },
  warning: { bg: 'rgba(168,162,158,0.12)', border: 'rgba(168,162,158,0.25)', icon: '#d6d3d1' },
  info: { bg: 'rgba(163,163,163,0.12)', border: 'rgba(163,163,163,0.25)', icon: '#d4d4d4' },
}

function ToastItem({ toast, onClose }) {
  const Icon = TOAST_ICONS[toast.type] || Info
  const colors = TOAST_COLORS[toast.type] || TOAST_COLORS.info

  useEffect(() => {
    const el = document.getElementById(`toast-${toast.id}`)
    if (el) el.style.animation = 'slideInRight .3s cubic-bezier(0.4, 0, 0.2, 1) forwards'
  }, [toast.id])

  return (
    <div
      id={`toast-${toast.id}`}
      style={{
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'flex-start', gap: '.65rem',
        padding: '.75rem 1rem',
        background: 'rgba(17,17,17,0.95)',
        backdropFilter: 'blur(16px)',
        border: `1px solid ${colors.border}`,
        borderRadius: 'var(--radius)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
        opacity: 0,
        transform: 'translateX(100%)',
      }}
    >
      <Icon size={16} style={{ color: colors.icon, flexShrink: 0, marginTop: 2 }} />
      <span style={{ fontSize: '.875rem', color: 'var(--text-primary)', flex: 1 }}>{toast.message}</span>
      <button onClick={onClose} style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: 'var(--text-muted)', padding: 2, flexShrink: 0,
      }}>
        <X size={14} />
      </button>
    </div>
  )
}

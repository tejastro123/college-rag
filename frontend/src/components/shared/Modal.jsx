import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ open, onClose, title, children, maxWidth }) {
  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '1.5rem',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="slide-in-up"
        style={{
          width: '100%',
          maxWidth: maxWidth || 520,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'rgba(16,18,31,0.85)',
          backdropFilter: 'blur(32px) saturate(200%)',
          WebkitBackdropFilter: 'blur(32px) saturate(200%)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 'var(--radius-xl)',
          padding: '1.75rem',
          boxShadow: '0 32px 64px rgba(0,0,0,0.5)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '1.25rem' }}>{title}</h2>
          <button
            onClick={onClose}
            className="btn btn-ghost btn-icon"
            style={{ padding: '.35rem', borderRadius: 'var(--radius-sm)' }}
          >
            <X size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

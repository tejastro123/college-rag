export default function Topbar({ title, subtitle, actions }) {
  return (
    <div style={{
      padding: '.875rem 1.5rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      background: 'rgba(16,18,31,0.5)',
      backdropFilter: 'blur(12px) saturate(160%)',
      WebkitBackdropFilter: 'blur(12px) saturate(160%)',
      borderBottom: '1px solid var(--glass-border)',
      position: 'sticky', top: 0, zIndex: 10,
    }}>
      <div>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.25rem', fontWeight: 800 }}>{title}</h1>
        {subtitle && <p style={{ color: 'var(--text-secondary)', fontSize: '.8125rem', marginTop: '.1rem' }}>{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2">{actions}</div>}
    </div>
  )
}

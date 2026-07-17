export default function StatTile({ icon, value, label, color }) {
  return (
    <div className="stat-tile">
      <div className="stat-icon" style={{ background: `${color || 'var(--accent)'}18`, color: color || 'var(--accent-light)' }}>
        {icon}
      </div>
      <div>
        <div className="stat-value" style={{ color: color || 'var(--text-primary)' }}>{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  )
}

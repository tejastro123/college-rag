import clsx from 'clsx'

export default function BentoCard({ children, color, onClick, className, style }) {
  return (
    <div
      onClick={onClick}
      className={clsx('bento-card', className)}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        background: color
          ? `linear-gradient(135deg, ${color}10, ${color}05)`
          : 'var(--grad-mesh)',
        border: color ? `1px solid ${color}30` : '1px solid var(--border)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

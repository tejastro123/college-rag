import clsx from 'clsx'

export default function GlassCard({ children, className, style, strong, ...props }) {
  return (
    <div
      className={clsx(strong ? 'glass-strong' : 'glass-card', className)}
      style={style}
      {...props}
    >
      {children}
    </div>
  )
}

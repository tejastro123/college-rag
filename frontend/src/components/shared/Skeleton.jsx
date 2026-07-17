import clsx from 'clsx'

export function Skeleton({ className, style, width, height, borderRadius }) {
  return (
    <div
      className={clsx('skeleton', className)}
      style={{
        width: width || '100%',
        height: height || 16,
        borderRadius: borderRadius || 'var(--radius-sm)',
        ...style,
      }}
    />
  )
}

export function DocumentCardSkeleton() {
  return (
    <div className="bento-card" style={{ padding: '1.125rem', cursor: 'default' }}>
      <div className="flex gap-3" style={{ marginBottom: '.875rem' }}>
        <Skeleton width={40} height={40} borderRadius={10} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
          <Skeleton width="70%" height={14} />
          <Skeleton width="40%" height={12} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.35rem', marginBottom: '.875rem' }}>
        <Skeleton height={12} />
        <Skeleton height={12} />
        <Skeleton height={12} />
        <Skeleton height={12} />
      </div>
      <div className="flex gap-2">
        <Skeleton width={80} height={28} borderRadius={8} />
        <Skeleton width={80} height={28} borderRadius={8} style={{ marginLeft: 'auto' }} />
      </div>
    </div>
  )
}

export function MessageSkeleton() {
  return (
    <div className="message-wrap" style={{ alignItems: 'flex-start' }}>
      <Skeleton width={34} height={34} borderRadius="50%" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.4rem', maxWidth: '70%' }}>
        <Skeleton height={60} borderRadius={12} />
        <Skeleton width="60%" height={14} borderRadius={6} />
      </div>
    </div>
  )
}

export function CourseCardSkeleton() {
  return (
    <div className="bento-card" style={{ cursor: 'default' }}>
      <div style={{ height: 3, background: 'var(--border)', borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0', marginBottom: '.75rem' }} />
      <div className="flex gap-3 items-center" style={{ marginBottom: '.75rem' }}>
        <Skeleton width={44} height={44} borderRadius={12} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
          <Skeleton width="60%" height={15} />
          <Skeleton width="30%" height={12} />
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', marginBottom: '.75rem' }}>
        <Skeleton width="40%" height={12} />
        <Skeleton width="50%" height={12} />
      </div>
      <Skeleton width="100%" height={32} borderRadius={8} />
    </div>
  )
}

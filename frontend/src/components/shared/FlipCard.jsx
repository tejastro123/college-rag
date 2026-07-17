import { useState } from 'react'
import clsx from 'clsx'

export default function FlipCard({ front, back }) {
  const [flipped, setFlipped] = useState(false)

  return (
    <div className={clsx('flip-card', flipped && 'flipped')} onClick={() => setFlipped(!flipped)} style={{ cursor: 'pointer' }}>
      <div className="flip-card-inner">
        <div className="flip-card-front">
          <p style={{ fontSize: '.8125rem', color: 'var(--text-secondary)', textAlign: 'center' }}>{front}</p>
        </div>
        <div className="flip-card-back">
          <p style={{ fontSize: '.875rem', color: 'var(--text-primary)', textAlign: 'center' }}>{back}</p>
        </div>
      </div>
    </div>
  )
}

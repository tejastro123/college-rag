import { useEffect, useRef } from 'react'

export default function AnimatedPage({ children }) {
  const ref = useRef(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.opacity = '0'
    el.style.transform = 'translateY(12px)'
    requestAnimationFrame(() => {
      el.style.transition = 'opacity .35s cubic-bezier(0.4, 0, 0.2, 1), transform .35s cubic-bezier(0.4, 0, 0.2, 1)'
      el.style.opacity = '1'
      el.style.transform = 'translateY(0)'
    })
  }, [])

  return <div ref={ref}>{children}</div>
}

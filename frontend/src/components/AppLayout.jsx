import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { MessageSquare, FileText, BookOpen, Zap, LogOut, ChevronDown, ChevronUp, Menu } from 'lucide-react'
import { useAuthStore, useCourseStore } from '../store'
import { coursesApi } from '../api'
import { useIsMobile } from '../hooks/useMediaQuery'

const navItems = [
  { to: '/chat',      icon: MessageSquare, label: 'Chat' },
  { to: '/documents', icon: FileText,       label: 'Documents' },
  { to: '/courses',   icon: BookOpen,       label: 'Courses' },
  { to: '/study',     icon: Zap,            label: 'Study' },
]

function NavItem({ to, icon: Icon, label, onClick }) {
  return (
    <NavLink to={to} onClick={onClick} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <div className="tooltip-wrap" style={{
          display: 'flex', alignItems: 'center', gap: '.75rem',
          padding: '.65rem', borderRadius: 'var(--radius)',
          background: isActive ? 'rgba(255,255,255,.08)' : 'transparent',
          border: isActive ? '1px solid rgba(255,255,255,.2)' : '1px solid transparent',
          borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
          color: isActive ? 'var(--accent-light)' : 'var(--text-secondary)',
          transition: 'all .15s', cursor: 'pointer', justifyContent: 'center',
        }}>
          <Icon size={18} style={{ flexShrink: 0 }} />
          <span className="nav-label" style={{ fontSize: '.875rem', fontWeight: isActive ? 600 : 400 }}>{label}</span>
          <span className="tooltip-text" style={{ left: 'calc(100% + 8px)', bottom: 'auto', top: '50%', transform: 'translateY(-50%)' }}>{label}</span>
        </div>
      )}
    </NavLink>
  )
}

function MobileNavItem({ to, icon: Icon, label }) {
  return (
    <NavLink to={to} className={({ isActive }) => isActive ? 'active' : ''}>
      <Icon size={18} />
      <span>{label}</span>
    </NavLink>
  )
}

export default function AppLayout() {
  const { user, logout } = useAuthStore()
  const { courses, setCourses } = useCourseStore()
  const [coursesOpen, setCoursesOpen] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  useEffect(() => {
    coursesApi.list().then(r => setCourses(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isMobile) setSidebarOpen(false)
  }, [isMobile])

  const handleLogout = useCallback(() => { logout(); navigate('/login') }, [logout, navigate])
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  return (
    <div className="layout">
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      {/* Mobile sidebar overlay */}
      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={closeSidebar} />

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        {/* Mobile close area */}
        <div className="hide-desktop" style={{ display: 'flex', justifyContent: 'flex-end', padding: '.5rem' }}>
          <button className="btn btn-ghost btn-icon" onClick={closeSidebar}>
            <Menu size={16} />
          </button>
        </div>

        <div style={{ padding: '.5rem 0', display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
          <div className="glow-pulse" style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'var(--grad-brand)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '1.2rem', boxShadow: 'var(--shadow-glow)',
          }}>🎓</div>
        </div>

        <nav style={{ flex: 1, padding: '.5rem .375rem', display: 'flex', flexDirection: 'column', gap: '.15rem' }}>
          {navItems.map(item => (
            <NavItem key={item.to} {...item} onClick={closeSidebar} />
          ))}

          {courses.length > 0 && (
            <div style={{ marginTop: '.5rem' }}>
              <button onClick={() => setCoursesOpen(!coursesOpen)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem',
                width: '100%', padding: '.4rem', border: 'none', background: 'transparent',
                color: 'var(--text-muted)', fontSize: '.65rem', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer',
              }}>
                <span className="sidebar-section-label" style={{ fontSize: '.65rem' }}>Courses</span>
                {coursesOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
              </button>
              <div style={{ overflow: 'hidden', maxHeight: coursesOpen ? courses.length * 40 : 0, transition: 'max-height .3s var(--ease)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.1rem', padding: '0 .25rem' }}>
                  {courses.slice(0, 5).map(course => (
                    <div key={course.id} className="tooltip-wrap" style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.5rem',
                      padding: '.4rem .5rem', borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '.8125rem',
                    }}>
                      <span style={{ fontSize: '.85rem', flexShrink: 0 }}>{course.icon}</span>
                      <span className="nav-label truncate">{course.name}</span>
                      <span className="tooltip-text" style={{ left: 'calc(100% + 8px)', bottom: 'auto', top: '50%', transform: 'translateY(-50%)' }}>{course.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </nav>

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '.75rem .5rem', flexShrink: 0 }}>
          <div className="tooltip-wrap" style={{ display: 'flex', justifyContent: 'center', marginBottom: '.5rem' }}>
            <div style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'var(--grad-brand)', padding: 2,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <div style={{
                width: '100%', height: '100%', borderRadius: '50%',
                background: 'var(--bg-surface)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.7rem', fontWeight: 700, color: 'var(--accent-light)',
              }}>{user?.full_name?.[0] || 'U'}</div>
            </div>
            <span className="tooltip-text" style={{ left: 'calc(100% + 8px)', bottom: 'auto', top: '50%', transform: 'translateY(-50%)' }}>
              {user?.full_name || 'User'}
            </span>
          </div>
          <div className="tooltip-wrap" style={{ display: 'flex', justifyContent: 'center' }}>
            <button className="btn btn-ghost btn-icon" onClick={handleLogout} style={{ padding: '.5rem', borderRadius: 'var(--radius-sm)', background: 'transparent' }}>
              <LogOut size={15} />
            </button>
            <span className="tooltip-text" style={{ left: 'calc(100% + 8px)', bottom: 'auto', top: '50%', transform: 'translateY(-50%)' }}>Sign out</span>
          </div>
        </div>
      </aside>

      {/* Mobile hamburger */}
      <button
        className="hide-desktop"
        onClick={() => setSidebarOpen(true)}
        style={{
          position: 'fixed', top: '.75rem', left: '.75rem', zIndex: 50,
          width: 36, height: 36, borderRadius: 'var(--radius-sm)',
          background: 'rgba(17,17,17,0.8)', backdropFilter: 'blur(8px)',
          border: '1px solid var(--border)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--text-secondary)',
        }}
      >
        <Menu size={16} />
      </button>

      {/* Mobile bottom nav */}
      <nav className="mobile-bottom-nav">
        {navItems.map(item => (
          <MobileNavItem key={item.to} {...item} />
        ))}
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}

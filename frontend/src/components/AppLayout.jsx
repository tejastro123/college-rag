import { useState, useEffect, useCallback } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  MessageSquare, FileText, BookOpen, Zap, LogOut, ChevronDown, ChevronUp,
  Menu, Search, ChevronLeft, ChevronRight, Settings, User, Sparkles, Palette, HelpCircle
} from 'lucide-react'
import { useAuthStore, useCourseStore } from '../store'
import { coursesApi } from '../api'
import { useIsMobile } from '../hooks/useMediaQuery'
import SearchBar from './shared/SearchBar'
import ThemeToggle from './shared/ThemeToggle'

const navItems = [
  { to: '/chat',      icon: MessageSquare, label: 'Chat' },
  { to: '/documents', icon: FileText,       label: 'Documents' },
  { to: '/courses',   icon: BookOpen,       label: 'Courses' },
  { to: '/study',     icon: Zap,            label: 'Study' },
  { to: '/web-search', icon: Search,        label: 'Web Search' },
]

function NavItem({ to, icon: Icon, label, onClick }) {
  return (
    <NavLink to={to} onClick={onClick} style={{ textDecoration: 'none' }}>
      {({ isActive }) => (
        <div className={`tooltip-wrap nav-item-inner ${isActive ? 'active' : ''}`}>
          <Icon size={18} style={{ flexShrink: 0 }} />
          <span className="nav-label" style={{ fontSize: '.875rem', fontWeight: isActive ? 600 : 400 }}>{label}</span>
          <span className="sidebar-tooltip">{label}</span>
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
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebar-collapsed') === 'true')
  const [popoverOpen, setPopoverOpen] = useState(false)
  const isMobile = useIsMobile()
  const navigate = useNavigate()

  useEffect(() => {
    coursesApi.list().then(r => setCourses(r.data)).catch(() => {})
  }, [setCourses])

  useEffect(() => {
    if (!isMobile) setSidebarOpen(false)
  }, [isMobile])

  // Close user popover on click outside
  useEffect(() => {
    if (!popoverOpen) return
    const handleOutsideClick = (e) => {
      if (!e.target.closest('.user-popover') && !e.target.closest('.sidebar-user-row')) {
        setPopoverOpen(false)
      }
    }
    document.addEventListener('click', handleOutsideClick)
    return () => document.removeEventListener('click', handleOutsideClick)
  }, [popoverOpen])

  const handleLogout = useCallback(() => {
    logout()
    navigate('/login')
  }, [logout, navigate])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])

  const toggleCollapse = useCallback(() => {
    setIsCollapsed(prev => {
      const next = !prev
      localStorage.setItem('sidebar-collapsed', String(next))
      return next
    })
  }, [])

  return (
    <div className="layout">
      <div className="orb orb-1" />
      <div className="orb orb-2" />

      {/* Mobile sidebar overlay */}
      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={closeSidebar} />

      {/* Sidebar */}
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''} ${isCollapsed ? 'collapsed' : ''}`}>
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

        <nav style={{ flex: 1, padding: '.5rem .375rem', display: 'flex', flexDirection: 'column', gap: '.15rem', overflowY: 'auto', overflowX: 'hidden' }}>
          {navItems.map(item => (
            <NavItem key={item.to} {...item} onClick={closeSidebar} />
          ))}

          {courses.length > 0 && (
            <div style={{ marginTop: '.5rem' }}>
              <button onClick={() => setCoursesOpen(!coursesOpen)} style={{
                display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '.5rem',
                width: '100%', padding: '.4rem', border: 'none', background: 'transparent',
                color: 'var(--text-muted)', fontSize: '.65rem', fontWeight: 600,
                textTransform: 'uppercase', letterSpacing: '.08em', cursor: 'pointer',
              }}>
                <span className="sidebar-section-label" style={{ fontSize: '.65rem' }}>Courses</span>
                {!isCollapsed && (coursesOpen ? <ChevronUp size={10} className="courses-toggle-chevron" /> : <ChevronDown size={10} className="courses-toggle-chevron" />)}
              </button>
              <div style={{ overflow: 'hidden', maxHeight: coursesOpen ? courses.length * 40 : 0, transition: 'max-height .3s var(--ease)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '.1rem', padding: '0 .25rem' }}>
                  {courses.slice(0, 5).map(course => (
                    <div key={course.id} className="tooltip-wrap sidebar-course-item" style={{
                      display: 'flex', alignItems: 'center', justifyContent: isCollapsed ? 'center' : 'flex-start', gap: '.5rem',
                      padding: '.4rem .5rem', borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer', color: 'var(--text-secondary)', fontSize: '.8125rem',
                    }}>
                      <span style={{ fontSize: '.85rem', flexShrink: 0 }}>{course.icon}</span>
                      <span className="nav-label truncate">{course.name}</span>
                      <span className="sidebar-tooltip">{course.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </nav>

        <div style={{ padding: '.5rem', display: 'flex', justifyContent: isCollapsed ? 'center' : 'flex-start' }}>
          <ThemeToggle />
        </div>

        {/* Collapse Sidebar Option (Desktop only) */}
        <div className="hide-mobile" style={{ padding: '0 .5rem', marginBottom: '.25rem' }}>
          <div className="tooltip-wrap" style={{ width: '100%' }}>
            <button
              onClick={toggleCollapse}
              className="nav-item-inner"
              style={{
                background: 'transparent', border: 'none', padding: '.5rem',
                justifyContent: isCollapsed ? 'center' : 'flex-start',
                color: 'var(--text-muted)'
              }}
            >
              {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
              <span className="nav-label" style={{ fontSize: '.8125rem' }}>Collapse sidebar</span>
            </button>
            <span className="sidebar-tooltip">{isCollapsed ? "Expand sidebar" : "Collapse sidebar"}</span>
          </div>
        </div>

        {/* Bottom User Area */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', padding: '.5rem', flexShrink: 0, position: 'relative' }}>
          {/* User Popover Menu */}
          {popoverOpen && (
            <div className="user-popover">
              <div className="user-popover-header" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=profile'); }}>
                <div className="user-popover-avatar">
                  {user?.full_name?.[0]?.toUpperCase() || 'U'}
                </div>
                <div className="user-popover-info">
                  <span className="user-popover-username truncate">{user?.username || 'user'}</span>
                  <span className="user-popover-subtext truncate">{user?.role || 'Go'}</span>
                </div>
                <ChevronRight size={14} className="user-popover-chevron" style={{ color: 'var(--text-muted)' }} />
              </div>
              <div className="user-popover-divider" />
              <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/billing'); }}>
                <Sparkles size={14} />
                <span>Upgrade plan</span>
              </button>
              <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=personalization'); }}>
                <Palette size={14} />
                <span>Personalization</span>
              </button>
              <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=profile'); }}>
                <User size={14} />
                <span>Profile</span>
              </button>
              <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=general'); }}>
                <Settings size={14} />
                <span>Settings</span>
              </button>
              <div className="user-popover-divider" />
              <button className="user-popover-item" onClick={() => { setPopoverOpen(false); navigate('/settings?tab=help'); }}>
                <HelpCircle size={14} />
                <span>Help</span>
              </button>
              <button className="user-popover-item" onClick={() => { setPopoverOpen(false); handleLogout(); }}>
                <LogOut size={14} />
                <span>Log out</span>
              </button>
            </div>
          )}

          {/* User Row Trigger */}
          <div className="tooltip-wrap" style={{ width: '100%' }}>
            <div className="sidebar-user-row" onClick={() => setPopoverOpen(!popoverOpen)}>
              <div style={{
                width: 34, height: 34, borderRadius: '50%',
                background: '#ec4899', // Vibrant Pink
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '.8rem', fontWeight: 700, color: 'white', flexShrink: 0
              }}>
                {user?.full_name?.[0]?.toUpperCase() || 'U'}
              </div>
              <div className="sidebar-user-info" style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                <span className="truncate" style={{ fontSize: '.8125rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {user?.username || 'user'}
                </span>
                <span className="truncate" style={{ fontSize: '.7rem', color: 'var(--text-muted)' }}>
                  Go
                </span>
              </div>
              <ChevronRight size={14} className="sidebar-user-chevron" style={{ color: 'var(--text-muted)', transform: popoverOpen ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }} />
            </div>
            <span className="sidebar-tooltip">
              {user?.full_name || 'User'}
            </span>
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

      <main className={`main-content ${isCollapsed ? 'collapsed' : ''}`}>
        <div className="hide-mobile" style={{ padding: '.75rem 1.5rem', display: 'flex', justifyContent: 'flex-end' }}>
          <SearchBar />
        </div>
        <Outlet />
      </main>
    </div>
  )
}

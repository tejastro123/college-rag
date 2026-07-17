import { useTheme } from '../../hooks/useTheme'

export default function ThemeToggle({ className = '' }) {
  const { theme, toggle } = useTheme()

  return (
    <button
      onClick={toggle}
      className={`btn btn-icon btn-ghost ${className}`}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      aria-label="Toggle theme"
      style={{ fontSize: '1.1rem' }}
    >
      {theme === 'dark' ? '\u2600' : '\u263E'}
    </button>
  )
}

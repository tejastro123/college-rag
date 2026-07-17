import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../../api'

export default function SearchBar() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const inputRef = useRef(null)
  const containerRef = useRef(null)
  const debounceRef = useRef(null)
  const navigate = useNavigate()

  const doSearch = useCallback(async (q) => {
    if (!q.trim()) { setResults(null); return }
    setLoading(true)
    try {
      const { data } = await api.get('/search/', { params: { q, limit: 5 } })
      setResults(data)
      setOpen(true)
    } catch { setResults(null) }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (query) {
      clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => doSearch(query), 300)
    } else {
      setResults(null)
      setOpen(false)
    }
    return () => clearTimeout(debounceRef.current)
  }, [query, doSearch])

  useEffect(() => {
    const handler = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: 320 }}>
      <input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search documents, courses..."
        className="input"
        style={{ paddingLeft: '2rem', fontSize: '.8125rem' }}
      />
      <span style={{ position: 'absolute', left: '.65rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: '.8rem' }}>
        &#8981;
      </span>

      {open && results && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0,
          marginTop: 4, borderRadius: 'var(--radius)',
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)', zIndex: 300, overflow: 'hidden',
        }}>
          {loading && <div className="spinner" style={{ margin: '1rem auto' }} />}

          {results.documents?.length > 0 && (
            <div>
              <p style={{ padding: '.5rem .75rem', fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Documents</p>
              {results.documents.map(d => (
                <button
                  key={d.id}
                  onClick={() => { navigate('/documents'); setOpen(false); setQuery('') }}
                  style={{ display: 'block', width: '100%', padding: '.5rem .75rem', textAlign: 'left', background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: '.8125rem', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {d.title || d.filename}
                  <span style={{ marginLeft: '.5rem', fontSize: '.65rem', color: 'var(--text-muted)' }}>{d.file_type}</span>
                </button>
              ))}
            </div>
          )}

          {results.courses?.length > 0 && (
            <div>
              <p style={{ padding: '.5rem .75rem', fontSize: '.65rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Courses</p>
              {results.courses.map(c => (
                <button
                  key={c.id}
                  onClick={() => { navigate('/courses'); setOpen(false); setQuery('') }}
                  style={{ display: 'block', width: '100%', padding: '.5rem .75rem', textAlign: 'left', background: 'none', border: 'none', color: 'var(--text-primary)', fontSize: '.8125rem', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  {c.name} <span style={{ color: 'var(--text-muted)' }}>{c.code}</span>
                </button>
              ))}
            </div>
          )}

          {!results.documents?.length && !results.courses?.length && (
            <p style={{ padding: '1rem', textAlign: 'center', fontSize: '.8125rem', color: 'var(--text-muted)' }}>
              No results found
            </p>
          )}
        </div>
      )}
    </div>
  )
}

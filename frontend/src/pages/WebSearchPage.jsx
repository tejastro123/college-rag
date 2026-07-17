import { useState, useCallback } from 'react'
import { Search, Youtube, Globe, Loader2, ExternalLink, ChevronDown, ChevronUp, FileText } from 'lucide-react'
import { useAuthStore } from '../store'
import api from '../api'
import AnimatedPage from '../components/shared/AnimatedPage'

const TABS = [
  { id: 'web', label: 'Web Search', icon: Globe },
  { id: 'youtube', label: 'YouTube', icon: Youtube },
]

function VideoCard({ video }) {
  const videoId = video.url ? video.url.split('v=')[1]?.split('&')[0] || video.url.split('/').pop() : ''
  return (
    <div className="glass-card" style={{ padding: '1rem', borderRadius: 'var(--radius)' }}>
      <div style={{ display: 'flex', gap: '1rem' }}>
        {video.thumbnail && (
          <img src={video.thumbnail} alt="" style={{ width: 120, height: 68, borderRadius: 'var(--radius-sm)', objectFit: 'cover', flexShrink: 0 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <a href={video.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)', fontWeight: 600, textDecoration: 'none', fontSize: '.9375rem', display: 'block', marginBottom: '.25rem' }}>
            {video.title || 'Untitled'}
          </a>
          <p style={{ color: 'var(--text-secondary)', fontSize: '.8125rem', marginBottom: '.5rem', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {video.description || video.snippet || 'No description'}
          </p>
          <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
            {video.duration && <span style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{video.duration}</span>}
            {videoId && (
              <button
                onClick={async () => {
                  try {
                    const { data } = await api.get('/api/v1/web-search/youtube/transcript', { params: { video_id: videoId } })
                    navigator.clipboard.writeText(data.transcript)
                    alert('Transcript copied to clipboard!')
                  } catch { alert('Transcript not available') }
                }}
                style={{ fontSize: '.75rem', color: 'var(--accent-light)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
              >
                Get Transcript
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function WebResultCard({ result }) {
  return (
    <div className="glass-card" style={{ padding: '1rem', borderRadius: 'var(--radius)' }}>
      <a href={result.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-light)', fontWeight: 600, textDecoration: 'none', fontSize: '.9375rem', display: 'block', marginBottom: '.25rem' }}>
        {result.title || 'Untitled'}
        <ExternalLink size={12} style={{ marginLeft: '.35rem', display: 'inline', verticalAlign: 'middle' }} />
      </a>
      <p style={{ color: 'var(--text-secondary)', fontSize: '.8125rem', marginBottom: '.25rem' }}>
        {result.snippet || 'No description available'}
      </p>
      <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', wordBreak: 'break-all' }}>{result.url}</span>
    </div>
  )
}

export default function WebSearchPage() {
  const [activeTab, setActiveTab] = useState('web')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return
    setLoading(true)
    setError('')
    setResults([])
    try {
      const endpoint = activeTab === 'youtube' ? '/api/v1/web-search/youtube' : '/api/v1/web-search/web'
      const { data } = await api.get(endpoint, { params: { q: query, max_results: 10 } })
      setResults(data.results || [])
    } catch (err) {
      setError(err.response?.data?.detail || 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [query, activeTab])

  return (
    <AnimatedPage>
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.75rem', fontWeight: 800, marginBottom: '.5rem' }}>
            <span className="gradient-text">Web & YouTube</span> Search
          </h1>
          <p style={{ color: 'var(--text-secondary)' }}>Search the web or YouTube for live content</p>
        </div>

        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '1.5rem', justifyContent: 'center' }}>
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setActiveTab(tab.id); setResults([]) }}
              className={`btn ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
              style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '.5rem', marginBottom: '2rem' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSearch()}
            placeholder={activeTab === 'youtube' ? 'Search YouTube videos...' : 'Search the web...'}
            className="input flex-1"
          />
          <button className="btn btn-primary" onClick={handleSearch} disabled={loading || !query.trim()} style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
            {loading ? <Loader2 size={16} className="spin" /> : <Search size={16} />}
            Search
          </button>
        </div>

        {error && <div style={{ background: 'rgba(244,63,94,.1)', border: '1px solid rgba(244,63,94,.3)', borderRadius: 'var(--radius)', padding: '.75rem', color: 'var(--rose)', marginBottom: '1rem' }}>{error}</div>}

        {results.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: '.8125rem' }}>{results.length} result{results.length !== 1 ? 's' : ''} found</p>
            {results.map((r, i) => (
              <div key={i}>
                {activeTab === 'youtube' ? <VideoCard video={r} /> : <WebResultCard result={r} />}
              </div>
            ))}
          </div>
        )}

        {!loading && results.length === 0 && !error && (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--text-muted)' }}>
            <Search size={48} style={{ margin: '0 auto 1rem', opacity: 0.3 }} />
            <p>Enter a query above to start searching</p>
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}

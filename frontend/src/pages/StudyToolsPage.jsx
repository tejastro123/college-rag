import { useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { studyApi } from '../api'
import { useCourseStore, useDocumentStore } from '../store'
import FlipCard from '../components/shared/FlipCard'
import BentoCard from '../components/shared/BentoCard'
import AnimatedPage from '../components/shared/AnimatedPage'
import { Skeleton } from '../components/shared/Skeleton'
import clsx from 'clsx'

const TOOLS = [
  { id: 'flashcards',   label: 'Flashcards',    icon: '🃏', desc: 'Generate Q&A flashcard sets', color: '#d4d4d4' },
  { id: 'quiz',         label: 'Quiz',          icon: '📝', desc: 'Multiple choice questions',  color: '#a3a3a3' },
  { id: 'summary',      label: 'Summary',       icon: '📋', desc: 'Structured revision notes',  color: '#878787' },
  { id: 'formula-sheet',label: 'Formula Sheet', icon: '🔢', desc: 'Extract all equations',      color: '#6b6b6b' },
]

function parseFlashcards(text) {
  if (!text) return []
  const cards = []
  const lines = text.split('\n')
  let currentQ = ''
  for (const line of lines) {
    const qMatch = line.match(/^(?:Q|Question|Front):\s*(.+)/i)
    const aMatch = line.match(/^(?:A|Answer|Back):\s*(.+)/i)
    if (qMatch) currentQ = qMatch[1]
    if (aMatch && currentQ) { cards.push({ front: currentQ, back: aMatch[1] }); currentQ = '' }
  }
  return cards.slice(0, 20)
}

export default function StudyToolsPage() {
  const { activeCourse } = useCourseStore()
  const { documents } = useDocumentStore()
  const [activeTool, setActiveTool] = useState('flashcards')
  const [topic, setTopic] = useState('')
  const [count, setCount] = useState(10)
  const [selectedDocs, setSelectedDocs] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)

  const indexedDocs = documents.filter(d => d.status === 'indexed')

  const run = useCallback(async () => {
    setLoading(true); setResult(null)
    try {
      const payload = {
        course_id: activeCourse?.id || null,
        document_ids: selectedDocs.length ? selectedDocs : null,
        topic: topic || null, count,
      }
      let r
      if (activeTool === 'flashcards') r = await studyApi.flashcards(payload)
      else if (activeTool === 'quiz') r = await studyApi.quiz(payload)
      else if (activeTool === 'summary') r = await studyApi.summary(payload)
      else r = await studyApi.formulaSheet(payload)
      setResult(r.data)
    } catch (err) {
      setResult({ error: err.response?.data?.detail || 'Failed to generate. Make sure documents are uploaded and indexed.' })
    } finally { setLoading(false) }
  }, [activeTool, activeCourse, selectedDocs, topic, count])

  const tool = TOOLS.find(t => t.id === activeTool)
  const flashcards = result && !result.error ? parseFlashcards(result.flashcards_text || '') : []

  return (
    <AnimatedPage>
      <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        <div style={{ marginBottom: '1.5rem' }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.625rem', fontWeight: 800 }}>⚡ Study Tools</h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '.875rem', marginTop: '.25rem' }}>Generate learning materials from your uploaded documents</p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
          {TOOLS.map(t => (
            <BentoCard key={t.id} color={activeTool === t.id ? t.color : null}
              onClick={() => { setActiveTool(t.id); setResult(null) }}
              style={{
                textAlign: 'center', padding: '1.25rem', cursor: 'pointer',
                transform: activeTool === t.id ? 'scale(1.03)' : 'scale(1)',
                borderColor: activeTool === t.id ? t.color : 'var(--border)',
                transition: 'all .2s var(--ease)', position: 'relative', overflow: 'hidden',
              }}>
              {activeTool === t.id && <div style={{ position: 'absolute', inset: 0, background: `linear-gradient(135deg, ${t.color}08, transparent)`, pointerEvents: 'none' }} />}
              <div style={{ fontSize: '2rem', marginBottom: '.5rem', animation: activeTool === t.id ? 'float 3s ease-in-out infinite' : 'none' }}>{t.icon}</div>
              <div style={{ fontWeight: 600, fontSize: '.9rem', color: activeTool === t.id ? t.color : 'var(--text-primary)' }}>{t.label}</div>
              <div style={{ fontSize: '.75rem', color: 'var(--text-muted)', marginTop: '.2rem' }}>{t.desc}</div>
            </BentoCard>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 300px) 1fr', gap: '1.5rem' }}>
          <div className="glass-panel" style={{ padding: '1.25rem', alignSelf: 'start', borderRadius: 'var(--radius-lg)' }}>
            <h3 style={{ fontWeight: 700, fontSize: '.9375rem', marginBottom: '1rem' }}>⚙️ Configure {tool?.label}</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.875rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.35rem' }}>Topic (optional)</label>
                <input className="input" placeholder="e.g. Binary Trees, Recursion..." value={topic} onChange={e => setTopic(e.target.value)} />
              </div>
              {activeTool !== 'formula-sheet' && (
                <div>
                  <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.35rem' }}>Count: {count}</label>
                  <input type="range" min={3} max={20} value={count} onChange={e => setCount(+e.target.value)} style={{
                    width: '100%', height: 6, borderRadius: 99,
                    background: `linear-gradient(90deg, var(--accent) ${((count - 3) / 17) * 100}%, var(--border) ${((count - 3) / 17) * 100}%)`,
                    accentColor: 'var(--accent)', outline: 'none',
                  }} />
                </div>
              )}
              {indexedDocs.length > 0 && (
                <div>
                  <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.35rem' }}>Filter Documents</label>
                  <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
                    {indexedDocs.map(d => (
                      <div key={d.id} className={clsx('toggle-chip', selectedDocs.includes(d.id) && 'active')}
                        onClick={() => setSelectedDocs(prev => prev.includes(d.id) ? prev.filter(x => x !== d.id) : [...prev, d.id])}
                        style={{ justifyContent: 'flex-start' }}>
                        <span className="truncate">{d.original_filename}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {indexedDocs.length === 0 && (
                <div style={{ background: 'rgba(168,162,158,.08)', border: '1px solid rgba(168,162,158,.25)', borderRadius: 'var(--radius-sm)', padding: '.65rem .875rem', fontSize: '.8125rem', color: '#d6d3d1' }}>
                  ⚠️ No indexed documents found. Upload and wait for indexing to complete.
                </div>
              )}
              <button className="btn btn-primary w-full" style={{ justifyContent: 'center' }} onClick={run} disabled={loading || indexedDocs.length === 0}>
                {loading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Generating...</> : `Generate ${tool?.label}`}
              </button>
            </div>
          </div>

          <div className="glass-panel" style={{ padding: '1.25rem', minHeight: 450, borderRadius: 'var(--radius-lg)' }}>
            {!result && !loading && (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', gap: '1rem', padding: '2rem' }}>
                <div style={{ fontSize: '3rem' }}>{tool?.icon}</div>
                <p style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Configure options and click "Generate {tool?.label}" to create study materials from your documents.</p>
              </div>
            )}
            {loading && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', padding: '1rem' }}>
                <Skeleton height={24} width="40%" />
                <Skeleton height={120} />
                <Skeleton height={80} />
                <Skeleton height={100} />
              </div>
            )}
            {result && !loading && (
              <div className="fade-in">
                {result.error ? (
                  <div style={{ background: 'rgba(120,113,108,.08)', border: '1px solid rgba(120,113,108,.25)', borderRadius: 'var(--radius)', padding: '1rem', color: '#a8a29e' }}>
                    ⚠️ {result.error}
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-center" style={{ marginBottom: '1rem', gap: '.5rem', flexWrap: 'wrap' }}>
                      <h3 style={{ fontWeight: 700, fontSize: '.9375rem' }}>{tool?.icon} Generated {tool?.label}</h3>
                      {result.confidence != null && (
                        <span className={`badge ${result.confidence > 0.7 ? 'badge-emerald' : 'badge-amber'}`}>
                          {Math.round(result.confidence * 100)}% confidence
                        </span>
                      )}
                    </div>
                    {activeTool === 'flashcards' && flashcards.length > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
                        {flashcards.map((card, i) => <FlipCard key={i} front={card.front} back={card.back} />)}
                      </div>
                    )}
                    {activeTool !== 'flashcards' && (
                      <div className="md-content" style={{ maxHeight: 520, overflowY: 'auto' }}>
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{result.quiz_text || result.summary || result.formula_sheet || ''}</ReactMarkdown>
                      </div>
                    )}
                    {result.citations?.length > 0 && (
                      <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border)', paddingTop: '.75rem' }}>
                        <div style={{ fontSize: '.75rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '.5rem' }}>SOURCES USED</div>
                        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                          {[...new Set(result.citations.map(c => c.filename))].map(fn => (
                            <span key={fn} className="badge badge-accent">{fn}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </AnimatedPage>
  )
}

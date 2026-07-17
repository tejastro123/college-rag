import { useState, useEffect, useCallback, memo } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileText, Trash2, RefreshCw, CheckCircle, XCircle, Clock, List, Grid } from 'lucide-react'
import { documentsApi, coursesApi } from '../api'
import { useDocumentStore, useCourseStore } from '../store'
import Modal from '../components/shared/Modal'
import StatTile from '../components/shared/StatTile'
import SegmentedControl from '../components/shared/SegmentedControl'
import AnimatedPage from '../components/shared/AnimatedPage'
import { DocumentCardSkeleton } from '../components/shared/Skeleton'
import { useToast } from '../components/shared/Toast'
import clsx from 'clsx'

const STATUS_CONFIG = {
  indexed:    { icon: CheckCircle,  color: 'var(--emerald)', label: 'Indexed',    badge: 'badge-emerald' },
  processing: { icon: Clock,        color: 'var(--amber)',   label: 'Processing', badge: 'badge-amber' },
  pending:    { icon: Clock,        color: 'var(--cyan)',    label: 'Pending',    badge: 'badge-accent' },
  failed:     { icon: XCircle,      color: 'var(--rose)',    label: 'Failed',     badge: 'badge-rose' },
}

const DOC_TYPES = ['notes', 'lecture', 'assignment', 'exam', 'manual', 'textbook', 'slides', 'other']

const FILE_TYPE_COLORS = {
  pdf: '#d4d4d4', docx: '#a3a3a3', pptx: '#878787',
  txt: '#6b6b6b', md: '#525252',
}

const FILE_TYPE_ICONS = { pdf: '📄', docx: '📝', pptx: '📊', txt: '📃', md: '📋' }

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'indexed', label: 'Indexed' },
  { value: 'processing', label: 'Processing' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
]

function UploadModal({ courses, onClose, onUploaded }) {
  const [files, setFiles] = useState([])
  const [meta, setMeta] = useState({ course_id: '', subject: '', semester: '', unit: '', doc_type: 'notes', title: '', author: '' })
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: (accepted) => setFiles(accepted),
    multiple: true,
    accept: { 'application/pdf': ['.pdf'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'], 'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'], 'text/plain': ['.txt'], 'text/markdown': ['.md'], 'image/*': ['.png', '.jpg', '.jpeg'] },
  })

  const upload = async () => {
    if (!files.length) return
    setUploading(true); setError('')
    try {
      for (const file of files) {
        const fd = new FormData()
        fd.append('file', file)
        Object.entries(meta).forEach(([k, v]) => v && fd.append(k, v))
        await documentsApi.upload(fd)
      }
      onUploaded()
      onClose()
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed')
    } finally { setUploading(false) }
  }

  return (
    <Modal open title="📤 Upload Documents" onClose={onClose} maxWidth={560}>
      <div {...getRootProps()} className={clsx('dropzone', isDragActive && 'active')} style={{ marginBottom: '1rem', padding: '2rem' }}>
        <input {...getInputProps()} />
        <Upload size={28} style={{ color: 'var(--accent-light)', marginBottom: '.5rem' }} />
        {files.length ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.3rem' }}>
            {files.map(f => <div key={f.name} style={{ fontSize: '.8125rem', color: 'var(--text-secondary)' }}>📄 {f.name}</div>)}
          </div>
        ) : (
          <>
            <p style={{ fontWeight: 600, marginBottom: '.25rem' }}>Drop files here or click to browse</p>
            <p style={{ fontSize: '.8125rem', color: 'var(--text-muted)' }}>PDF, DOCX, PPTX, TXT, MD, PNG, JPG</p>
          </>
        )}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem', marginBottom: '.75rem' }}>
        <div>
          <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Course</label>
          <select className="input" value={meta.course_id} onChange={e => setMeta(m => ({ ...m, course_id: e.target.value }))}>
            <option value="">None</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Doc Type</label>
          <select className="input" value={meta.doc_type} onChange={e => setMeta(m => ({ ...m, doc_type: e.target.value }))}>
            {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Subject</label>
          <input className="input" placeholder="e.g. Data Structures" value={meta.subject} onChange={e => setMeta(m => ({ ...m, subject: e.target.value }))} />
        </div>
        <div>
          <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Unit</label>
          <input className="input" placeholder="e.g. Unit 3" value={meta.unit} onChange={e => setMeta(m => ({ ...m, unit: e.target.value }))} />
        </div>
      </div>
      {error && <div style={{ background: 'rgba(120,113,108,.15)', border: '1px solid rgba(120,113,108,.3)', borderRadius: 'var(--radius-sm)', padding: '.6rem .875rem', color: '#a8a29e', fontSize: '.875rem', marginBottom: '.75rem' }}>{error}</div>}
      <div className="flex gap-3">
        <button className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }} onClick={upload} disabled={uploading || !files.length}>
          {uploading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Uploading...</> : `Upload ${files.length ? `(${files.length})` : ''}`}
        </button>
      </div>
    </Modal>
  )
}

const DocumentCard = memo(function DocumentCard({ doc, onDelete, onReprocess }) {
  const ext = doc.file_type?.toLowerCase()
  const color = FILE_TYPE_COLORS[ext] || 'var(--accent)'
  const cfg = STATUS_CONFIG[doc.status] || STATUS_CONFIG.pending
  const Icon = cfg.icon

  return (
    <div className="bento-card fade-in" style={{ padding: '1.125rem', position: 'relative', overflow: 'hidden', cursor: 'default' }}>
      {doc.status === 'processing' && (
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, var(--accent-dark), var(--accent), var(--accent-dark))',
          backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
      )}
      <div className="flex gap-3" style={{ marginBottom: '.875rem' }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, border: `1px solid ${color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '1.25rem' }}>
          {FILE_TYPE_ICONS[ext] || '📄'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '.9rem' }} className="truncate" title={doc.original_filename}>{doc.original_filename}</div>
          <div className="flex gap-2" style={{ marginTop: '.25rem' }}>
            <span className={`badge ${cfg.badge}`}><Icon size={9} /> {cfg.label}</span>
            {doc.doc_type && <span className="badge badge-accent">{doc.doc_type}</span>}
          </div>
        </div>
      </div>
      <div style={{ fontSize: '.7875rem', color: 'var(--text-secondary)', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.35rem', marginBottom: '.875rem' }}>
        {doc.subject && <span>📖 {doc.subject}</span>}
        {doc.semester && <span>📅 {doc.semester}</span>}
        {doc.unit && <span>📌 {doc.unit}</span>}
        {doc.total_pages > 0 && <span>📄 {doc.total_pages} pages</span>}
        {doc.total_chunks > 0 && <span>🔷 {doc.total_chunks} chunks</span>}
        <span style={{ color: 'var(--text-muted)', fontSize: '.75rem' }}>{(doc.file_size / 1024).toFixed(0)} KB</span>
      </div>
      {doc.status === 'failed' && doc.error_message && (
        <div style={{ background: 'rgba(120,113,108,.08)', border: '1px solid rgba(120,113,108,.2)', borderRadius: 'var(--radius-sm)', padding: '.5rem .75rem', fontSize: '.75rem', color: '#a8a29e', marginBottom: '.75rem' }}>
          ⚠️ {doc.error_message.slice(0, 100)}
        </div>
      )}
      <div className="flex gap-2">
        {doc.status === 'failed' && (
          <button className="btn btn-ghost btn-sm" onClick={() => onReprocess(doc.id)}><RefreshCw size={12} /> Retry</button>
        )}
        <button className="btn btn-danger btn-sm" style={{ marginLeft: 'auto' }} onClick={() => onDelete(doc.id)}><Trash2 size={12} /> Delete</button>
      </div>
    </div>
  )
})

export default function DocumentsPage() {
  const { documents, setDocuments, removeDocument } = useDocumentStore()
  const { courses } = useCourseStore()
  const [showUpload, setShowUpload] = useState(false)
  const [filter, setFilter] = useState('all')
  const [view, setView] = useState('grid')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try { const r = await documentsApi.list(); setDocuments(r.data) }
    catch {} finally { setLoading(false) }
  }, [setDocuments])

  useEffect(() => { load() }, [load])

  const deleteDoc = useCallback(async (id) => {
    if (!confirm('Delete this document and all its chunks?')) return
    try { await documentsApi.delete(id); removeDocument(id) } catch {}
  }, [removeDocument])

  const reprocess = useCallback(async (id) => {
    try { await documentsApi.reprocess(id); load() } catch {}
  }, [load])

  const filtered = filter === 'all' ? documents : documents.filter(d => d.status === filter)
  const indexed = documents.filter(d => d.status === 'indexed')
  const processing = documents.filter(d => d.status === 'processing')

  return (
    <AnimatedPage>
      <div style={{ padding: '1.5rem', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
        {showUpload && <UploadModal courses={courses} onClose={() => setShowUpload(false)} onUploaded={load} />}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '.75rem', marginBottom: '1.5rem' }}>
          <StatTile icon={<FileText size={18} />} value={documents.length} label="Total" />
          <StatTile icon={<CheckCircle size={18} />} value={indexed.length} label="Indexed" color="var(--emerald)" />
          <StatTile icon={<Clock size={18} />} value={processing.length} label="Processing" color="var(--amber)" />
        </div>

        <div className="flex justify-between items-center" style={{ marginBottom: '1rem', gap: '.5rem', flexWrap: 'wrap' }}>
          <SegmentedControl options={FILTER_OPTIONS} value={filter} onChange={setFilter} />
          <div className="flex gap-2">
            <button className={clsx('btn btn-ghost btn-icon', view === 'list' && 'glass')} onClick={() => setView(v => v === 'grid' ? 'list' : 'grid')}>
              {view === 'grid' ? <List size={15} /> : <Grid size={15} />}
            </button>
            <button className="btn btn-primary" onClick={() => setShowUpload(true)}><Upload size={15} /> Upload</button>
          </div>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
            {[1, 2, 3].map(i => <DocumentCardSkeleton key={i} />)}
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-secondary)' }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
            <h3 style={{ fontWeight: 600, marginBottom: '.5rem' }}>No documents yet</h3>
            <p>Upload your lecture notes, PDFs, or textbooks to get started.</p>
            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => setShowUpload(true)}><Upload size={15} /> Upload First Document</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: view === 'list' ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: view === 'list' ? '.5rem' : '1rem' }}>
            {filtered.map(doc => <DocumentCard key={doc.id} doc={doc} onDelete={deleteDoc} onReprocess={reprocess} />)}
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}

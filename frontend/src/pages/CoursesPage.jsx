import { useState, useEffect, useCallback, memo } from 'react'
import { Plus, Trash2, ChevronRight } from 'lucide-react'
import { coursesApi } from '../api'
import { useCourseStore } from '../store'
import { useNavigate } from 'react-router-dom'
import Modal from '../components/shared/Modal'
import BentoCard from '../components/shared/BentoCard'
import AnimatedPage from '../components/shared/AnimatedPage'
import { CourseCardSkeleton } from '../components/shared/Skeleton'
import { useToast } from '../components/shared/Toast'

const COLORS = ['#d4d4d4', '#a3a3a3', '#878787', '#6b6b6b', '#525252', '#404040', '#333333', '#262626']
const ICONS = ['📚', '🔬', '💻', '📐', '🧬', '⚗️', '📊', '🎓', '🔭', '🧮', '📝', '🏛️']

function CreateModal({ onClose, onCreate }) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState({ name: '', code: '', description: '', semester: '', year: '', department: '', professor: '', color: COLORS[0], icon: ICONS[0] })
  const [loading, setLoading] = useState(false)

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    try { const r = await coursesApi.create(form); onCreate(r.data); onClose() }
    catch {} finally { setLoading(false) }
  }

  return (
    <Modal open title="📚 Create Course" onClose={onClose} maxWidth={500}>
      <div className="flex items-center gap-2" style={{ marginBottom: '1.25rem' }}>
        {[1, 2].map(s => (
          <div key={s} className="flex items-center gap-2">
            <div style={{
              width: 28, height: 28, borderRadius: '50%',
              background: step >= s ? 'var(--grad-brand)' : 'var(--bg-elevated)',
              border: step >= s ? 'none' : '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '.75rem', fontWeight: 700, color: step >= s ? '#0a0a0a' : 'var(--text-muted)',
            }}>{s}</div>
            {s < 2 && <div style={{ width: 40, height: 2, background: step > s ? 'var(--accent)' : 'var(--border)', borderRadius: 2 }} />}
          </div>
        ))}
      </div>

      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: '.75rem' }}>
        {step === 1 && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '.75rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Course Name *</label>
                <input className="input" placeholder="Data Structures & Algorithms" value={form.name} onChange={set('name')} required />
              </div>
              <div>
                <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Code</label>
                <input className="input" placeholder="CS301" value={form.code} onChange={set('code')} />
              </div>
            </div>
            <div>
              <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Description</label>
              <textarea className="input" placeholder="Course description..." value={form.description} onChange={set('description')} rows={2} style={{ resize: 'vertical' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.75rem' }}>
              <div>
                <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Semester</label>
                <input className="input" placeholder="Fall 2025" value={form.semester} onChange={set('semester')} />
              </div>
              <div>
                <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.3rem' }}>Professor</label>
                <input className="input" placeholder="Dr. Smith" value={form.professor} onChange={set('professor')} />
              </div>
            </div>
            <button type="button" className="btn btn-primary w-full" style={{ justifyContent: 'center', marginTop: '.5rem' }} onClick={() => setStep(2)}>
              Next: Customize <ChevronRight size={14} />
            </button>
          </>
        )}
        {step === 2 && (
          <>
            <div>
              <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.4rem' }}>Color</label>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                {COLORS.map(c => (
                  <button key={c} type="button" onClick={() => setForm(f => ({ ...f, color: c }))} style={{
                    width: 28, height: 28, borderRadius: '50%', background: c,
                    border: form.color === c ? '2px solid #fff' : '2px solid transparent',
                    boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none',
                    cursor: 'pointer', transition: 'all .15s',
                  }} />
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: '.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '.4rem' }}>Icon</label>
              <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
                {ICONS.map(ic => (
                  <button key={ic} type="button" onClick={() => setForm(f => ({ ...f, icon: ic }))} style={{
                    width: 36, height: 36, borderRadius: 8,
                    border: form.icon === ic ? '2px solid var(--accent-light)' : '1px solid var(--border)',
                    background: form.icon === ic ? 'rgba(255,255,255,.08)' : 'var(--bg-elevated)',
                    cursor: 'pointer', fontSize: '1rem', transition: 'all .15s',
                  }}>{ic}</button>
                ))}
              </div>
            </div>
            <div className="flex gap-3" style={{ marginTop: '.5rem' }}>
              <button type="button" className="btn btn-ghost" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setStep(1)}>Back</button>
              <button type="submit" className="btn btn-primary" style={{ flex: 2, justifyContent: 'center' }} disabled={loading}>
                {loading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Creating...</> : 'Create Course'}
              </button>
            </div>
          </>
        )}
      </form>
    </Modal>
  )
}

const CourseCard = memo(function CourseCard({ course, onChat, onDelete }) {
  return (
    <BentoCard color={course.color} onClick={() => onChat(course)}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: course.color, borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0' }} />
      <div className="flex gap-3 items-center" style={{ marginBottom: '.75rem' }}>
        <div style={{
          width: 44, height: 44, borderRadius: 12,
          background: course.color + '20', border: `1px solid ${course.color}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.4rem', boxShadow: `0 0 20px ${course.color}20`,
        }}>{course.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: '.9375rem' }} className="truncate">{course.name}</div>
          {course.code && <div style={{ fontSize: '.75rem', color: 'var(--text-muted)' }}>{course.code}</div>}
        </div>
      </div>
      <div style={{ fontSize: '.7875rem', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '.25rem', marginBottom: '.75rem' }}>
        {course.professor && <span>👨‍🏫 {course.professor}</span>}
        {course.semester && <span>📅 {course.semester}</span>}
      </div>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '.75rem', fontSize: '.75rem', color: 'var(--text-muted)' }}>
        <span>📄 {course.doc_count || 0}</span>
        <span>💬 {course.chat_count || 0}</span>
      </div>
      <div className="flex gap-2">
        <button className="btn btn-ghost btn-sm" onClick={e => { e.stopPropagation(); onChat(course) }} style={{ flex: 1, justifyContent: 'center' }}>
          Chat <ChevronRight size={12} />
        </button>
        <button className="btn btn-danger btn-sm btn-icon" onClick={e => { e.stopPropagation(); onDelete(course.id) }}>
          <Trash2 size={13} />
        </button>
      </div>
    </BentoCard>
  )
})

export default function CoursesPage() {
  const { courses, setCourses, addCourse, setActiveCourse } = useCourseStore()
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    coursesApi.list().then(r => { setCourses(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [setCourses])

  const deleteCourse = useCallback(async (id) => {
    if (!confirm('Archive this course?')) return
    try { await coursesApi.delete(id); setCourses(courses.filter(c => c.id !== id)) } catch {}
  }, [courses, setCourses])

  const handleChat = useCallback((course) => {
    setActiveCourse(course)
    navigate('/chat')
  }, [setActiveCourse, navigate])

  return (
    <AnimatedPage>
      <div style={{ padding: '1.5rem', maxWidth: 1000, margin: '0 auto', width: '100%' }}>
        {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={addCourse} />}

        <div className="flex justify-between items-center" style={{ marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: '1.625rem', fontWeight: 800 }}>📖 My Courses</h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '.875rem', marginTop: '.25rem' }}>{courses.length} courses</p>
          </div>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> New Course</button>
        </div>

        {loading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {[1, 2, 3].map(i => <CourseCardSkeleton key={i} />)}
          </div>
        ) : courses.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: 'var(--text-secondary)', maxWidth: 400, margin: '0 auto' }}>
            <BentoCard style={{ padding: '2.5rem' }}>
              <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📚</div>
              <h3 style={{ fontWeight: 600, marginBottom: '.5rem' }}>No courses yet</h3>
              <p style={{ fontSize: '.875rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>Create a course to organize your documents and chat history by subject.</p>
              <button className="btn btn-primary" onClick={() => setShowCreate(true)}><Plus size={15} /> Create First Course</button>
            </BentoCard>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
            {courses.map(course => <CourseCard key={course.id} course={course} onChat={handleChat} onDelete={deleteCourse} />)}
          </div>
        )}
      </div>
    </AnimatedPage>
  )
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// ── Auth Store ──────────────────────────────────────────
export const useAuthStore = create(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
    }),
    { name: 'rag-auth' }
  )
)

// ── Course Store ────────────────────────────────────────
export const useCourseStore = create((set) => ({
  courses: [],
  activeCourse: null,
  setCourses: (courses) => set({ courses }),
  setActiveCourse: (course) => set({ activeCourse: course }),
  addCourse: (course) => set((s) => ({ courses: [course, ...s.courses] })),
}))

// ── Chat Store ──────────────────────────────────────────
export const useChatStore = create((set) => ({
  conversations: [],
  activeConversation: null,
  messages: [],
  loading: false,
  mode: 'normal',
  outputFormat: 'text',
  setConversations: (conversations) => set({ conversations }),
  setActiveConversation: (conv) => set({ activeConversation: conv }),
  setMessages: (messages) => set({ messages }),
  addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg] })),
  setLoading: (loading) => set({ loading }),
  setMode: (mode) => set({ mode }),
  setOutputFormat: (outputFormat) => set({ outputFormat }),
}))

// ── Document Store ──────────────────────────────────────
export const useDocumentStore = create((set) => ({
  documents: [],
  uploading: false,
  setDocuments: (documents) => set({ documents }),
  addDocument: (doc) => set((s) => ({ documents: [doc, ...s.documents] })),
  updateDocument: (id, updates) =>
    set((s) => ({ documents: s.documents.map((d) => (d.id === id ? { ...d, ...updates } : d)) })),
  removeDocument: (id) => set((s) => ({ documents: s.documents.filter((d) => d.id !== id) })),
  setUploading: (uploading) => set({ uploading }),
}))

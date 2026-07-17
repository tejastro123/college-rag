import axios from 'axios'
import { useAuthStore } from '../store'

const api = axios.create({ baseURL: '/api/v1', timeout: 60000 })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout()
      window.location.href = '/login'
    }
    return Promise.reject(error)
  }
)

// Auth
export const authApi = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
}

// Documents
export const documentsApi = {
  upload: (formData) => api.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 }),
  list: (params) => api.get('/documents/', { params }),
  get: (id) => api.get(`/documents/${id}`),
  delete: (id) => api.delete(`/documents/${id}`),
  reprocess: (id) => api.post(`/documents/${id}/reprocess`),
}

// Chat
export const chatApi = {
  send: (data) => api.post('/chat/', data),
  conversations: (params) => api.get('/chat/conversations', { params }),
  messages: (convId) => api.get(`/chat/conversations/${convId}/messages`),
  deleteConversation: (id) => api.delete(`/chat/conversations/${id}`),
  bookmarkConversation: (id) => api.post(`/chat/conversations/${id}/bookmark`),
  messageFeedback: (id, rating) => api.post(`/chat/messages/${id}/feedback`, { rating }),
}

// Courses
export const coursesApi = {
  list: () => api.get('/courses/'),
  create: (data) => api.post('/courses/', data),
  get: (id) => api.get(`/courses/${id}`),
  delete: (id) => api.delete(`/courses/${id}`),
}

// Study Tools
export const studyApi = {
  flashcards: (data) => api.post('/study/flashcards', data),
  quiz: (data) => api.post('/study/quiz', data),
  summary: (data) => api.post('/study/summary', data),
  formulaSheet: (data) => api.post('/study/formula-sheet', data),
}

// System
export const systemApi = {
  health: () => api.get('/system/health'),
  stats: () => api.get('/system/stats'),
}

export default api

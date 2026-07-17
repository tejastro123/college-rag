import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store'
import AppLayout from './components/AppLayout'
import { ToastProvider } from './components/shared/Toast'
import { Skeleton } from './components/shared/Skeleton'

const ChatLayout = lazy(() => import('./components/ChatLayout'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const RegisterPage = lazy(() => import('./pages/RegisterPage'))
const DocumentsPage = lazy(() => import('./pages/DocumentsPage'))
const CoursesPage = lazy(() => import('./pages/CoursesPage'))
const StudyToolsPage = lazy(() => import('./pages/StudyToolsPage'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const OrganizationSettings = lazy(() => import('./pages/OrganizationSettings'))
const BillingPage = lazy(() => import('./pages/BillingPage'))
const WebSearchPage = lazy(() => import('./pages/WebSearchPage'))

function PageFallback() {
  return (
    <div style={{ padding: '2rem', maxWidth: 600, margin: '0 auto' }}>
      <Skeleton height={32} width="40%" style={{ marginBottom: '1rem' }} />
      <Skeleton height={120} style={{ marginBottom: '.75rem' }} />
      <Skeleton height={80} style={{ marginBottom: '.75rem' }} />
      <Skeleton height={200} />
    </div>
  )
}

function PrivateRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  if (!token) return <Navigate to="/login" replace />
  if (user?.role === 'admin') return <Navigate to="/admin" replace />
  return children
}

function AdminRoute({ children }) {
  const token = useAuthStore((s) => s.token)
  const user = useAuthStore((s) => s.user)
  if (!token) return <Navigate to="/login" replace />
  if (user?.role !== 'admin') return <Navigate to="/chat" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
            <Route path="/chat" element={<PrivateRoute><ChatLayout /></PrivateRoute>} />
            <Route path="/" element={<PrivateRoute><AppLayout /></PrivateRoute>}>
              <Route index element={<Navigate to="/chat" replace />} />
              <Route path="documents" element={<DocumentsPage />} />
              <Route path="courses" element={<CoursesPage />} />
              <Route path="study" element={<StudyToolsPage />} />
              <Route path="org/:orgId" element={<OrganizationSettings />} />
              <Route path="billing" element={<BillingPage />} />
              <Route path="web-search" element={<WebSearchPage />} />
            </Route>
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  )
}

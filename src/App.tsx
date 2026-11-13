import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireAdmin } from '@/components/RequireAdmin'
import { Loading } from '@/components/ui/page'

const AdminLogin = lazy(() => import('@/pages/AdminLogin'))
const AdminSetup = lazy(() => import('@/pages/AdminSetup'))
const ResetPassword = lazy(() => import('@/pages/ResetPassword'))
const AdminDashboard = lazy(() => import('@/pages/AdminDashboard'))
const AdminUserManagement = lazy(() => import('@/pages/AdminUserManagement'))
const AdminEvents = lazy(() => import('@/pages/AdminEvents'))
const AdminCashouts = lazy(() => import('@/pages/AdminCashouts'))
const AdminVenues = lazy(() => import('@/pages/AdminVenues'))
const AnalyticsDashboard = lazy(() => import('@/pages/AnalyticsDashboard'))
const AdminNotifications = lazy(() => import('@/pages/AdminNotifications'))
const AuditLog = lazy(() => import('@/pages/AuditLog'))
const AdminManagement = lazy(() => import('@/pages/AdminManagement'))
const AdminProfile = lazy(() => import('@/pages/AdminProfile'))

/** Old style /admin/... links still work by dropping the prefix. */
function LegacyAdminRedirect() {
  const { pathname, search, hash } = useLocation()
  const rest = pathname.replace(/^\/admin/, '') || '/'
  return <Navigate to={`${rest}${search}${hash}`} replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Loading />}>
        <Routes>
          <Route path="/login" element={<AdminLogin />} />
          <Route path="/setup" element={<AdminSetup />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="/admin/*" element={<LegacyAdminRedirect />} />
          <Route path="/admin" element={<LegacyAdminRedirect />} />
          <Route element={<RequireAdmin />}>
            <Route path="/" element={<AdminDashboard />} />
            <Route path="/users" element={<AdminUserManagement />} />
            <Route path="/events" element={<AdminEvents />} />
            <Route path="/cashouts" element={<AdminCashouts />} />
            <Route path="/venues" element={<AdminVenues />} />
            <Route path="/analytics" element={<AnalyticsDashboard />} />
            <Route path="/notifications" element={<AdminNotifications />} />
            <Route path="/audit" element={<AuditLog />} />
            <Route path="/admins" element={<AdminManagement />} />
            <Route path="/profile" element={<AdminProfile />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

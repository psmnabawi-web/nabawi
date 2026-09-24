import { lazy, Suspense, type ReactNode } from 'react'
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppLayout } from './components/layout/AppLayout'
import { ProtectedRoute } from './components/layout/Guards'
import { PageLoader } from './components/ui'
import { AuthProvider } from './hooks/useAuth'
import { StoreScopeProvider } from './hooks/useStoreScope'
import { ToastProvider } from './hooks/useToast'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'

const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const TrendIntelligencePage = lazy(() => import('./pages/TrendIntelligencePage'))
const ContentGeneratorPage = lazy(() => import('./pages/ContentGeneratorPage'))
const VideoStudioPage = lazy(() => import('./pages/VideoStudioPage'))
const CampaignCalendarPage = lazy(() => import('./pages/CampaignCalendarPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))

const page = (node: ReactNode) => <Suspense fallback={<PageLoader />}>{node}</Suspense>

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: (
      <ProtectedRoute>
        <StoreScopeProvider>
          <AppLayout />
        </StoreScopeProvider>
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: page(<DashboardPage />) },
      { path: 'trends', element: page(<TrendIntelligencePage />) },
      { path: 'content', element: page(<ContentGeneratorPage />) },
      { path: 'video', element: page(<VideoStudioPage />) },
      { path: 'calendar', element: page(<CampaignCalendarPage />) },
      { path: 'analytics', element: page(<AnalyticsPage />) },
      { path: 'settings', element: page(<SettingsPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
])

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  )
}

import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useStore } from './store/useStore'
import { authApi } from './lib/api'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import VMsPage from './pages/VMsPage'
import SettingsPage from './pages/SettingsPage'
import UsersPage from './pages/UsersPage'

function AppInit({ children }: { children: React.ReactNode }) {
  const { theme, setCurrentUser, setAuthConfig, token } = useStore()

  // Apply theme on mount
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [theme])

  // Load auth config — onSuccess was removed in TanStack Query v5, use useEffect instead
  const { data: authConfigData } = useQuery({
    queryKey: ['auth-config'],
    queryFn: authApi.config,
  })
  useEffect(() => {
    if (authConfigData) setAuthConfig(authConfigData)
  }, [authConfigData]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load current user if token exists
  const { data: meData, isError: meError } = useQuery({
    queryKey: ['me', token],
    queryFn: authApi.me,
    enabled: !!token,
    retry: false,
  })
  useEffect(() => {
    if (meData) setCurrentUser(meData)
  }, [meData]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (meError) setCurrentUser(null)
  }, [meError]) // eslint-disable-line react-hooks/exhaustive-deps

  return <>{children}</>
}

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { token, authConfig } = useStore()

  // If auth is disabled, allow access
  if (authConfig && !authConfig.user_management) return <>{children}</>

  // If auth is enabled and no token, redirect to login
  if (!token) return <Navigate to="/login" replace />

  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInit>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/*"
            element={
              <PrivateRoute>
                <Layout />
              </PrivateRoute>
            }
          />
        </Routes>
      </AppInit>
    </BrowserRouter>
  )
}

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, VMTab, AuthConfig } from '../types'

export interface Toast {
  id: string
  message: string
  type: 'success' | 'error' | 'info'
  onClick?: () => void
}

interface AppStore {
  // Auth
  token: string | null
  currentUser: User | null
  authConfig: AuthConfig | null
  setToken: (token: string | null) => void
  setCurrentUser: (user: User | null) => void
  setAuthConfig: (config: AuthConfig) => void
  logout: () => void

  // Theme
  theme: 'light' | 'dark'
  toggleTheme: () => void

  // Open VM tabs (tabbed console)
  openTabs: VMTab[]
  activeTab: string  // 'dashboard' | 'settings' | 'users' | `vm-${id}`
  openVMTab: (tab: VMTab) => void
  closeVMTab: (vmId: number) => void
  setActiveTab: (tab: string) => void
  reorderTabs: (fromId: number, toId: number) => void
  updateTabStatus: (vmId: number, status: string) => void
  updateTabGroupColor: (vmId: number, color: string | undefined) => void

  // Toasts
  toasts: Toast[]
  addToast: (message: string, type?: Toast['type'], onClick?: () => void) => void
  removeToast: (id: string) => void

  // Active upload (global progress toast)
  activeUpload: { filename: string; progress: number; abort: () => void } | null
  setActiveUpload: (upload: { filename: string; progress: number; abort: () => void } | null) => void
  updateUploadProgress: (progress: number) => void

  // Server connection
  serverOnline: boolean
  setServerOnline: (online: boolean) => void
}

export const useStore = create<AppStore>()(
  persist(
    (set, get) => ({
      token: null,
      currentUser: null,
      authConfig: null,

      setToken: (token) => {
        set({ token })
        if (token) {
          localStorage.setItem('86web_token', token)
        } else {
          localStorage.removeItem('86web_token')
        }
      },

      setCurrentUser: (user) => set({ currentUser: user }),
      setAuthConfig: (config) => set({ authConfig: config }),

      logout: () => {
        localStorage.removeItem('86web_token')
        set({ token: null, currentUser: null, openTabs: [], activeTab: 'dashboard' })
      },

      theme: 'dark',
      toggleTheme: () => {
        const next = get().theme === 'dark' ? 'light' : 'dark'
        set({ theme: next })
        if (next === 'dark') {
          document.documentElement.classList.add('dark')
        } else {
          document.documentElement.classList.remove('dark')
        }
      },

      openTabs: [],
      activeTab: 'dashboard',

      openVMTab: (tab) => {
        const existing = get().openTabs.find(t => t.vmId === tab.vmId)
        if (!existing) {
          set(s => ({ openTabs: [...s.openTabs, tab] }))
        }
        set({ activeTab: `vm-${tab.vmUuid}` })
      },

      closeVMTab: (vmId) => {
        const tabs = get().openTabs.filter(t => t.vmId !== vmId)
        set({
          openTabs: tabs,
          activeTab: tabs.length > 0 ? `vm-${tabs[tabs.length - 1].vmUuid}` : 'dashboard',
        })
      },

      setActiveTab: (tab) => set({ activeTab: tab }),

      reorderTabs: (fromId, toId) => {
        const tabs = [...get().openTabs]
        const from = tabs.findIndex(t => t.vmId === fromId)
        const to   = tabs.findIndex(t => t.vmId === toId)
        if (from === -1 || to === -1 || from === to) return
        const [moved] = tabs.splice(from, 1)
        tabs.splice(to, 0, moved)
        set({ openTabs: tabs })
      },

      updateTabStatus: (vmId, status) => {
        set(s => ({
          openTabs: s.openTabs.map(t => t.vmId === vmId ? { ...t, status } : t),
        }))
      },

      updateTabGroupColor: (vmId, color) => {
        set(s => ({
          openTabs: s.openTabs.map(t => t.vmId === vmId ? { ...t, group_color: color } : t),
        }))
      },

      toasts: [],
      addToast: (message, type = 'success', onClick) => {
        const id = Math.random().toString(36).slice(2)
        set(s => ({ toasts: [...s.toasts, { id, message, type, onClick }] }))
        setTimeout(() => get().removeToast(id), 4000)
      },
      removeToast: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),

      activeUpload: null,
      setActiveUpload: (upload) => set({ activeUpload: upload }),
      updateUploadProgress: (progress) => set(s => ({
        activeUpload: s.activeUpload ? { ...s.activeUpload, progress } : null,
      })),

      serverOnline: true,
      setServerOnline: (online) => set({ serverOnline: online }),
    }),
    {
      name: '86web-store',
      partialize: (s) => ({ theme: s.theme, token: s.token, openTabs: s.openTabs, activeTab: s.activeTab }),
    }
  )
)

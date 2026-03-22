import { VM, VMConfig, VMGroup, User, SystemStats, UserStats, VersionInfo, HardwareLists, AuthConfig } from '../types'

const BASE = '/api'

function getToken(): string | null {
  return localStorage.getItem('86web_token')
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken()
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(opts.headers as Record<string, string> || {}),
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...opts, headers })

  if (res.status === 401) {
    // Only force-redirect on session expiry (had a token). A 401 with no token
    // means wrong credentials on the login form — let the caller handle it.
    if (getToken()) {
      localStorage.removeItem('86web_token')
      window.location.href = '/login'
    }
    const err = await res.json().catch(() => ({ detail: 'Invalid credentials' }))
    throw new Error(err.detail || 'Invalid credentials')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const detail = err.detail
    const msg = Array.isArray(detail)
      ? detail.map((e: any) => `${(e.loc ?? []).slice(1).join('.')}: ${e.msg}`).join('; ')
      : typeof detail === 'string' ? detail : `HTTP ${res.status}`
    throw new Error(msg)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  login: (username: string, password: string) =>
    request<{ access_token: string; token_type: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),

  me: () => request<User>('/auth/me'),

  config: () => request<AuthConfig>('/auth/config'),
}

// ─── VMs ──────────────────────────────────────────────────────────────────────

export const vmApi = {
  list: (groupId?: number) =>
    request<VM[]>(`/vms${groupId !== undefined ? `?group_id=${groupId}` : ''}`),

  get: (id: number) => request<VM>(`/vms/${id}`),

  create: (data: { name: string; description?: string; group_id?: number; config: VMConfig; shared_with_user_ids?: number[] }) =>
    request<VM>('/vms', { method: 'POST', body: JSON.stringify(data) }),

  update: (id: number, data: { name?: string; description?: string; group_id?: number | null; config?: VMConfig; shared_with_user_ids?: number[] }) =>
    request<VM>(`/vms/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  delete: (id: number) => request<void>(`/vms/${id}`, { method: 'DELETE' }),

  start: (id: number) => request<VM>(`/vms/${id}/start`, { method: 'POST' }),
  stop: (id: number) => request<VM>(`/vms/${id}/stop`, { method: 'POST' }),
  reset: (id: number) => request<{ status: string }>(`/vms/${id}/reset`, { method: 'POST' }),
  pause: (id: number) => request<{ status: string }>(`/vms/${id}/pause`, { method: 'POST' }),
  sendKey: (id: number, key: string) => request<{ status: string }>(`/vms/${id}/send-key`, { method: 'POST', body: JSON.stringify({ key }) }),
  status: (id: number) => request<{ id: number; status: string; vnc_port?: number; ws_port?: number; uptime?: number; locked_by_user_id?: number | null; locked_by_username?: string | null }>(`/vms/${id}/status`),

  getUnregistered: () => 
    request<{ unregistered: { folder_name: string; machine: string }[] }>('/vms/unregistered'),
  
  importVM: (data: { folder_name: string; vm_name: string; description?: string; group_id: number | null }) => 
    request<{ vm: VM }>('/vms/import', { 
      method: 'POST', 
      body: JSON.stringify(data) 
    }),

  mountDrive: (id: number, driveKey: string, path: string) =>
    request<{ status: string; drive_key: string; path: string }>(
      `/vms/${id}/drives/${driveKey}/mount`,
      { method: 'POST', body: JSON.stringify({ path }) },
    ),
  ejectDrive: (id: number, driveKey: string) =>
    request<{ status: string; drive_key: string }>(`/vms/${id}/drives/${driveKey}/eject`, { method: 'POST' }),
  createBlankFloppy: (id: number, name: string, sizeKb: number) =>
    request<{ name: string; size: number; path: string }>(
      `/vms/${id}/media/blank-floppy`,
      { method: 'POST', body: JSON.stringify({ name, size_kb: sizeKb }) },
    ),

  // Groups
  listGroups: () => request<VMGroup[]>('/vms/groups'),
  createGroup: (data: { name: string; description?: string; color: string; network_enabled?: boolean; shared_with_user_ids?: number[] }) =>
    request<VMGroup>('/vms/groups', { method: 'POST', body: JSON.stringify(data) }),
  updateGroup: (id: number, data: Partial<{ name: string; description: string; color: string; network_enabled: boolean; shared_with_user_ids: number[] }>) =>
    request<VMGroup>(`/vms/groups/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteGroup: (id: number) => request<void>(`/vms/groups/${id}`, { method: 'DELETE' }),
}

// ─── Users ────────────────────────────────────────────────────────────────────

export const userApi = {
  list: () => request<User[]>('/users'),
  get: (id: number) => request<User>(`/users/${id}`),
  create: (data: Partial<User> & { password: string }) =>
    request<User>('/users', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: number, data: Partial<User> & { password?: string }) =>
    request<User>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: number) => request<void>(`/users/${id}`, { method: 'DELETE' }),
}

// ─── System ───────────────────────────────────────────────────────────────────

export const systemApi = {
  stats: () => request<SystemStats>('/system/stats'),
  userStats: () => request<UserStats>('/system/user-stats'),
  version: () => request<VersionInfo>('/system/version'),
  triggerUpdate: () => request<Record<string, string>>('/system/update-86box', { method: 'POST' }),
  hardware: () => request<HardwareLists>('/system/hardware'),
  machineCpuMap: () => request<Record<string, string>>('/system/hardware/machine-cpu-map'),
voodooTypes: () => request<{ id: string; name: string }[]>('/system/hardware/voodoo-types'),
  refreshHardware: () => request<{ status: string; machines: number }>('/system/hardware/refresh', { method: 'POST' }),
  allUsersStats: () => request<{ id: number; username: string; vm_count: number; running_vms: number; disk_usage_bytes: number; max_vms: number; max_storage_gb: number }[]>('/system/all-users-stats'),
  recommendedVmLimit: () => request<{ recommended: number; current_limit: number; cpu_cores: number; ram_gb: number; notes: string }>('/system/recommended-vm-limit'),
  config: () => request<Record<string, Record<string, string>>>('/system/config'),
  getAppSettings: () => request<{ enforce_quotas: boolean; active_vm_limit: number | null }>('/system/app-settings'),
  updateAppSettings: (s: { enforce_quotas: boolean; active_vm_limit: number | null }) => request<{ enforce_quotas: boolean; active_vm_limit: number | null }>('/system/app-settings', { method: 'PUT', body: JSON.stringify(s) }),
}

// ─── Shared media pool ────────────────────────────────────────────────────────

export const sharedMediaApi = {
  list: () => request<{ name: string; size: number; path: string }[]>('/media/'),

  upload: async (file: File): Promise<{ name: string; size: number; path: string }> => {
    const token = localStorage.getItem('86web_token')
    const form = new FormData()
    form.append('file', file)
    const res = await fetch('/api/media/', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || `HTTP ${res.status}`)
    }
    return res.json()
  },

  delete: (filename: string) =>
    request<void>(`/media/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
}

// ─── Media ────────────────────────────────────────────────────────────────────

export const mediaApi = {
  list: (vmId: number) =>
    request<{ name: string; size: number; path: string }[]>(`/vms/${vmId}/media`),

  upload: (vmId: number, file: File, onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<{ name: string; size: number }> => {
    return new Promise((resolve, reject) => {
      const token = localStorage.getItem('86web_token')
      const form = new FormData()
      form.append('file', file)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', `/api/vms/${vmId}/media`)
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          const detail = JSON.parse(xhr.responseText || '{}').detail || `HTTP ${xhr.status}`
          reject(new Error(detail))
        }
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))
      if (signal) signal.addEventListener('abort', () => xhr.abort())
      xhr.send(form)
    })
  },

  delete: (vmId: number, filename: string) =>
    request<void>(`/vms/${vmId}/media/${encodeURIComponent(filename)}`, { method: 'DELETE' }),
}

// ─── Image Library ────────────────────────────────────────────────────────────

export interface LibraryNode {
  name: string
  type: 'file' | 'directory'
  size?: number
  image_type?: 'floppy' | 'cdrom' | 'other'
  children?: LibraryNode[]
}

export interface VMImage {
  name: string
  size: number
  image_type: 'floppy' | 'cdrom' | 'other'
}

export const libraryApi = {
  tree: () => request<LibraryNode[]>('/library/'),

  imagesTree: () => request<LibraryNode[]>('/library/images/tree'),

  mkdirImages: (path: string) =>
    request<{ path: string }>('/library/images/mkdir', { method: 'POST', body: JSON.stringify({ path }) }),

  uploadImage: (file: File, path = '', onProgress?: (pct: number) => void, signal?: AbortSignal): Promise<VMImage> => {
    return new Promise((resolve, reject) => {
      const token = getToken()
      const form = new FormData()
      form.append('file', file)
      if (path) form.append('path', path)
      const xhr = new XMLHttpRequest()
      xhr.open('POST', '/api/library/images/upload')
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100))
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(JSON.parse(xhr.responseText))
        } else {
          const detail = JSON.parse(xhr.responseText || '{}').detail || `HTTP ${xhr.status}`
          reject(new Error(detail))
        }
      }
      xhr.onerror = () => reject(new Error('Network error'))
      xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'))
      if (signal) signal.addEventListener('abort', () => xhr.abort())
      xhr.send(form)
    })
  },

  deleteImage: (relPath: string) =>
    request<void>(
      `/library/images/${relPath.split('/').map(encodeURIComponent).join('/')}`,
      { method: 'DELETE' },
    ),

  moveImage: (src: string, dst: string) =>
    request<{ src: string; dst: string }>('/library/images/move', {
      method: 'POST',
      body: JSON.stringify({ src, dst }),
    }),
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
}

export function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function defaultConfig(): VMConfig {
  return {
    machine: 'ibmxt',
    cpu_family: '8088',
    cpu_speed: 0,           // 0-based index into family's CPU speed list
    cpu_use_dynarec: false,
    cpu_waitstates: 0,
    fpu_type: 'none',
    fpu_softfloat: false,
    mem_size: 640,
    pit_mode: 0,
    time_sync: 'local',
    gfxcard: 'cga',
    voodoo_enabled: false,
    voodoo_type: 'voodoo1',
    show_second_monitors: false,
    sndcard: 'adlib',
    midi_device: 'none',
    mpu401_standalone_enable: false,
    fm_driver: 'nuked',
    sound_is_float: false,
    net_card: 'none',
    net_type: 'slirp',
    net_host_dev: '',
    net_use_group: true,
    hdd_controller: 'ide_isa',
    ide_ter_enabled: false,
    ide_qua_enabled: false,
    scsi_card: 'none',
    fdc_card: 'none',
    hdd_01_enabled: false, hdd_01_bus: 'ide',  hdd_01_size_mb: 512, hdd_01_cylinders: null, hdd_01_heads: null, hdd_01_spt: null, hdd_01_speed: '1997_5400rpm', hdd_01_ide_channel: '0:0',
    hdd_02_enabled: false, hdd_02_bus: 'ide',  hdd_02_size_mb: 512, hdd_02_cylinders: null, hdd_02_heads: null, hdd_02_spt: null, hdd_02_speed: '1997_5400rpm', hdd_02_ide_channel: '0:1',
    hdd_03_enabled: false, hdd_03_bus: 'scsi', hdd_03_size_mb: 512, hdd_03_cylinders: null, hdd_03_heads: null, hdd_03_spt: null, hdd_03_speed: '1997_5400rpm', hdd_03_ide_channel: '1:0',
    hdd_04_enabled: false, hdd_04_bus: 'scsi', hdd_04_size_mb: 512, hdd_04_cylinders: null, hdd_04_heads: null, hdd_04_spt: null, hdd_04_speed: '1997_5400rpm', hdd_04_ide_channel: '1:1',
    hdd_05_enabled: false, hdd_05_bus: 'ide',  hdd_05_size_mb: 512, hdd_05_cylinders: null, hdd_05_heads: null, hdd_05_spt: null, hdd_05_speed: '1997_5400rpm', hdd_05_ide_channel: '2:0',
    hdd_06_enabled: false, hdd_06_bus: 'ide',  hdd_06_size_mb: 512, hdd_06_cylinders: null, hdd_06_heads: null, hdd_06_spt: null, hdd_06_speed: '1997_5400rpm', hdd_06_ide_channel: '2:1',
    hdd_07_enabled: false, hdd_07_bus: 'ide',  hdd_07_size_mb: 512, hdd_07_cylinders: null, hdd_07_heads: null, hdd_07_spt: null, hdd_07_speed: '1997_5400rpm', hdd_07_ide_channel: '3:0',
    hdd_08_enabled: false, hdd_08_bus: 'ide',  hdd_08_size_mb: 512, hdd_08_cylinders: null, hdd_08_heads: null, hdd_08_spt: null, hdd_08_speed: '1997_5400rpm', hdd_08_ide_channel: '3:1',
    fdd_01_type: '525_2dd', fdd_01_turbo: false, fdd_01_check_bpb: true, fdd_01_fn: '',
    fdd_02_type: 'none',    fdd_02_turbo: false, fdd_02_check_bpb: true, fdd_02_fn: '',
    fdd_03_type: 'none',    fdd_03_turbo: false, fdd_03_check_bpb: true, fdd_03_fn: '',
    fdd_04_type: 'none',    fdd_04_turbo: false, fdd_04_check_bpb: true, fdd_04_fn: '',
    cdrom_01_enabled: false, cdrom_01_bus: 'ide', cdrom_01_ide_channel: '1:0', cdrom_01_speed: 24, cdrom_01_drive_type: '', cdrom_01_fn: '',
    cdrom_02_enabled: false, cdrom_02_bus: 'ide', cdrom_02_ide_channel: '1:1', cdrom_02_speed: 24, cdrom_02_drive_type: '', cdrom_02_fn: '',
    cdrom_03_enabled: false, cdrom_03_bus: 'ide', cdrom_03_ide_channel: '2:0', cdrom_03_speed: 24, cdrom_03_drive_type: '', cdrom_03_fn: '',
    cdrom_04_enabled: false, cdrom_04_bus: 'ide', cdrom_04_ide_channel: '2:1', cdrom_04_speed: 24, cdrom_04_drive_type: '', cdrom_04_fn: '',
    com_1_enabled: true,  com_2_enabled: true,  com_3_enabled: false, com_4_enabled: false,
    lpt_1_enabled: true,  lpt_2_enabled: false, lpt_3_enabled: false,
    mouse_type: 'ps2',
    joystick_type: 'none',
    keyboard_type: 'keyboard_at',
    isartc_type: 'none',
    isamem_1_base: 0, isamem_1_size: 0,
    isamem_2_base: 0, isamem_2_size: 0,
    vnc_password: '',
    device_settings: {},
  }
}


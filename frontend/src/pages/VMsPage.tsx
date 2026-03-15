import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Play, Square, RotateCcw, Pencil, Trash2, Monitor, Loader2,
  FolderPlus, ChevronDown, ChevronRight, LayoutGrid, List,
  HardDrive, Eye, Network, Settings2, CloudOff,
} from 'lucide-react'
import { vmApi, systemApi, formatBytes } from '../lib/api'
import { VM, VMConfig, VMGroup } from '../types'
import { useStore } from '../store/useStore'
import VMConfigModal from '../components/VMConfigModal'
import ConfirmDialog from '../components/ConfirmDialog'
import { clsx } from 'clsx'

type ViewMode = 'grid' | 'list'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
    stopped: 'text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800',
    starting: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
    error: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  }
  return (
    <span className={clsx('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium', map[status] || map.stopped)}>
      <span className={`status-${status} w-1.5 h-1.5`} />
      {status}
    </span>
  )
}

function VMCard({ vm, onEdit, groupColor, cpuSpeeds, onStartError }: { vm: VM; onEdit: () => void; groupColor?: string; cpuSpeeds?: Record<string, string[]>; onStartError?: (msg: string) => void }) {
  const qc = useQueryClient()
  const { openVMTab, closeVMTab, addToast, serverOnline } = useStore()
  const isRunning = serverOnline && (vm.status === 'running' || vm.status === 'paused' || vm.status === 'starting')
  const [deleteConfirm, setDeleteConfirm] = useState(false)

  const startMut = useMutation({
    mutationFn: () => {
      if (!serverOnline) return Promise.reject(new Error('Server is unreachable. Please wait for the connection to be restored.'))
      return vmApi.start(vm.id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); qc.invalidateQueries({ queryKey: ['vm-groups'] }); addToast(`"${vm.name}" started`, 'success', () => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: 'running', group_color: vm.group_color })) },
    onError: (e: any) => onStartError ? onStartError(e.message || 'Failed to start') : addToast(e.message || 'Failed to start', 'error'),
  })
  const stopMut = useMutation({
    mutationFn: () => vmApi.stop(vm.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); qc.invalidateQueries({ queryKey: ['vm-groups'] }); addToast(`"${vm.name}" stopped`) },
    onError: (e: any) => addToast(e.message || 'Failed to stop', 'error'),
  })
  const resetMut = useMutation({
    mutationFn: () => vmApi.reset(vm.id),
    onSuccess: () => addToast(`"${vm.name}" reset`),
    onError: (e: any) => addToast(e.message || 'Reset failed', 'error'),
  })
  const deleteMut = useMutation({
    mutationFn: () => vmApi.delete(vm.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); closeVMTab(vm.id); addToast(`"${vm.name}" deleted`) },
    onError: (e: any) => addToast(e.message || 'Delete failed', 'error'),
  })

  useEffect(() => {
    if (startMut.isSuccess) startMut.reset()
  }, [vm.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const memoryDisplay = (() => {
    const kb = vm.config?.mem_size || 0
    return kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`
  })()

  const borderStyle = groupColor ? { borderTopColor: groupColor, borderTopWidth: 3 } : {}

  return (
    <div className="card-hover p-5 flex flex-col gap-4" style={borderStyle}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', isRunning ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-slate-100 dark:bg-slate-800')}>
          <Monitor className={clsx('w-4.5 h-4.5', isRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400" onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })}>{vm.name}</h3>
          {vm.description && <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5" title={vm.description}>{vm.description}</p>}
        </div>
        <StatusBadge status={vm.status} />
      </div>

      {/* Specs */}
      <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-700 dark:text-slate-300">Machine:</span>
          <span className="font-mono truncate">{vm.config?.machine || '—'}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-slate-700 dark:text-slate-300">RAM:</span>
          <span>{memoryDisplay}</span>
        </div>
        <div className="flex items-center gap-1.5 col-span-2">
          <span className="font-medium text-slate-700 dark:text-slate-300">CPU:</span>
          <span className="font-mono truncate">{vm.config?.cpu_family || '—'} @ {cpuSpeeds?.[vm.config?.cpu_family]?.[vm.config?.cpu_speed] ?? '—'} MHz</span>
        </div>
      </div>

      {/* Meta */}
      {vm.disk_usage_bytes > 0 && (
        <div className="flex items-center gap-1 text-xs text-slate-400">
          <HardDrive className="w-3 h-3" />
          {formatBytes(vm.disk_usage_bytes)}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-3 mt-auto">
        {isRunning ? (
          <>
            <button onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })} className="btn-primary flex-1 justify-center text-xs py-1.5">
              <Monitor className="w-3.5 h-3.5" />Console
            </button>
            <button onClick={() => stopMut.mutate()} disabled={stopMut.isPending} className="btn-secondary p-2" title="Stop">
              <Square className="w-3.5 h-3.5" />
            </button>
            <button onClick={onEdit} className="btn-ghost p-2" title="View settings (read-only while running)">
              <Eye className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            <button onClick={() => startMut.mutate()} disabled={startMut.isPending || startMut.isSuccess || !serverOnline} className="btn-success flex-1 justify-center text-xs py-1.5 disabled:opacity-60">
              <Play className="w-3.5 h-3.5" />
              {startMut.isPending || startMut.isSuccess ? 'Starting…' : 'Start'}
            </button>
            <button onClick={onEdit} disabled={!serverOnline} className="btn-ghost p-2 disabled:opacity-40 disabled:cursor-not-allowed" title={serverOnline ? 'Edit' : 'Server unavailable'}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setDeleteConfirm(true)}
              disabled={!serverOnline}
              className="btn-ghost p-2 text-red-400 hover:text-red-600 disabled:opacity-40 disabled:cursor-not-allowed"
              title={serverOnline ? 'Delete' : 'Server unavailable'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
      {deleteConfirm && (
        <ConfirmDialog
          title="Delete VM?"
          message={`This will permanently delete "${vm.name}" and all its data.`}
          confirmLabel="Delete"
          onConfirm={() => { setDeleteConfirm(false); deleteMut.mutate() }}
          onCancel={() => setDeleteConfirm(false)}
        />
      )}
    </div>
  )
}

function VMRow({ vm, onEdit, groupColor, onStartError }: { vm: VM; onEdit: () => void; groupColor?: string; onStartError?: (msg: string) => void }) {
  const qc = useQueryClient()
  const { openVMTab, closeVMTab, addToast, serverOnline } = useStore()
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const startMut = useMutation({
    mutationFn: () => {
      if (!serverOnline) return Promise.reject(new Error('Server is unreachable. Please wait for the connection to be restored.'))
      return vmApi.start(vm.id)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); qc.invalidateQueries({ queryKey: ['vm-groups'] }); addToast(`"${vm.name}" started`, 'success', () => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: 'running', group_color: vm.group_color })) },
    onError: (e: any) => onStartError ? onStartError(e.message || 'Failed to start') : addToast(e.message || 'Failed to start', 'error'),
  })
  const stopMut = useMutation({
    mutationFn: () => vmApi.stop(vm.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); qc.invalidateQueries({ queryKey: ['vm-groups'] }); addToast(`"${vm.name}" stopped`) },
    onError: (e: any) => addToast(e.message || 'Failed to stop', 'error'),
  })
  const deleteMut = useMutation({
    mutationFn: () => vmApi.delete(vm.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vms'] }); closeVMTab(vm.id); addToast(`"${vm.name}" deleted`) },
    onError: (e: any) => addToast(e.message || 'Failed to delete', 'error'),
  })
  const isRunning = serverOnline && (vm.status === 'running' || vm.status === 'paused' || vm.status === 'starting')

  useEffect(() => {
    if (startMut.isSuccess) startMut.reset()
  }, [vm.status]) // eslint-disable-line react-hooks/exhaustive-deps

  const rowStyle = groupColor ? { borderLeft: `3px solid ${groupColor}` } : {}

  return (
    <>
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" style={rowStyle}>
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', isRunning ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-slate-100 dark:bg-slate-800')}>
            <Monitor className={clsx('w-3.5 h-3.5', isRunning ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400')} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-900 dark:text-white truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400" onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })}>{vm.name}</p>
            {vm.description && <p className="text-xs text-slate-400 truncate" title={vm.description}>{vm.description}</p>}
          </div>
        </div>
      </td>
      <td className="px-5 py-3 w-28"><StatusBadge status={vm.status} /></td>
      <td className="px-5 py-3 w-44 text-xs text-slate-500 font-mono truncate max-w-[11rem]">{vm.config?.machine}</td>
      <td className="px-5 py-3 w-24 text-xs text-slate-500 font-mono">
        {(vm.config?.mem_size || 0) >= 1024 ? `${(vm.config.mem_size) / 1024} MB` : `${vm.config?.mem_size} KB`}
      </td>
      <td className="px-5 py-3 w-48">
        <div className="flex items-center gap-1.5">
          {isRunning ? (
            <>
              <button onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })} className="btn-primary text-xs py-1 px-2.5">
                <Monitor className="w-3 h-3" />Console
              </button>
              <button onClick={() => stopMut.mutate()} disabled={stopMut.isPending} className="btn-secondary text-xs py-1 px-2 disabled:opacity-60">
                {stopMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              </button>
              <button onClick={onEdit} className="btn-ghost p-1.5" title="View settings (read-only while running)">
                <Eye className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => startMut.mutate()} disabled={startMut.isPending || startMut.isSuccess || !serverOnline} className="btn-success text-xs py-1 px-2.5 disabled:opacity-60">
                {startMut.isPending || startMut.isSuccess ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
                {startMut.isPending || startMut.isSuccess ? 'Starting…' : 'Start'}
              </button>
              <button onClick={onEdit} disabled={!serverOnline} className="btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed" title={serverOnline ? 'Edit' : 'Server unavailable'}><Pencil className="w-3.5 h-3.5" /></button>
              <button onClick={() => setDeleteConfirm(true)} disabled={!serverOnline} className="btn-ghost p-1.5 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed" title={serverOnline ? undefined : 'Server unavailable'}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </td>
    </tr>
    {deleteConfirm && (
      <ConfirmDialog
        title="Delete VM?"
        message={`This will permanently delete "${vm.name}" and all its data.`}
        confirmLabel="Delete"
        onConfirm={() => { setDeleteConfirm(false); deleteMut.mutate() }}
        onCancel={() => setDeleteConfirm(false)}
      />
    )}
  </>
  )
}

// ─── Group Create/Edit Modal ───────────────────────────────────────────────────

function GroupModal({ onSave, onClose, initial, hasRunningVMs = false }: {
  onSave: (name: string, desc: string, color: string, networkEnabled: boolean) => void
  onClose: () => void
  initial?: { name: string; description?: string; color: string; network_enabled: boolean }
  hasRunningVMs?: boolean
}) {
  const [name, setName] = useState(initial?.name || '')
  const [desc, setDesc] = useState(initial?.description || '')
  const [color, setColor] = useState(initial?.color || '#6366f1')
  const [networkEnabled, setNetworkEnabled] = useState(initial?.network_enabled ?? false)
  const colors = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md card p-6 shadow-xl">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-5">
          {initial ? 'Edit Group' : 'Create Group'}
        </h2>
        <div className="space-y-4">
          <div>
            <label className="label mb-1.5 block">Group Name</label>
            <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Networking Lab" />
          </div>
          <div>
            <label className="label mb-1.5 block">Description</label>
            <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional" />
          </div>
          <div>
            <label className="label mb-2 block">Colour</label>
            <div className="flex gap-2 flex-wrap">
              {colors.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={clsx('w-7 h-7 rounded-full transition-all', color === c && 'ring-2 ring-offset-2 ring-slate-400 dark:ring-slate-600 scale-110')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Network className="w-4 h-4 text-slate-500" />
                  Local Networking
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  VMs in this group share a private Layer 2 network (Linux bridge + TAP).
                  Each VM must have a network card configured to participate.
                  {hasRunningVMs && (
                    <span className="block mt-1 text-amber-600 dark:text-amber-400 font-medium">
                      Stop all VMs in the group to change this setting.
                    </span>
                  )}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !hasRunningVMs && setNetworkEnabled(v => !v)}
                disabled={hasRunningVMs}
                className={clsx(
                  'flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none',
                  networkEnabled ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-600',
                  hasRunningVMs && 'opacity-50 cursor-not-allowed',
                )}
                title={hasRunningVMs ? 'Stop all VMs before changing networking' : undefined}
              >
                <span className={clsx('inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform', networkEnabled ? 'translate-x-6' : 'translate-x-1')} />
              </button>
            </div>
          </div>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => { onSave(name, desc, color, networkEnabled); onClose() }} disabled={!name} className="btn-primary">Save</button>
        </div>
      </div>
    </div>
  )
}

// ─── Collapsible Group Section ────────────────────────────────────────────────

function GroupSection({ group, vms, view, onEditVM, collapsed, onToggle, cpuSpeeds, onStartError, onEditGroup, onDeleteGroup }: {
  group: VMGroup
  vms: VM[]
  view: ViewMode
  onEditVM: (vm: VM) => void
  collapsed: boolean
  onToggle: () => void
  cpuSpeeds?: Record<string, string[]>
  onStartError?: (msg: string) => void
  onEditGroup: () => void
  onDeleteGroup: () => void
}) {
  const groupColor = group.color
  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <button onClick={onToggle} className="flex items-center gap-2 flex-1 text-left min-w-0">
          <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: groupColor }} />
          <span className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">{group.name}</span>
          <span className="text-xs text-slate-400 flex-shrink-0">{vms.length} VM{vms.length !== 1 ? 's' : ''}</span>
          {group.network_enabled && (
            <span className="flex-shrink-0 flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-1.5 py-0.5 rounded">
              <Network className="w-3 h-3" />Networked
            </span>
          )}
          <span className="ml-auto text-slate-400 flex-shrink-0">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>
        <button onClick={onEditGroup} className="btn-ghost p-1.5 flex-shrink-0" title="Edit group">
          <Settings2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDeleteGroup}
          className="btn-ghost p-1.5 text-red-400 hover:text-red-600 flex-shrink-0"
          title={group.has_running_vms ? 'Stop all VMs before deleting' : 'Delete group'}
          disabled={group.has_running_vms}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {!collapsed && (
        view === 'grid'
          ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {vms.map(vm => <VMCard key={vm.id} vm={vm} groupColor={groupColor} onEdit={() => onEditVM(vm)}cpuSpeeds={cpuSpeeds} onStartError={onStartError} />)}
            </div>
          : <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    {['VM', 'Status', 'Machine', 'RAM', 'Actions'].map(h => (
                      <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {vms.map(vm => <VMRow key={vm.id} vm={vm} groupColor={groupColor} onEdit={() => onEditVM(vm)} onStartError={onStartError} />)}
                </tbody>
              </table>
            </div>
      )}
    </div>
  )
}

// ─── VMsPage ──────────────────────────────────────────────────────────────────

export default function VMsPage() {
  const qc = useQueryClient()
  const { addToast, authConfig, serverOnline, openTabs, updateTabGroupColor } = useStore()
  const [view, setView] = useState<ViewMode>('grid')
  const [showCreateVM, setShowCreateVM] = useState(false)
  const [editVM, setEditVM] = useState<VM | null>(null)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [editGroup, setEditGroup] = useState<VMGroup | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [startError, setStartError] = useState<string | null>(null)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<VMGroup | null>(null)

  const { data: vms = [], isLoading } = useQuery({
    queryKey: ['vms'],
    queryFn: () => vmApi.list(),
    refetchInterval: 5000,
  })

  useEffect(() => {
    vms.forEach(vm => {
      const tab = openTabs.find(t => t.vmId === vm.id)
      if (tab && tab.group_color !== vm.group_color) {
        updateTabGroupColor(vm.id, vm.group_color)
      }
    })
  }, [vms]) // eslint-disable-line react-hooks/exhaustive-deps

  const { data: userStats } = useQuery({
    queryKey: ['user-stats'],
    queryFn: systemApi.userStats,
    refetchInterval: 10000,
    enabled: !!authConfig?.user_management,
  })

  const atVMQuota = authConfig?.user_management && userStats
    ? userStats.vm_count >= userStats.max_vms
    : false

  const { data: hw } = useQuery({
    queryKey: ['hardware'],
    queryFn: systemApi.hardware,
    staleTime: Infinity,
  })

  const { data: groups = [] as VMGroup[] } = useQuery({
    queryKey: ['vm-groups'],
    queryFn: vmApi.listGroups,
  })

  const createVMMut = useMutation({
    mutationFn: (data: { name: string; description?: string; group_id?: number; config: VMConfig }) => vmApi.create(data),
    onSuccess: (vm) => { qc.invalidateQueries({ queryKey: ['vms'] }); addToast(`VM "${vm.name}" created`) },
    onError: (e: any) => addToast(e.message || 'Failed to create VM', 'error'),
  })

  const updateVMMut = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; description?: string; group_id?: number | null; config?: VMConfig }) =>
      vmApi.update(id, data),
    onSuccess: (vm) => { qc.invalidateQueries({ queryKey: ['vms'] }); addToast(`VM "${vm.name}" updated`) },
    onError: (e: any) => addToast(e.message || 'Failed to update VM', 'error'),
  })

  const createGroupMut = useMutation({
    mutationFn: (data: { name: string; description?: string; color: string; network_enabled?: boolean }) => vmApi.createGroup(data),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['vm-groups'] }); addToast(`Group "${g.name}" created`) },
    onError: (e: any) => addToast(e.message || 'Failed to create group', 'error'),
  })

  const updateGroupMut = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; description?: string; color?: string; network_enabled?: boolean }) =>
      vmApi.updateGroup(id, data),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['vm-groups'] }); qc.invalidateQueries({ queryKey: ['vms'] }); addToast(`Group "${g.name}" updated`) },
    onError: (e: any) => addToast(e.message || 'Failed to update group', 'error'),
  })

  const deleteGroupMut = useMutation({
    mutationFn: (id: number) => vmApi.deleteGroup(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vm-groups'] }); qc.invalidateQueries({ queryKey: ['vms'] }); addToast('Group deleted') },
    onError: (e: any) => addToast(e.message || 'Failed to delete group', 'error'),
  })

  const filteredVMs = vms.filter(vm =>
    !searchQuery || vm.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Build group map (keyed by group_id so renames don't break the lookup)
  const grouped: Record<number, VM[]> = {}
  const ungrouped: VM[] = []
  filteredVMs.forEach(vm => {
    if (vm.group_id) {
      if (!grouped[vm.group_id]) grouped[vm.group_id] = []
      grouped[vm.group_id].push(vm)
    } else {
      ungrouped.push(vm)
    }
  })

  function toggleGroup(id: number) {
    setCollapsedGroups(s => ({ ...s, [id]: !s[id] }))
  }

  function UngroupedVMs() {
    if (ungrouped.length === 0) return null
    return view === 'grid'
      ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {ungrouped.map(vm => <VMCard key={vm.id} vm={vm} onEdit={() => setEditVM(vm)}cpuSpeeds={hw?.cpu_speeds} onStartError={setStartError} />)}
        </div>
      : <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                {['VM', 'Status', 'Machine', 'RAM', 'Actions'].map(h => (
                  <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ungrouped.map(vm => <VMRow key={vm.id} vm={vm} onEdit={() => setEditVM(vm)} onStartError={setStartError} />)}
            </tbody>
          </table>
        </div>
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Virtual Machines</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {vms.filter(v => v.status === 'running').length} running, {vms.length} total
            {authConfig?.user_management && userStats && (
              <span className={clsx('ml-2', atVMQuota ? 'text-red-500 dark:text-red-400' : 'text-slate-400 dark:text-slate-500')}>
                · {userStats.vm_count} / {userStats.max_vms} VM quota
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('grid')} className={clsx('btn-ghost p-2', view === 'grid' && 'text-blue-600 dark:text-blue-400')}>
            <LayoutGrid className="w-4 h-4" />
          </button>
          <button onClick={() => setView('list')} className={clsx('btn-ghost p-2', view === 'list' && 'text-blue-600 dark:text-blue-400')}>
            <List className="w-4 h-4" />
          </button>
          <button onClick={() => setShowCreateGroup(true)} disabled={!serverOnline} className="btn-secondary disabled:opacity-60" title={!serverOnline ? 'Server unavailable' : undefined}>
            <FolderPlus className="w-4 h-4" />New Group
          </button>
          <button
            disabled={!serverOnline}
            onClick={() => atVMQuota ? addToast(`VM quota reached (${userStats!.max_vms} VMs). Delete a VM to create a new one.`, 'error') : setShowCreateVM(true)}
            className={clsx('btn-primary', (atVMQuota || !serverOnline) && 'opacity-60')}
            title={!serverOnline ? 'Server unavailable' : atVMQuota ? `Quota reached: ${userStats?.max_vms} VMs` : undefined}
          >
            <Plus className="w-4 h-4" />New VM
          </button>
        </div>
      </div>

      {/* Offline banner */}
      {!serverOnline && (
        <div className="flex items-center gap-2.5 px-5 py-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-lg text-amber-700 dark:text-amber-400 text-sm">
          <CloudOff className="w-4 h-4 flex-shrink-0" />
          Server connection lost — VM status may be stale. Waiting to reconnect…
        </div>
      )}

      {/* Search */}
      <input
        className="input w-52"
        placeholder="Search VMs…"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
      />

      {/* VM listing */}
      {isLoading ? (
        <div className="flex justify-center py-16">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filteredVMs.length === 0 ? (
        <div className="card p-16 text-center">
          <Monitor className="w-12 h-12 text-slate-300 dark:text-slate-700 mx-auto mb-4" />
          {vms.length === 0 ? (
            <>
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">No Virtual Machines</h3>
              <p className="text-sm text-slate-400 dark:text-slate-500 mb-4">Create your first VM to get started</p>
              <button
                disabled={!serverOnline}
                onClick={() => atVMQuota ? addToast(`VM quota reached (${userStats!.max_vms} VMs). Delete a VM to create a new one.`, 'error') : setShowCreateVM(true)}
                className="btn-primary mx-auto disabled:opacity-60"
              >
                <Plus className="w-4 h-4" /> Create VM
              </button>
            </>
          ) : (
            <>
              <h3 className="font-semibold text-slate-700 dark:text-slate-300 mb-1">No results</h3>
              <p className="text-sm text-slate-400 dark:text-slate-500">No VMs match your search</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map(group => {
            const groupVMs = grouped[group.id] ?? []
            return (
              <GroupSection
                key={group.id}
                group={group}
                vms={groupVMs}
                view={view}
                onEditVM={setEditVM}
                collapsed={!!collapsedGroups[group.id]}
                onToggle={() => toggleGroup(group.id)}
                cpuSpeeds={hw?.cpu_speeds}
                onStartError={setStartError}
                onEditGroup={() => setEditGroup(group)}
                onDeleteGroup={() => {
                  if (group.has_running_vms) return
                  setDeleteGroupConfirm(group)
                }}
              />
            )
          })}
          {ungrouped.length > 0 && (
            <div>
              {Object.keys(grouped).length > 0 && (
                <p className="text-xs text-slate-400 mb-3 font-medium">Ungrouped</p>
              )}
              {UngroupedVMs()}
            </div>
          )}
        </div>
      )}

      {/* Create VM modal */}
      {showCreateVM && (
        <VMConfigModal
          title="Create Virtual Machine"
          groups={groups}
          onClose={() => setShowCreateVM(false)}
          onSave={async (name, desc, groupId, config) => {
            await createVMMut.mutateAsync({ name, description: desc, group_id: groupId ?? undefined, config })
          }}
        />
      )}

      {/* Edit VM modal */}
      {editVM && (
        <VMConfigModal
          vmId={editVM.id}
          title={`Edit — ${editVM.name}`}
          initialName={editVM.name}
          initialDesc={editVM.description}
          initialGroupId={editVM.group_id}
          initialConfig={editVM.config}
          groups={groups}
          readOnly={editVM.status === 'running' || editVM.status === 'paused' || editVM.status === 'starting'}
          onClose={() => setEditVM(null)}
          onSave={async (name, desc, groupId, config) => {
            await updateVMMut.mutateAsync({ id: editVM.id, name, description: desc, group_id: groupId, config })
          }}
        />
      )}

      {/* Create group modal */}
      {showCreateGroup && (
        <GroupModal
          onClose={() => setShowCreateGroup(false)}
          onSave={(name, desc, color, networkEnabled) =>
            createGroupMut.mutate({ name, description: desc, color, network_enabled: networkEnabled })
          }
        />
      )}

      {/* Edit group modal */}
      {editGroup && (
        <GroupModal
          initial={{ name: editGroup.name, description: editGroup.description, color: editGroup.color, network_enabled: editGroup.network_enabled }}
          hasRunningVMs={editGroup.has_running_vms}
          onClose={() => setEditGroup(null)}
          onSave={(name, desc, color, networkEnabled) =>
            updateGroupMut.mutate({ id: editGroup.id, name, description: desc, color, network_enabled: networkEnabled })
          }
        />
      )}

      {/* Start error modal */}
      {startError && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm card p-6 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-2">Failed to Start VM</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">{startError}</p>
            <div className="mt-6 flex justify-end">
              <button onClick={() => setStartError(null)} className="btn-primary">OK</button>
            </div>
          </div>
        </div>
      )}

      {deleteGroupConfirm && (
        <ConfirmDialog
          title="Delete Group?"
          message={`Delete "${deleteGroupConfirm.name}"? VMs in this group will be ungrouped.`}
          confirmLabel="Delete"
          onConfirm={() => { deleteGroupMut.mutate(deleteGroupConfirm.id); setDeleteGroupConfirm(null) }}
          onCancel={() => setDeleteGroupConfirm(null)}
        />
      )}
    </div>
  )
}

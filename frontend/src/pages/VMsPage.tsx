import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Plus, Play, Square, RotateCcw, Pencil, Trash2, Monitor, Loader2,
  FolderPlus, ChevronDown, ChevronRight, LayoutGrid, List,
HardDrive, Eye, Network, Settings2, CloudOff, Users, ArrowUp, ArrowDown, FolderDown
} from 'lucide-react'
import { vmApi, systemApi, formatBytes, userApi } from '../lib/api'
import { VM, VMConfig, VMGroup } from '../types'
import { useStore } from '../store/useStore'
import VMConfigModal from '../components/VMConfigModal'
import ConfirmDialog from '../components/ConfirmDialog'
import ImportVMModal from '../components/ImportVMModal'
import { clsx } from 'clsx'
import { X } from 'lucide-react'

type ViewMode = 'grid' | 'list'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    running: 'text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20',
    paused: 'text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20',
    starting: 'text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20',
    stopped: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
    error: 'text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/20',
  }
  
  const isAnimated = status === 'running' || status === 'paused' || status === 'starting'

  return (
    <span className={clsx('flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium', map[status] || map.stopped)}>
      <span className={clsx('w-1.5 h-1.5 rounded-full bg-current', isAnimated && 'animate-pulse')} />
      {status}
    </span>
  )
}

function SharedBadge({ isSharedWithMe, ownerName, sharedCount, asBadge = false }: { isSharedWithMe: boolean, ownerName?: string, sharedCount: number, asBadge?: boolean }) {
  if (!isSharedWithMe && sharedCount === 0) return null;

  const tooltip = isSharedWithMe
    ? `Shared from ${ownerName || 'another user'}`
    : `Shared with ${sharedCount} user${sharedCount !== 1 ? 's' : ''}`;

  const content = (
    <>
      <Users className={asBadge ? "w-3 h-3" : "w-3.5 h-3.5"} />
      {isSharedWithMe 
        ? <ArrowDown className={asBadge ? "w-2.5 h-2.5 -ml-0.5" : "w-3 h-3 -ml-0.5"} /> 
        : <ArrowUp className={asBadge ? "w-2.5 h-2.5 -ml-0.5" : "w-3 h-3 -ml-0.5"} />
      }
      {asBadge && <span className="ml-0.5">Shared</span>}
    </>
  );

  if (asBadge) {
    return (
      <span className="flex-shrink-0 flex items-center text-xs text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded cursor-help border border-indigo-100 dark:border-indigo-800/50" title={tooltip}>
        {content}
      </span>
    );
  }

  return (
    <span className="flex items-center text-indigo-500 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded-md cursor-help transition-colors border border-transparent hover:border-indigo-200 dark:hover:border-indigo-800" title={tooltip}>
      {content}
    </span>
  );
}

function VMCard({ vm, parentGroup, onEdit, groupColor, cpuSpeeds, onStartError }: { vm: VM; parentGroup?: VMGroup; onEdit: () => void; groupColor?: string; cpuSpeeds?: Record<string, string[]>; onStartError?: (msg: string) => void }) {
  const qc = useQueryClient()
  const { currentUser, openVMTab, closeVMTab, addToast, serverOnline } = useStore()
  
  const effectiveSharedIds = parentGroup?.shared_with_user_ids?.length ? parentGroup.shared_with_user_ids : (vm.shared_with_user_ids || []);
  const isSharedWithMe = effectiveSharedIds.includes(currentUser?.id || 0) || false;
  const sharedCount = effectiveSharedIds.length || 0;
  
  const isOwnerOrAdmin = currentUser?.is_admin || currentUser?.username === vm.owner_username;
  const isRunning = serverOnline && (vm.status === 'running' || vm.status === 'paused' || vm.status === 'starting')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const isLockedByOther = !!vm.locked_by_user_id && vm.locked_by_user_id !== currentUser?.id;

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

  const iconBgClass = !serverOnline ? 'bg-slate-100 dark:bg-slate-800'
    : vm.status === 'running' ? 'bg-emerald-100 dark:bg-emerald-900/30'
    : vm.status === 'paused' ? 'bg-amber-100 dark:bg-amber-900/30'
    : vm.status === 'starting' ? 'bg-blue-100 dark:bg-blue-900/30'
    : 'bg-red-100 dark:bg-red-900/30'

  const iconTextClass = !serverOnline ? 'text-slate-400'
    : vm.status === 'running' ? 'text-emerald-600 dark:text-emerald-400'
    : vm.status === 'paused' ? 'text-amber-600 dark:text-amber-400'
    : vm.status === 'starting' ? 'text-blue-600 dark:text-blue-400'
    : 'text-red-600 dark:text-red-400'

  return (
    <div className="card-hover p-5 flex flex-col gap-4" style={borderStyle}>
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0', iconBgClass)}>
          <Monitor className={clsx('w-4.5 h-4.5', iconTextClass)} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-slate-900 dark:text-white text-sm truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400" onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })}>{vm.name}</h3>
          {vm.description && <p className="text-xs text-slate-400 dark:text-slate-500 truncate mt-0.5" title={vm.description}>{vm.description}</p>}
        </div>
        <div className="flex flex-col items-end gap-1.5 flex-shrink-0 min-h-[44px]">
          <StatusBadge status={vm.status} />
          <SharedBadge isSharedWithMe={isSharedWithMe} ownerName={vm.owner_username} sharedCount={sharedCount} />
        </div>
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
        {isLockedByOther && !currentUser?.is_admin ? (
          <button disabled className="btn-secondary flex-1 justify-center text-xs py-1.5 opacity-60 cursor-not-allowed border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
            🔒 In use by {vm.locked_by_username}
          </button>
        ) : isRunning ? (
          <>
            <button onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })} className={clsx("btn-primary flex-1 justify-center text-xs py-1.5", isLockedByOther && "bg-amber-600 hover:bg-amber-700 text-white border-none")}>
              <Monitor className="w-3.5 h-3.5" />
              {isLockedByOther ? `Console (🔒 ${vm.locked_by_username})` : 'Console'}
            </button>
            <button 
              onClick={() => stopMut.mutate()} 
              disabled={stopMut.isPending} 
              className="btn-secondary p-2 hover:!bg-red-100 hover:!text-red-600 hover:!border-red-200 dark:hover:!bg-red-900/30 dark:hover:!text-red-400 dark:hover:!border-red-800 transition-colors" 
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            
            <button onClick={onEdit} disabled={!isOwnerOrAdmin} className="btn-ghost p-2 disabled:opacity-40 disabled:cursor-not-allowed" title={!isOwnerOrAdmin ? 'No permission' : 'View settings'}>
              <Eye className="w-3.5 h-3.5" />
            </button>
          </>
        ) : (
          <>
            <button onClick={() => startMut.mutate()} disabled={startMut.isPending || startMut.isSuccess || !serverOnline} className="btn-success flex-1 justify-center text-xs py-1.5 disabled:opacity-60">
              <Play className="w-3.5 h-3.5" />
              {startMut.isPending || startMut.isSuccess ? 'Starting…' : 'Start'}
            </button>
            
            <button onClick={onEdit} disabled={!serverOnline || !isOwnerOrAdmin} className="btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed" title={!isOwnerOrAdmin ? 'No permission' : serverOnline ? 'Edit' : 'Server unavailable'}>
              <Pencil className="w-3.5 h-3.5" />
            </button>
            
            <button onClick={() => setDeleteConfirm(true)} disabled={!serverOnline || !isOwnerOrAdmin} className="btn-ghost p-1.5 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed" title={!isOwnerOrAdmin ? 'No permission' : serverOnline ? undefined : 'Server unavailable'}>
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

function VMRow({ vm, parentGroup, onEdit, groupColor, onStartError }: { vm: VM; parentGroup?: VMGroup; onEdit: () => void; groupColor?: string; onStartError?: (msg: string) => void }) {
  const qc = useQueryClient()
  const { currentUser, openVMTab, closeVMTab, addToast, serverOnline } = useStore()
  
  // Vererbung der Rechte:
  const effectiveSharedIds = parentGroup?.shared_with_user_ids?.length ? parentGroup.shared_with_user_ids : (vm.shared_with_user_ids || []);
  const isSharedWithMe = effectiveSharedIds.includes(currentUser?.id || 0) || false;
  const sharedCount = effectiveSharedIds.length || 0;

  const isOwnerOrAdmin = currentUser?.is_admin || currentUser?.username === vm.owner_username;
  const isLockedByOther = !!vm.locked_by_user_id && vm.locked_by_user_id !== currentUser?.id;
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

  const iconBgClass = !serverOnline ? 'bg-slate-100 dark:bg-slate-800'
    : vm.status === 'running' ? 'bg-emerald-100 dark:bg-emerald-900/30'
    : vm.status === 'paused' ? 'bg-amber-100 dark:bg-amber-900/30'
    : vm.status === 'starting' ? 'bg-blue-100 dark:bg-blue-900/30'
    : 'bg-red-100 dark:bg-red-900/30'

  const iconTextClass = !serverOnline ? 'text-slate-400'
    : vm.status === 'running' ? 'text-emerald-600 dark:text-emerald-400'
    : vm.status === 'paused' ? 'text-amber-600 dark:text-amber-400'
    : vm.status === 'starting' ? 'text-blue-600 dark:text-blue-400'
    : 'text-red-600 dark:text-red-400'

  return (
    <>
    <tr className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors" style={rowStyle}>
      <td className="px-5 py-3">
        <div className="flex items-center gap-3">
          <div className={clsx('w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0', iconBgClass)}>
            <Monitor className={clsx('w-3.5 h-3.5', iconTextClass)} />
          </div>
          <div className="min-w-0">
            {/* VM Name und das SharedBadge nebeneinander */}
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-slate-900 dark:text-white truncate cursor-pointer hover:text-blue-600 dark:hover:text-blue-400" onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })}>{vm.name}</p>
              <SharedBadge isSharedWithMe={isSharedWithMe} ownerName={vm.owner_username} sharedCount={sharedCount} />
            </div>
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
          {isLockedByOther && !currentUser?.is_admin ? (
            <button disabled className="btn-secondary flex-1 justify-center text-xs py-1.5 opacity-60 cursor-not-allowed border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-400">
              🔒 In use by {vm.locked_by_username}
            </button>
          ) : isRunning ? (
            <>
              <button onClick={() => openVMTab({ vmId: vm.id, vmUuid: vm.uuid, vmName: vm.name, status: vm.status, group_color: vm.group_color })} className={clsx("btn-primary text-xs py-1 px-2.5", isLockedByOther && "bg-amber-600 hover:bg-amber-700 text-white border-none")}>
                <Monitor className="w-3 h-3" />
                {isLockedByOther ? `Console (🔒 ${vm.locked_by_username})` : 'Console'}
              </button>
<button 
                onClick={() => stopMut.mutate()} 
                disabled={stopMut.isPending} 
                className="btn-secondary text-xs py-1 px-2 disabled:opacity-60 hover:!bg-red-100 hover:!text-red-600 hover:!border-red-200 dark:hover:!bg-red-900/30 dark:hover:!text-red-400 dark:hover:!border-red-800 transition-colors"
              >
                {stopMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Square className="w-3 h-3" />}
              </button>
              
              {/* EYE BUTTON (Ausgegraut wenn man nicht der Besitzer/Admin ist) */}
              <button onClick={onEdit} disabled={!isOwnerOrAdmin} className="btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed" title={!isOwnerOrAdmin ? 'No permission' : 'View settings (read-only while running)'}>
                <Eye className="w-3.5 h-3.5" />
              </button>
            </>
          ) : (
            <>
              <button onClick={() => startMut.mutate()} disabled={startMut.isPending || startMut.isSuccess || !serverOnline} className="btn-success flex-1 justify-center text-xs py-1.5 disabled:opacity-60">
                <Play className="w-3.5 h-3.5" />
                {startMut.isPending || startMut.isSuccess ? 'Starting…' : 'Start'}
              </button>
              
              {/* EDIT BUTTON (Ausgegraut wenn man nicht der Besitzer/Admin ist) */}
              <button onClick={onEdit} disabled={!serverOnline || !isOwnerOrAdmin} className="btn-ghost p-1.5 disabled:opacity-40 disabled:cursor-not-allowed" title={!isOwnerOrAdmin ? 'No permission' : serverOnline ? 'Edit' : 'Server unavailable'}>
                <Pencil className="w-3.5 h-3.5" />
              </button>
              
              {/* DELETE BUTTON (Ausgegraut wenn man nicht der Besitzer/Admin ist) */}
              <button onClick={() => setDeleteConfirm(true)} disabled={!serverOnline || !isOwnerOrAdmin} className="btn-ghost p-1.5 text-red-400 disabled:opacity-40 disabled:cursor-not-allowed" title={!isOwnerOrAdmin ? 'No permission' : serverOnline ? undefined : 'Server unavailable'}>
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

function GroupModal({ onSave, onClose, initial, hasRunningVMs = false, initialSharedWith }: {
  onSave: (name: string, desc: string, color: string, networkEnabled: boolean, sharedWith: number[]) => void
  onClose: () => void
  initial?: { name: string; description?: string; color: string; network_enabled: boolean }
  hasRunningVMs?: boolean
  initialSharedWith?: number[]
}) {
  const [name, setName] = useState(initial?.name || '')
  const [desc, setDesc] = useState(initial?.description || '')
  const [color, setColor] = useState(initial?.color || '#6366f1')
  const [networkEnabled, setNetworkEnabled] = useState(initial?.network_enabled ?? false)
  const [sharedWith, setSharedWith] = useState<number[]>(initialSharedWith || [])
  const { currentUser } = useStore()
  const colors = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6']

  const { data: users = [] } = useQuery({ 
    queryKey: ['users'], 
    queryFn: userApi.list,
    enabled: !!currentUser?.is_admin 
  })

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
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4">
            <label className="label mb-2 block">Share with Users</label>
            {!currentUser?.is_admin ? (
              <p className="text-xs text-slate-500">Only administrators can share groups.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {users.filter(u => sharedWith.includes(u.id)).map(u => (
                    <span key={u.id} className="inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-md text-sm font-medium">
                      {u.username}
                      <button type="button" onClick={() => setSharedWith(sharedWith.filter(id => id !== u.id))} className="hover:text-red-500 focus:outline-none transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </span>
                  ))}
                  {sharedWith.length === 0 && <span className="text-sm text-slate-500 italic">Nobody shared with</span>}
                </div>
                
                {users.filter(u => u.id !== currentUser.id && !sharedWith.includes(u.id)).length > 0 && (
                  <select
                    className="input w-full text-sm"
                    value=""
                    onChange={e => {
                      if (e.target.value) setSharedWith([...sharedWith, parseInt(e.target.value)])
                    }}
                  >
                    <option value="">+ Add another user...</option>
                    {users.filter(u => u.id !== currentUser.id && !sharedWith.includes(u.id)).map(u => (
                      <option key={u.id} value={u.id}>{u.username}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-3 mt-6 justify-end">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => { onSave(name, desc, color, networkEnabled, sharedWith); onClose() }} disabled={!name} className="btn-primary">Save</button>
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
  
  const { currentUser } = useStore()
  const isSharedWithMe = group.shared_with_user_ids?.includes(currentUser?.id || 0) || false;
  const sharedCount = group.shared_with_user_ids?.length || 0;
  const isGroupOwnerOrAdmin = currentUser?.is_admin || !isSharedWithMe;

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
          <SharedBadge isSharedWithMe={isSharedWithMe} ownerName={undefined} sharedCount={sharedCount} asBadge={true} />
          <span className="ml-auto text-slate-400 flex-shrink-0">
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </button>
        
        <button 
          onClick={onEditGroup} 
          disabled={!isGroupOwnerOrAdmin} 
          className="btn-ghost p-1.5 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed" 
          title={!isGroupOwnerOrAdmin ? 'No permission' : 'Edit group'}
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onDeleteGroup}
          disabled={group.has_running_vms || !isGroupOwnerOrAdmin}
          className="btn-ghost p-1.5 text-red-400 hover:text-red-600 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
          title={!isGroupOwnerOrAdmin ? 'No permission' : group.has_running_vms ? 'Stop all VMs before deleting' : 'Delete group'}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      
      {!collapsed && (
        view === 'grid'
          ? <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {vms.map(vm => <VMCard key={vm.id} vm={vm} parentGroup={group} groupColor={groupColor} onEdit={() => onEditVM(vm)} cpuSpeeds={cpuSpeeds} onStartError={onStartError} />)}
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
                  {vms.map(vm => <VMRow key={vm.id} vm={vm} parentGroup={group} groupColor={groupColor} onEdit={() => onEditVM(vm)} onStartError={onStartError} />)}
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
const { currentUser, addToast, authConfig, serverOnline, openTabs, updateTabGroupColor } = useStore()
  const [view, setView] = useState<ViewMode>(() => {
    const savedMode = localStorage.getItem('vmViewPreference');
    return (savedMode === 'grid' || savedMode === 'list') ? savedMode : 'grid';
  });

  useEffect(() => {
    localStorage.setItem('vmViewPreference', view);
  }, [view]);
  const [showCreateVM, setShowCreateVM] = useState(false)
  const [showImportVM, setShowImportVM] = useState(false)
  const [editVM, setEditVM] = useState<VM | null>(null)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [editGroup, setEditGroup] = useState<VMGroup | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})
  const [startError, setStartError] = useState<string | null>(null)
  const [deleteGroupConfirm, setDeleteGroupConfirm] = useState<VMGroup | null>(null)

  const { data: vms = [], isLoading } = useQuery({
    queryKey: ['vms', currentUser?.id],
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
    queryKey: ['vm-groups', currentUser?.id],
    queryFn: vmApi.listGroups,
  })

  const createVMMut = useMutation({
    mutationFn: (data: { name: string; description?: string; group_id?: number; config: VMConfig; shared_with_user_ids?: number[] }) => vmApi.create(data),
    onSuccess: (vm) => { qc.invalidateQueries({ queryKey: ['vms'] }); addToast(`VM "${vm.name}" created`) },
    onError: (e: any) => addToast(e.message || 'Failed to create VM', 'error'),
  })

  const updateVMMut = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; description?: string; group_id?: number | null; config?: VMConfig; shared_with_user_ids?: number[] }) =>
      vmApi.update(id, data),
    onSuccess: (vm) => { qc.invalidateQueries({ queryKey: ['vms'] }); addToast(`VM "${vm.name}" updated`) },
    onError: (e: any) => addToast(e.message || 'Failed to update VM', 'error'),
  })

  const createGroupMut = useMutation({
    mutationFn: (data: { name: string; description?: string; color: string; network_enabled?: boolean; shared_with_user_ids?: number[] }) => vmApi.createGroup(data),
    onSuccess: (g) => { qc.invalidateQueries({ queryKey: ['vm-groups'] }); addToast(`Group "${g.name}" created`) },
    onError: (e: any) => addToast(e.message || 'Failed to create group', 'error'),
  })

  const updateGroupMut = useMutation({
    mutationFn: ({ id, ...data }: { id: number; name?: string; description?: string; color?: string; network_enabled?: boolean; shared_with_user_ids?: number[] }) =>
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
    if (vm.group_id && groups.some(g => g.id === vm.group_id)) {
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
{(currentUser?.is_admin || currentUser?.can_manage_groups) && (
          <button onClick={() => setShowCreateGroup(true)} disabled={!serverOnline} className="btn-secondary disabled:opacity-60" title={!serverOnline ? 'Server unavailable' : undefined}>
            <FolderPlus className="w-4 h-4" />New Group
          </button>
        )}
        {(currentUser?.is_admin || currentUser?.can_manage_vms) && (
          <button
            disabled={!serverOnline}
            onClick={() => atVMQuota ? addToast(`VM quota reached (${userStats!.max_vms} VMs). Delete a VM to import a new one.`, 'error') : setShowImportVM(true)}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg text-white bg-amber-500 hover:bg-amber-600 shadow-sm transition-colors', 
              (atVMQuota || !serverOnline) && 'opacity-60 cursor-not-allowed'
            )}
            title={!serverOnline ? 'Server unavailable' : atVMQuota ? `Quota reached: ${userStats?.max_vms} VMs` : undefined}
          >
            <FolderDown className="w-4 h-4" />Import VM
          </button>
        )}
        {(currentUser?.is_admin || currentUser?.can_manage_vms) && (
          <button
            disabled={!serverOnline}
            onClick={() => atVMQuota ? addToast(`VM quota reached (${userStats!.max_vms} VMs). Delete a VM to create a new one.`, 'error') : setShowCreateVM(true)}
            className={clsx('btn-primary', (atVMQuota || !serverOnline) && 'opacity-60')}
            title={!serverOnline ? 'Server unavailable' : atVMQuota ? `Quota reached: ${userStats?.max_vms} VMs` : undefined}
          >
            <Plus className="w-4 h-4" />New VM
          </button>
        )}
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
          onSave={async (name, desc, groupId, config, sharedWith) => {
            await createVMMut.mutateAsync({ name, description: desc, group_id: groupId ?? undefined, config, shared_with_user_ids: sharedWith })
          }}
        />
      )}

      {/* Import VM modal */}
      {showImportVM && (
        <ImportVMModal
          groups={groups}
          onClose={() => setShowImportVM(false)}
          onSuccess={(vmId) => {
             // Invalidate the cache to reload the VM list automatically
             qc.invalidateQueries({ queryKey: ['vms'] })
             addToast('VM successfully imported!', 'success')
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
          initialSharedWith={editVM.shared_with_user_ids}
          onSave={async (name, desc, groupId, config, sharedWith) => {
            await updateVMMut.mutateAsync({ id: editVM.id, name, description: desc, group_id: groupId, config, shared_with_user_ids: sharedWith })
          }}
        />
      )}

      {/* Create group modal */}
      {showCreateGroup && (
        <GroupModal
          onClose={() => setShowCreateGroup(false)}
          onSave={(name, desc, color, networkEnabled, sharedWith) =>
            createGroupMut.mutate({ name, description: desc, color, network_enabled: networkEnabled, shared_with_user_ids: sharedWith })
          }
        />
      )}

      {/* Edit group modal */}
      {editGroup && (
        <GroupModal
          initial={{ name: editGroup.name, description: editGroup.description, color: editGroup.color, network_enabled: editGroup.network_enabled }}
          initialSharedWith={editGroup.shared_with_user_ids}
          hasRunningVMs={editGroup.has_running_vms}
          onClose={() => setEditGroup(null)}
          onSave={(name, desc, color, networkEnabled, sharedWith) =>
            updateGroupMut.mutate({ id: editGroup.id, name, description: desc, color, network_enabled: networkEnabled, shared_with_user_ids: sharedWith })
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

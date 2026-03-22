import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, FolderDown, AlertCircle } from 'lucide-react'
import { vmApi } from '../lib/api'
import { clsx } from 'clsx'

interface Props {
  // Pass the available groups so the user can assign the imported VM to one
  groups: { id: number; name: string; color: string; network_enabled: boolean }[]
  onSuccess: (vmId: number) => void
  onClose: () => void
}

interface UnregisteredFolder {
  folder_name: string
  machine: string
}

export default function ImportVMModal({ groups, onSuccess, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [folders, setFolders] = useState<UnregisteredFolder[]>([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)

  // Form State
  const [selectedFolder, setSelectedFolder] = useState<string>('')
  const [vmName, setVmName] = useState('')
  const [description, setDescription] = useState('')
  const [groupId, setGroupId] = useState<number | null>(null)

  // Fetch the unregistered folders when the modal opens
  useEffect(() => {
    async function fetchFolders() {
      try {
        const res = await vmApi.getUnregistered()
        setFolders(res.unregistered)
        if (res.unregistered.length > 0) {
          // Pre-select the first folder in the list
          setSelectedFolder(res.unregistered[0].folder_name)
          // Auto-fill the VM name with the folder name
          setVmName(res.unregistered[0].folder_name)
        }
      } catch (err: any) {
        setError(err.message || 'Failed to scan for VM folders.')
      } finally {
        setLoading(false)
      }
    }
    fetchFolders()
  }, [])

  // Auto-update the VM name if the user changes the folder selection (and hasn't typed a custom name yet)
  function handleFolderSelect(folder: string) {
    if (vmName === selectedFolder) {
      setVmName(folder)
    }
    setSelectedFolder(folder)
  }

  async function handleImport() {
    if (!selectedFolder) {
      setError('Please select a folder to import.')
      return
    }
    if (!vmName.trim()) {
      setError('VM name is required.')
      return
    }

    setImporting(true)
    setError('')

    try {
      const result = await vmApi.importVM({
        folder_name: selectedFolder,
        vm_name: vmName,
        description: description,
        group_id: groupId,
      })
      onSuccess(result.vm.id)
      onClose()
    } catch (err: any) {
      setError(err.message || 'Import failed.')
      setImporting(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/50">
          <div className="flex items-center gap-2">
            <FolderDown className="w-5 h-5 text-blue-400" />
            <h2 className="text-base font-semibold text-white">Import VM from Server</h2>
          </div>
          <button onClick={onClose} disabled={importing} className="btn-ghost p-1.5 rounded-lg text-slate-400 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-slate-400">Scanning server directory for VMs...</p>
            </div>
          ) : folders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3 text-center">
              <AlertCircle className="w-10 h-10 text-slate-500" />
              <div>
                <p className="text-sm font-medium text-slate-300">No unregistered VMs found</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[280px]">
                  Drop a VM folder (containing an <code className="bg-slate-800 px-1 rounded text-amber-300">86box.cfg</code>) into the <code className="bg-slate-800 px-1 rounded text-emerald-300">vms/</code> directory on your server.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Folder Selection */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-slate-300">Select Folder to Import</label>
                <select 
                  className="input w-full" 
                  value={selectedFolder} 
                  onChange={e => handleFolderSelect(e.target.value)}
                  disabled={importing}
                >
                  {folders.map(f => (
                    <option key={f.folder_name} value={f.folder_name}>
                      {f.folder_name} ({f.machine})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500">
                  This folder will be renamed to a unique UUID upon import.
                </p>
              </div>

              <hr className="border-slate-800" />

              {/* VM Details */}
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">VM Name</label>
                  <input 
                    type="text" 
                    className="input w-full" 
                    value={vmName} 
                    onChange={e => setVmName(e.target.value)} 
                    placeholder="e.g. Windows 95"
                    disabled={importing}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">Description (Optional)</label>
                  <input 
                    type="text" 
                    className="input w-full" 
                    value={description} 
                    onChange={e => setDescription(e.target.value)} 
                    placeholder="A brief description of this machine"
                    disabled={importing}
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-slate-300">Group (Optional)</label>
                  <div className="flex items-center gap-2">
                    {groupId && (() => { const g = groups.find(g => g.id === groupId); return g ? <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} /> : null })()}
                    <select 
                      className="input flex-1" 
                      value={groupId ?? ''} 
                      onChange={e => setGroupId(e.target.value ? parseInt(e.target.value) : null)}
                      disabled={importing}
                    >
                      <option value="">No group</option>
                      {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-800 bg-slate-900/50">
          {error ? (
            <p className="text-sm text-red-400">{error}</p>
          ) : (
            <div /> // Empty div to keep the flex layout balanced
          )}
          <div className="flex items-center gap-2">
            <button onClick={onClose} disabled={importing} className="btn-secondary text-sm">
              Cancel
            </button>
            <button 
              onClick={handleImport} 
              disabled={importing || folders.length === 0 || !selectedFolder} 
              className={clsx("btn-primary text-sm", importing && "opacity-75 cursor-not-allowed")}
            >
              {importing ? 'Importing...' : 'Import VM'}
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  )
}
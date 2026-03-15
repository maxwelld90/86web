import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RefreshCw, CheckCircle, AlertTriangle, Server, Package, Settings2, ShieldCheck, Activity } from 'lucide-react'
import { systemApi } from '../lib/api'
import { useStore } from '../store/useStore'

export default function SettingsPage() {
  const { currentUser, authConfig, theme, toggleTheme, serverOnline } = useStore()
  const isAdmin = currentUser?.is_admin || !authConfig?.user_management
  const qc = useQueryClient()
  const [updateResult, setUpdateResult] = useState<Record<string, string> | null>(null)
  const [hwRefreshResult, setHwRefreshResult] = useState<string | null>(null)
  const [activeVmLimitInput, setActiveVmLimitInput] = useState<string>('')

  const { data: version, refetch: refetchVersion } = useQuery({
    queryKey: ['version'],
    queryFn: systemApi.version,
    refetchInterval: 30000,
  })

  const { data: envConfig } = useQuery({
    queryKey: ['system-config'],
    queryFn: systemApi.config,
    enabled: !!isAdmin,
  })

  const updateMut = useMutation({
    mutationFn: systemApi.triggerUpdate,
    onSuccess: (result) => {
      setUpdateResult(result)
      refetchVersion()
    },
  })

  const hwRefreshMut = useMutation({
    mutationFn: systemApi.refreshHardware,
    onSuccess: (result) => {
      setHwRefreshResult(`Extracted ${result.machines} machines from 86Box source`)
    },
    onError: (e: any) => {
      setHwRefreshResult(`Failed: ${e.message}`)
    },
  })

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: systemApi.getAppSettings,
    enabled: !!isAdmin,
  })

  useEffect(() => {
    if (appSettings) {
      setActiveVmLimitInput(appSettings.active_vm_limit != null ? String(appSettings.active_vm_limit) : '')
    }
  }, [appSettings?.active_vm_limit])

  const appSettingsMut = useMutation({
    mutationFn: systemApi.updateAppSettings,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['app-settings'] }),
  })

  const { data: recommendedLimit } = useQuery({
    queryKey: ['recommended-vm-limit'],
    queryFn: systemApi.recommendedVmLimit,
    enabled: !!isAdmin,
  })

  async function handleUpdate() {
    setUpdateResult(null)
    await updateMut.mutateAsync()
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Settings</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Application configuration and system information</p>
      </div>

      {/* 86Box Version */}
      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        <div className="px-6 py-4 flex items-center gap-3">
          <Server className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          <h2 className="font-semibold text-slate-900 dark:text-white">86Box</h2>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Installed Version</p>
            <p className="font-mono text-sm font-medium text-slate-900 dark:text-white">
              {version?.box86_version || 'Not installed'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Latest Available</p>
            <p className="font-mono text-sm font-medium text-slate-900 dark:text-white">
              {version?.box86_latest || '—'}
            </p>
          </div>
        </div>
        {version?.update_available && (
          <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/10 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-700 dark:text-amber-400">
              86Box update available: {version.box86_latest}
            </span>
          </div>
        )}
      </div>

      {/* ROMs */}
      <div className="card divide-y divide-slate-100 dark:divide-slate-800">
        <div className="px-6 py-4 flex items-center gap-3">
          <Package className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          <h2 className="font-semibold text-slate-900 dark:text-white">ROM Files</h2>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Installed Version</p>
            <p className="font-mono text-sm font-medium text-slate-900 dark:text-white">
              {version?.roms_version || 'Not installed'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">Latest Available</p>
            <p className="font-mono text-sm font-medium text-slate-900 dark:text-white">
              {version?.roms_latest || '—'}
            </p>
          </div>
        </div>
        {version?.roms_update_available && (
          <div className="px-6 py-3 bg-amber-50 dark:bg-amber-900/10 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400" />
            <span className="text-sm text-amber-700 dark:text-amber-400">
              ROMs update available: {version.roms_latest}
            </span>
          </div>
        )}
      </div>

      {/* Update button (admin only) */}
      {isAdmin && (
        <div className="card px-6 py-5 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-slate-900 dark:text-white">Check for Updates</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Download the latest 86Box binary and ROM files
            </p>
          </div>
          <button
            onClick={handleUpdate}
            disabled={updateMut.isPending || !serverOnline}
            className="btn-primary disabled:opacity-60"
            title={!serverOnline ? 'Server unavailable' : undefined}
          >
            <RefreshCw className={`w-4 h-4 ${updateMut.isPending ? 'animate-spin' : ''}`} />
            {updateMut.isPending ? 'Updating…' : 'Update Now'}
          </button>
        </div>
      )}

      {updateResult && (
        <div className="card px-6 py-4 space-y-2">
          {Object.entries(updateResult).map(([key, val]) => (
            <div key={key} className="flex items-center gap-2 text-sm">
              {val === 'updated' || val === 'up_to_date' ? (
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-red-500" />
              )}
              <span className="font-medium text-slate-700 dark:text-slate-300 capitalize">{key}:</span>
              <span className="text-slate-500 dark:text-slate-400">{val.replace(/_/g, ' ')}</span>
            </div>
          ))}
        </div>
      )}

      {/* Hardware Database refresh (admin only) */}
      {isAdmin && (
        <div className="card px-6 py-5 flex items-center justify-between">
          <div>
            <h3 className="font-medium text-slate-900 dark:text-white">Hardware Database</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Re-extract machine and device lists from 86Box source
              {hwRefreshResult && <span className="block text-xs mt-1 text-emerald-600 dark:text-emerald-400">{hwRefreshResult}</span>}
            </p>
          </div>
          <button
            onClick={() => { setHwRefreshResult(null); hwRefreshMut.mutate() }}
            disabled={hwRefreshMut.isPending || !serverOnline}
            className="btn-secondary disabled:opacity-60"
            title={!serverOnline ? 'Server unavailable' : undefined}
          >
            <RefreshCw className={`w-4 h-4 ${hwRefreshMut.isPending ? 'animate-spin' : ''}`} />
            {hwRefreshMut.isPending ? 'Refreshing…' : 'Refresh Now'}
          </button>
        </div>
      )}

      {/* Quota Enforcement (admin only) */}
      {isAdmin && appSettings !== undefined && (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          <div className="px-6 py-5 flex items-center justify-between">
            <div className="flex items-start gap-3">
              <ShieldCheck className="w-5 h-5 text-emerald-500 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-medium text-slate-900 dark:text-white">Enforce Quotas</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  When enabled, users cannot exceed their VM count or storage limits.
                </p>
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer ml-6 shrink-0">
              <input
                type="checkbox"
                checked={appSettings.enforce_quotas}
                disabled={appSettingsMut.isPending}
                onChange={e => appSettingsMut.mutate({ enforce_quotas: e.target.checked, active_vm_limit: appSettings.active_vm_limit })}
                className="w-4 h-4 rounded accent-blue-600"
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">
                {appSettings.enforce_quotas ? 'Enforced' : 'Disabled'}
              </span>
            </label>
          </div>

          {/* Active VM Limit */}
          <div className="px-6 py-5 flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <Activity className="w-5 h-5 text-blue-500 dark:text-blue-400 mt-0.5 shrink-0" />
              <div>
                <h3 className="font-medium text-slate-900 dark:text-white">Active VM Limit</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Maximum number of VMs that can run simultaneously. Set to No limit to disable enforcement.
                  {recommendedLimit && (
                    <span className="block text-xs mt-1">
                      Recommended for this host: <span className="font-medium text-slate-700 dark:text-slate-300">{recommendedLimit.recommended}</span>
                      {' '}({recommendedLimit.cpu_cores} CPU cores, {recommendedLimit.ram_gb} GB RAM)
                    </span>
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <input
                type="number"
                min={1}
                max={100}
                className="input w-20 text-center"
                placeholder={recommendedLimit ? String(recommendedLimit.recommended) : '5'}
                value={activeVmLimitInput}
                onChange={e => setActiveVmLimitInput(e.target.value)}
              />
              <button
                className="btn-secondary"
                disabled={appSettingsMut.isPending}
                onClick={() => {
                  const val = activeVmLimitInput.trim()
                  const parsed = val ? parseInt(val) : null
                  appSettingsMut.mutate({ enforce_quotas: appSettings.enforce_quotas, active_vm_limit: parsed })
                }}
              >
                Save
              </button>
              <button
                className="btn-ghost text-xs text-slate-400"
                title="Remove limit — any number of VMs may run simultaneously"
                disabled={appSettings.active_vm_limit == null || appSettingsMut.isPending}
                onClick={() => {
                  setActiveVmLimitInput('')
                  appSettingsMut.mutate({ enforce_quotas: appSettings.enforce_quotas, active_vm_limit: null })
                }}
              >
                No limit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Appearance */}
      <div className="card px-6 py-5 flex items-center justify-between">
        <div>
          <h3 className="font-medium text-slate-900 dark:text-white">Appearance</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">Current theme: {theme}</p>
        </div>
        <button onClick={toggleTheme} className="btn-secondary">
          Switch to {theme === 'dark' ? 'Light' : 'Dark'} Mode
        </button>
      </div>

      {/* Environment Configuration (admin only) */}
      {isAdmin && envConfig && (
        <div className="card divide-y divide-slate-100 dark:divide-slate-800">
          <div className="px-6 py-4 flex items-center gap-3">
            <Settings2 className="w-5 h-5 text-slate-500 dark:text-slate-400" />
            <h2 className="font-semibold text-slate-900 dark:text-white">Environment Configuration</h2>
          </div>
          {Object.entries(envConfig).map(([section, vars]) => (
            <div key={section} className="px-6 py-4">
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">{section}</p>
              <div className="space-y-1.5">
                {Object.entries(vars).map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-3 text-sm">
                    <span className="font-mono text-slate-500 dark:text-slate-400 w-64 shrink-0">{key}</span>
                    <span className={`font-mono break-all ${value.startsWith('***') ? 'text-slate-400 dark:text-slate-600 italic' : 'text-slate-900 dark:text-white'}`}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

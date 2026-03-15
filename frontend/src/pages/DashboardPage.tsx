import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Clock, Cpu, HardDrive, LayoutGrid, MemoryStick, Monitor } from 'lucide-react'
import { systemApi, vmApi, formatBytes, formatUptime } from '../lib/api'
import { useStore } from '../store/useStore'

// ─── Sparkline chart ──────────────────────────────────────────────────────────

const HISTORY = 60

interface HistoryPoint { cpu: number; mem: number; disk: number }

function SparkArea({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return <div className="h-16 bg-slate-100 dark:bg-slate-800 rounded" />
  const w = 200, h = 48
  const pts = data.map((v, i) => [
    (i / (data.length - 1)) * w,
    h - (Math.min(100, Math.max(0, v)) / 100) * (h - 4),
  ])
  const line = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `0,${h} ${line} ${w},${h}`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-16">
      <defs>
        <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#grad-${color})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, percent, color = 'blue', history }: {
  label: string; value: string; sub?: string; icon: any
  percent?: number; color?: string; history?: number[]
}) {
  const colors: Record<string, { icon: string; bar: string; spark: string }> = {
    blue:   { icon: 'text-blue-600 bg-blue-50 dark:bg-blue-900/20 dark:text-blue-400',       bar: 'bg-blue-500',    spark: '#3b82f6' },
    purple: { icon: 'text-violet-600 bg-violet-50 dark:bg-violet-900/20 dark:text-violet-400', bar: 'bg-violet-500', spark: '#8b5cf6' },
    amber:  { icon: 'text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400',    bar: 'bg-amber-500',   spark: '#f59e0b' },
    green:  { icon: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400', bar: 'bg-emerald-500', spark: '#10b981' },
  }
  const c = colors[color] || colors.blue
  const pct = percent !== undefined ? Math.min(100, Math.max(0, percent)) : null

  return (
    <div className="card p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ${c.icon}`}>
          <Icon className="w-4.5 h-4.5" />
        </div>
        {pct !== null && (
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 tabular-nums">
            {pct.toFixed(1)}%
          </span>
        )}
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{label}</p>
        <p className="text-xl font-bold text-slate-900 dark:text-white tabular-nums mt-0.5">{value}</p>
        {sub && <p className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">{sub}</p>}
      </div>
      {history && history.length > 1 ? (
        <SparkArea data={history} color={c.spark} />
      ) : pct !== null ? (
        <div className="progress-bar mt-1">
          <div className={`h-full rounded-full transition-all duration-500 ${c.bar}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  )
}

// ─── Users table ──────────────────────────────────────────────────────────────

function UsersTable({ data }: { data: { id: number; username: string; vm_count: number; running_vms: number; disk_usage_bytes: number; max_vms: number; max_storage_gb: number }[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
        <h3 className="font-semibold text-slate-900 dark:text-white text-sm">User Resource Usage</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 dark:border-slate-800">
              {['User', 'VMs', 'Running', 'Disk Usage', 'Storage Limit'].map(h => (
                <th key={h} className="text-left px-5 py-3 text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.map(u => (
              <tr key={u.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <td className="px-5 py-3 font-medium text-slate-900 dark:text-white">{u.username}</td>
                <td className="px-5 py-3 text-slate-600 dark:text-slate-400">{u.vm_count} / {u.max_vms}</td>
                <td className="px-5 py-3">
                  {u.running_vms > 0
                    ? <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><span className="status-running" />{u.running_vms}</span>
                    : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-5 py-3 text-slate-600 dark:text-slate-400 tabular-nums">{formatBytes(u.disk_usage_bytes)}</td>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2">
                    <div className="progress-bar flex-1 max-w-[80px]">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.min(100, (u.disk_usage_bytes / (u.max_storage_gb * 1073741824)) * 100)}%` }} />
                    </div>
                    <span className="text-xs text-slate-400 tabular-nums">{u.max_storage_gb} GB</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.length === 0 && <div className="px-5 py-8 text-center text-sm text-slate-400">No users found</div>}
      </div>
    </div>
  )
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { currentUser, authConfig, serverOnline } = useStore()
  const historyRef = useRef<HistoryPoint[]>([])
  const [history, setHistory] = useState<HistoryPoint[]>([])

  const { data: stats } = useQuery({
    queryKey: ['system-stats'],
    queryFn: systemApi.stats,
    refetchInterval: 2000,
  })

  const { data: userStats } = useQuery({
    queryKey: ['user-stats'],
    queryFn: systemApi.userStats,
    refetchInterval: 5000,
  })

  const { data: allUsersStats } = useQuery({
    queryKey: ['all-users-stats'],
    queryFn: systemApi.allUsersStats,
    enabled: !!currentUser?.is_admin && !!authConfig?.user_management,
    refetchInterval: 15000,
  })

  const { data: appSettings } = useQuery({
    queryKey: ['app-settings'],
    queryFn: systemApi.getAppSettings,
    enabled: !!currentUser?.is_admin,
    staleTime: 30_000,
  })

  const { data: vms = [] } = useQuery({
    queryKey: ['vms'],
    queryFn: () => vmApi.list(),
    refetchInterval: 5000,
  })

  const runningVMs = vms.filter(v => v.status === 'running')

  // Accumulate history
  useEffect(() => {
    if (!stats) return
    const point: HistoryPoint = {
      cpu: stats.cpu_percent,
      mem: stats.memory_percent,
      disk: stats.disk_percent,
    }
    const next = [...historyRef.current.slice(-(HISTORY - 1)), point]
    historyRef.current = next
    setHistory(next)
  }, [stats])

  const cpuHistory = history.map(p => p.cpu)
  const memHistory = history.map(p => p.mem)
  const diskHistory = history.map(p => p.disk)

  const userStoragePct = authConfig?.user_management && userStats
    ? (userStats.disk_usage_bytes / (userStats.max_storage_gb * 1073741824)) * 100
    : undefined

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            86Web on <span className="font-mono">{!serverOnline ? '—' : (stats?.hostname ?? '…')}</span>
          </p>
        </div>
      </div>

      {/* System stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="CPU Usage"
          value={!serverOnline ? '—' : stats ? `${stats.cpu_percent.toFixed(1)}%` : '—'}
          icon={Cpu} percent={serverOnline ? stats?.cpu_percent : undefined} color="blue"
          history={serverOnline ? cpuHistory : []}
        />
        <StatCard
          label="Memory"
          value={!serverOnline ? '—' : stats ? formatBytes(stats.memory_used) : '—'}
          sub={serverOnline && stats ? `of ${formatBytes(stats.memory_total)}` : undefined}
          icon={MemoryStick} percent={serverOnline ? stats?.memory_percent : undefined} color="purple"
          history={serverOnline ? memHistory : []}
        />
        <StatCard
          label="Storage"
          value={!serverOnline ? '—' : stats ? formatBytes(stats.disk_used) : '—'}
          sub={serverOnline && stats ? `of ${formatBytes(stats.disk_total)}` : undefined}
          icon={HardDrive} percent={serverOnline ? stats?.disk_percent : undefined} color="amber"
          history={serverOnline ? diskHistory : []}
        />
        <StatCard
          label="Uptime"
          value={!serverOnline ? '—' : stats ? formatUptime(stats.uptime_seconds) : '—'}
          icon={Clock} color="green"
        />
      </div>

      {/* VM + storage summary */}
      <div className={`grid grid-cols-1 gap-4 ${authConfig?.user_management ? 'lg:grid-cols-3' : 'lg:grid-cols-2'}`}>
        <StatCard
          label={authConfig?.user_management ? 'Your VMs' : 'VMs'}
          value={!serverOnline ? '—' : userStats ? String(userStats.vm_count) : '—'}
          sub={serverOnline && authConfig?.user_management && userStats ? `of ${userStats.max_vms} · ${userStats.running_vm_count} running` : serverOnline && userStats ? `${userStats.running_vm_count ?? 0} running` : undefined}
          icon={Monitor} color="blue"
          percent={serverOnline && authConfig?.user_management && userStats ? (userStats.vm_count / userStats.max_vms) * 100 : undefined}
        />
        {authConfig?.user_management && (
          <StatCard
            label="All VMs"
            value={!serverOnline ? '—' : stats ? String(stats.total_vms) : '—'}
            sub={serverOnline && stats
              ? appSettings?.active_vm_limit != null
                ? `${stats.running_vms} running · ${appSettings.active_vm_limit} slot limit`
                : `${stats.running_vms} running`
              : undefined}
            icon={LayoutGrid} color="green"
          />
        )}
        <StatCard
          label={authConfig?.user_management ? 'Your Storage Usage' : 'Storage Usage'}
          value={!serverOnline ? '—' : userStats ? formatBytes(userStats.disk_usage_bytes) : '—'}
          sub={serverOnline && authConfig?.user_management && userStats ? `of ${userStats.max_storage_gb} GB` : undefined}
          icon={HardDrive} color="amber"
          percent={serverOnline ? userStoragePct : undefined}
        />
      </div>

      {/* Running VMs list */}
      {runningVMs.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-white text-sm">Running VMs</h3>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {runningVMs.map(vm => (
              <div key={vm.id} className="px-5 py-3 flex items-center gap-3">
                <span className="status-running flex-shrink-0" />
                <span className="text-sm font-medium text-slate-900 dark:text-white flex-1">{vm.name}</span>
                {vm.description && (
                  <span className="text-xs text-slate-400 dark:text-slate-500 truncate max-w-xs hidden sm:block">{vm.description}</span>
                )}
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400 flex-shrink-0">{vm.config?.machine || '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Admin: all users table */}
      {currentUser?.is_admin && authConfig?.user_management && allUsersStats && (
        <UsersTable data={allUsersStats} />
      )}
    </div>
  )
}

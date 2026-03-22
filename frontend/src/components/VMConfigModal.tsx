import { useState, useEffect, useRef, useMemo, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { X, ChevronRight, HardDrive, Monitor, Volume2, Network, Cpu, Settings2, UsbIcon, Upload, Trash2, Disc, Save, FolderOpen, Plus, CloudOff, ServerCog } from 'lucide-react'
import { VMConfig, HardwareLists, HardwareOption } from '../types'
import { systemApi, mediaApi, userApi, defaultConfig, formatBytes } from '../lib/api'
import { useStore } from '../store/useStore'
import { withBusGroups } from '../lib/busGroups'
import { clsx } from 'clsx'
import ImagePickerModal from './ImagePickerModal'

interface Props {
  vmId?: number  // present when editing an existing VM; absent when creating
  initialConfig?: VMConfig
  initialName?: string
  initialDesc?: string
  initialGroupId?: number
  groups: { id: number; name: string; color: string; network_enabled: boolean; shared_with_user_ids?: number[] }[]
  initialSharedWith?: number[]
  onSave: (name: string, desc: string, groupId: number | null, config: VMConfig, sharedWith: number[]) => Promise<void>
  onClose: () => void
  title: string
  readOnly?: boolean
}

type Tab = 'general' | 'machine' | 'display' | 'sound' | 'network' | 'controllers' | 'disks' | 'floppy' | 'cdrom' | 'ports' | 'other'

// Shared disabled context so Toggle components respect server-offline / readOnly state
const DisabledCtx = createContext(false)

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <h4 className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 pb-2">
        {label}
      </h4>
      {children}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-36 flex-shrink-0 pt-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">{label}</label>
        {hint && <p className="text-xs text-slate-400 dark:text-slate-600 mt-0.5">{hint}</p>}
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  )
}

function Select({ value, onChange, options, grouped = false, disabled = false }: {
  value: string
  onChange: (v: string) => void
  options: { id: string; name: string; category?: string }[]
  grouped?: boolean
  disabled?: boolean
}) {
  if (!grouped) {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className="input" disabled={disabled}>
        {options.map(o => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
    )
  }

  // Group by category, preserving the order categories first appear
  const order: string[] = []
  const groups: Record<string, typeof options> = {}
  options.forEach(o => {
    const cat = o.category || 'Other'
    if (!groups[cat]) { groups[cat] = []; order.push(cat) }
    groups[cat].push(o)
  })

  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="input" disabled={disabled}>
      {order.map(cat => (
        <optgroup key={cat} label={cat}>
          {groups[cat].map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </optgroup>
      ))}
    </select>
  )
}


function Toggle({ value, onChange, label, disabled }: { value: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  const isDisabled = disabled || useContext(DisabledCtx)
  return (
    <label className={clsx('flex items-center gap-2.5', isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer')}>
      <div
        onClick={() => !isDisabled && onChange(!value)}
        className={clsx(
          'relative w-9 h-5 rounded-full transition-colors',
          value ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
        )}
      >
        <div className={clsx(
          'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
          value ? 'translate-x-4' : 'translate-x-0.5'
        )} />
      </div>
      {label && <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>}
    </label>
  )
}

function DeviceSettings({ device, settings, onChange }: {
  device: { name: string; config?: import('../types').DeviceConfig[] } | undefined
  settings: Record<string, number | string>
  onChange: (key: string, value: number | string) => void
}) {
  if (!device?.config?.length) return null
  return (
    <div className="mt-2 space-y-2 pl-2 border-l-2 border-slate-200 dark:border-slate-700">
      {device.config.map(c => {
        const val = settings[c.name] ?? c.default ?? ''
        return (
          <div key={c.name} className="flex items-center gap-2">
            <label className="text-xs text-slate-500 dark:text-slate-400 w-28 shrink-0">{c.description}</label>
            {(c.type === 'selection' || c.type === 'hex16' || c.type === 'hex20') && c.options ? (
              <select className="input text-sm py-0.5" value={val}
                onChange={e => onChange(c.name, parseInt(e.target.value))}>
                {c.options.map(o => (
                  <option key={o.value} value={o.value}>{o.description}</option>
                ))}
              </select>
            ) : c.type === 'binary' ? (
              <input type="checkbox" checked={!!val}
                onChange={e => onChange(c.name, e.target.checked ? 1 : 0)} />
            ) : c.type === 'spinner' ? (
              <input type="number" className="input text-sm py-0.5 w-24"
                min={c.spinner_min} max={c.spinner_max} step={c.spinner_step ?? 1}
                value={val} onChange={e => onChange(c.name, parseInt(e.target.value))} />
            ) : (
              <input type="text" className="input text-sm py-0.5"
                value={val} onChange={e => onChange(c.name, e.target.value)} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function defaultSettings(device: { config?: import('../types').DeviceConfig[] } | undefined): Record<string, number | string> {
  const out: Record<string, number | string> = {}
  for (const c of device?.config ?? []) {
    if (c.default !== undefined) out[c.name] = c.default
    else if (c.default_string !== undefined) out[c.name] = c.default_string
  }
  return out
}

function MemorySlider({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min: number; max: number }) {
  const stops = [64, 128, 256, 512, 640, 1024, 2048, 4096, 8192, 16384, 32768, 65536, 131072, 262144]
  const validStops = stops.filter(s => s >= min && s <= max)
  const safeValue = value ?? min

  const fmtKb = (kb: number) => kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`

  return (
    <div className="space-y-2">
      <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
        <span>{fmtKb(min)}</span>
        <span className="font-medium text-slate-900 dark:text-white">{fmtKb(safeValue)}</span>
        <span>{fmtKb(max)}</span>
      </div>
      <input
        type="range"
        min={0}
        max={validStops.length - 1}
        value={validStops.indexOf(safeValue) === -1 ? 0 : validStops.indexOf(safeValue)}
        onChange={e => onChange(validStops[parseInt(e.target.value)] || min)}
        className="w-full accent-blue-600"
      />
      <div className="flex gap-1 flex-wrap">
        {validStops.filter(s => [640, 1024, 4096, 16384, 65536].includes(s) && s <= max).map(s => (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={clsx(
              'text-xs px-2 py-0.5 rounded border transition-colors',
              safeValue === s
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300 dark:hover:border-slate-600'
            )}
          >
            {s >= 1024 ? `${s / 1024} MB` : `${s} KB`}
          </button>
        ))}
      </div>
    </div>
  )
}

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: 'general',     label: 'General',      icon: Settings2 },
  { id: 'machine',     label: 'Machine',       icon: Cpu },
  { id: 'display',     label: 'Display',       icon: Monitor },
  { id: 'sound',       label: 'Sound',         icon: Volume2 },
  { id: 'network',     label: 'Network',       icon: Network },
  { id: 'controllers', label: 'Controllers',   icon: ServerCog },
  { id: 'disks',       label: 'Hard Disks',    icon: HardDrive },
  { id: 'floppy',      label: 'Floppy Drives', icon: Save },
  { id: 'cdrom',       label: 'CD-ROM Drives', icon: Disc },
  { id: 'ports',       label: 'Ports & Input', icon: UsbIcon },
  { id: 'other',       label: 'Other',         icon: Settings2 },
]

const IDE_CHANNEL_LABELS: Record<string, string> = {
  '0:0': 'Primary Master',   '0:1': 'Primary Slave',
  '1:0': 'Secondary Master', '1:1': 'Secondary Slave',
  '2:0': 'Tertiary Master',  '2:1': 'Tertiary Slave',
  '3:0': 'Quaternary Master','3:1': 'Quaternary Slave',
}

// HDD speed presets are loaded from the hardware API (hw.hdd_speed_presets)
// and grouped by their category field at render time.

// Parses size_mb and bus from a hdd_speed_preset HardwareOption.
// Returns null for generic year-based presets that have no specific model size.
function parseHddPreset(p: HardwareOption): { size: number | null; bus: string } | null {
  const cat = p.category ?? 'Generic'
  let bus: string
  if (cat === 'MFM' || cat === 'RLL') bus = 'mfm'
  else if (cat.startsWith('ATA') || cat.includes('ATA') || cat === 'Generic') bus = 'ide'
  else return null
  const m = p.name.match(/\((\d+(?:\.\d+)?)\s*(MB|GB)\)/i)
  const size = m ? (m[2].toUpperCase() === 'GB' ? Math.round(parseFloat(m[1]) * 1024) : Math.round(parseFloat(m[1]))) : null
  return { size, bus }
}

// 86Box hdd_table: 127 standard CHS presets [cyl, heads, spt]
const HDD_TABLE: [number, number, number][] = [
  [306,4,17],[615,2,17],[306,4,26],[1024,2,17],[697,3,17],[306,8,17],[614,4,17],[615,4,17],
  [670,4,17],[697,4,17],[987,3,17],[820,4,17],[670,5,17],[697,5,17],[733,5,17],[615,6,17],
  [462,8,17],[306,8,26],[615,4,26],[1024,4,17],[855,5,17],[925,5,17],[932,5,17],[1024,2,40],
  [809,6,17],[976,5,17],[977,5,17],[698,7,17],[699,7,17],[981,5,17],[615,8,17],[989,5,17],
  [820,4,26],[1024,5,17],[733,7,17],[754,7,17],[733,5,26],[940,6,17],[615,6,26],[462,8,26],
  [830,7,17],[855,7,17],[751,8,17],[1024,4,26],[918,7,17],[925,7,17],[855,5,26],[977,7,17],
  [987,7,17],[1024,7,17],[823,4,38],[925,8,17],[809,6,26],[976,5,26],[977,5,26],[698,7,26],
  [699,7,26],[940,8,17],[615,8,26],[1024,5,26],[733,7,26],[1024,8,17],[823,10,17],[754,11,17],
  [830,10,17],[925,9,17],[1224,7,17],[940,6,26],[855,7,26],[751,8,26],[1024,9,17],[965,10,17],
  [969,5,34],[980,10,17],[960,5,35],[918,11,17],[1024,10,17],[977,7,26],[1024,7,26],[1024,11,17],
  [940,8,26],[776,8,33],[755,16,17],[1024,12,17],[1024,8,26],[823,10,26],[830,10,26],[925,9,26],
  [960,9,26],[1024,13,17],[1224,11,17],[900,15,17],[969,7,34],[917,15,17],[918,15,17],[1524,4,39],
  [1024,9,26],[1024,14,17],[965,10,26],[980,10,26],[1020,15,17],[1023,15,17],[1024,15,17],[1024,16,17],
  [1224,15,17],[755,16,26],[903,8,46],[984,10,34],[900,15,26],[917,15,26],[1023,15,26],[684,16,38],
  [1930,4,62],[967,16,31],[1013,10,63],[1218,15,36],[654,16,63],[659,16,63],[702,16,63],[1002,13,63],
  [854,16,63],[987,16,63],[995,16,63],[1024,16,63],[1036,16,63],[1120,16,59],[1054,16,63],
]

function calcChsFromSize(sizeMb: number): {cyl: number, heads: number, spt: number} {
  let ts = sizeMb * 2048
  const MAX_TS = 65535 * 16 * 255
  if (ts > MAX_TS) ts = MAX_TS
  let spt: number, heads: number, cth: number
  if (ts >= 65535 * 16 * 63) {
    spt = 255; heads = 16; cth = Math.floor(ts / spt)
  } else {
    spt = 17; cth = Math.floor(ts / spt)
    heads = Math.floor((cth + 1023) / 1024)
    if (heads < 4) heads = 4
    if (cth >= heads * 1024 || heads > 16) { spt = 31; heads = 16; cth = Math.floor(ts / spt) }
    if (cth >= heads * 1024) { spt = 63; heads = 16; cth = Math.floor(ts / spt) }
  }
  return { cyl: Math.floor(cth / heads), heads, spt }
}

function calcSizeFromChs(cyl: number, heads: number, spt: number): number {
  return Math.floor(cyl * heads * spt * 512 / 1048576)
}

function findHddTypeIndex(cyl: number, heads: number, spt: number): number {
  for (let i = 0; i < HDD_TABLE.length; i++) {
    if (HDD_TABLE[i][0] === cyl && HDD_TABLE[i][1] === heads && HDD_TABLE[i][2] === spt) return i
  }
  if (heads === 16 && spt === 63) return 128
  return 127
}

function hddBusLimits(bus: string): {maxCyl: number, maxHeads: number, maxSpt: number} {
  if (bus === 'mfm') return { maxCyl: 2047, maxHeads: 15, maxSpt: 26 }
  if (bus === 'esdi') return { maxCyl: 266305, maxHeads: 16, maxSpt: 99 }
  return { maxCyl: 266305, maxHeads: 255, maxSpt: 255 }
}

export default function VMConfigModal({ vmId, initialConfig, initialName = '', initialDesc = '', initialGroupId, groups, onSave, onClose, title, readOnly = false, initialSharedWith }: Props) {
  const qc = useQueryClient()
  const [activeTab, setActiveTab] = useState<Tab>('general')
  const [name, setName] = useState(initialName)
  const [desc, setDesc] = useState(initialDesc)
  const [groupId, setGroupId] = useState<number | null>(initialGroupId ?? null)
  const [cfg, setCfg] = useState<VMConfig>(initialConfig || defaultConfig())
  const [sharedWith, setSharedWith] = useState<number[]>(initialSharedWith || [])
  const { currentUser } = useStore()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [imagePicker, setImagePicker] = useState<{ key: string; kind: 'floppy' | 'cdrom' } | null>(null)
  const { serverOnline, setActiveUpload, updateUploadProgress } = useStore()
  const { data: users = [] } = useQuery({ 
    queryKey: ['users'], 
    queryFn: userApi.list,
    enabled: !!currentUser?.is_admin 
  })

  const { data: hw } = useQuery({ queryKey: ['hardware'], queryFn: systemApi.hardware })
  const { data: voodooTypes } = useQuery({ queryKey: ['voodoo-types'], queryFn: systemApi.voodooTypes })

  const hddSpeedGroups = useMemo((): [string, HardwareOption[]][] => {
    const map: Record<string, HardwareOption[]> = {}
    for (const p of hw?.hdd_speed_presets ?? []) {
      const cat = p.category ?? 'Other'
      ;(map[cat] = map[cat] ?? []).push(p)
    }
    return Object.entries(map) as [string, HardwareOption[]][]
  }, [hw])
  const { data: mediaFiles = [] } = useQuery({
    queryKey: ['media', vmId],
    queryFn: () => mediaApi.list(vmId!),
    enabled: !!vmId,
  })

  async function handleMediaUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !vmId) return
    const controller = new AbortController()
    uploadAbortRef.current = controller
    setUploading(true)
    setUploadProgress(0)
    setActiveUpload({ filename: file.name, progress: 0, abort: () => controller.abort() })
    try {
      await mediaApi.upload(vmId, file, (pct) => { setUploadProgress(pct); updateUploadProgress(pct) }, controller.signal)
      qc.invalidateQueries({ queryKey: ['media', vmId] })
    } catch (e: any) {
      if (e.name !== 'AbortError') console.error(e)
    } finally {
      setUploading(false)
      setUploadProgress(null)
      setActiveUpload(null)
      uploadAbortRef.current = null
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function handleClose() {
    onClose()
  }

  async function handleMediaDelete(filename: string) {
    if (!vmId) return
    await mediaApi.delete(vmId, filename)
    qc.invalidateQueries({ queryKey: ['media', vmId] })
    // Clear any config references to the deleted file
    const driveKeys: (keyof VMConfig)[] = [
      'fdd_01_fn', 'fdd_02_fn', 'fdd_03_fn', 'fdd_04_fn',
      'cdrom_01_fn', 'cdrom_02_fn', 'cdrom_03_fn', 'cdrom_04_fn',
    ]
    for (const key of driveKeys) {
      if ((cfg[key] as string)?.endsWith('/' + filename)) set(key, '' as any)
    }
  }

  function set<K extends keyof VMConfig>(key: K, val: VMConfig[K]) {
    setCfg(c => ({ ...c, [key]: val }))
  }

  function devSettings(deviceId: string): Record<string, number | string> {
    return cfg.device_settings?.[deviceId] ?? {}
  }

  // Reassign or disable drives whose IDE channel is being removed.
  // Returns a partial cfg patch.
  function _reassignDrivesOffChannel(c: VMConfig, removedChannels: string[]): Partial<VMConfig> {
    const patch: Record<string, unknown> = {}
    const occupied = new Set<string>()
    // Build current channel occupancy from the patched-so-far state
    for (let i = 1; i <= 8; i++) {
      const n = String(i).padStart(2, '0')
      if (c[`hdd_${n}_enabled` as keyof VMConfig] && c[`hdd_${n}_bus` as keyof VMConfig] === 'ide') {
        const ch = c[`hdd_${n}_ide_channel` as keyof VMConfig] as string
        if (!removedChannels.includes(ch)) occupied.add(ch)
      }
    }
    for (let i = 1; i <= 4; i++) {
      const n = String(i).padStart(2, '0')
      if (c[`cdrom_${n}_enabled` as keyof VMConfig] && c[`cdrom_${n}_bus` as keyof VMConfig] === 'ide') {
        const ch = c[`cdrom_${n}_ide_channel` as keyof VMConfig] as string
        if (!removedChannels.includes(ch)) occupied.add(ch)
      }
    }

    // All channels that will remain after removal
    const allChannels = ['0:0', '0:1', '1:0', '1:1']
    if (c.ide_ter_enabled && !removedChannels.includes('2:0')) allChannels.push('2:0', '2:1')
    if (c.ide_qua_enabled && !removedChannels.includes('3:0')) allChannels.push('3:0', '3:1')
    const remaining = allChannels.filter(ch => !removedChannels.includes(ch))

    function nextFree(): string | null {
      const ch = remaining.find(ch => !occupied.has(ch)) ?? null
      if (ch) occupied.add(ch)
      return ch
    }

    // Reassign HDDs on removed channels
    for (let i = 1; i <= 8; i++) {
      const n = String(i).padStart(2, '0')
      if (c[`hdd_${n}_enabled` as keyof VMConfig] && c[`hdd_${n}_bus` as keyof VMConfig] === 'ide') {
        const ch = c[`hdd_${n}_ide_channel` as keyof VMConfig] as string
        if (removedChannels.includes(ch)) {
          const free = nextFree()
          if (free) {
            patch[`hdd_${n}_ide_channel`] = free
          } else {
            patch[`hdd_${n}_enabled`] = false
          }
        }
      }
    }
    // Reassign CD-ROMs on removed channels
    for (let i = 1; i <= 4; i++) {
      const n = String(i).padStart(2, '0')
      if (c[`cdrom_${n}_enabled` as keyof VMConfig] && c[`cdrom_${n}_bus` as keyof VMConfig] === 'ide') {
        const ch = c[`cdrom_${n}_ide_channel` as keyof VMConfig] as string
        if (removedChannels.includes(ch)) {
          const free = nextFree()
          if (free) {
            patch[`cdrom_${n}_ide_channel`] = free
          } else {
            patch[`cdrom_${n}_enabled`] = false
          }
        }
      }
    }
    return patch as Partial<VMConfig>
  }

  function toggleIdeChannel(channel: 'ter' | 'qua', enabled: boolean) {
    setCfg(c => {
      if (enabled) {
        // Enabling 4th also forces 3rd on
        return channel === 'qua'
          ? { ...c, ide_ter_enabled: true, ide_qua_enabled: true }
          : { ...c, ide_ter_enabled: true }
      } else {
        // Disabling 3rd also disables 4th; collect removed channels
        const removedChannels = channel === 'ter'
          ? ['2:0', '2:1', '3:0', '3:1']
          : ['3:0', '3:1']
        const patch = _reassignDrivesOffChannel(c, removedChannels)
        return {
          ...c,
          ...patch,
          ide_ter_enabled: channel === 'ter' ? false : c.ide_ter_enabled,
          ide_qua_enabled: false,
        }
      }
    })
  }

  function setHddController(newId: string) {
    setCfg((c: VMConfig) => {
      // Compute channels provided by old and new controller
      const _nonIde = new Set([
        'none', 'ide_ter', 'ide_qua',
        'st506_xt', 'st506_xt_dtc5150x', 'st506_xt_st11_m', 'st506_xt_st11_r',
        'st506_xt_victor_v86p', 'st506_xt_wd1002a_27x', 'st506_xt_wd1002a_wx1',
        'st506_xt_wd1004_27x', 'st506_xt_wd1004a_27x', 'st506_xt_wd1004a_wx1',
        'st506_xt_gen', 'st506_at', 'esdi_at', 'esdi_mca', 'esdi_integrated_mca',
        'xta_st50x', 'xta_wdxt150',
      ])
      const _primaryOnly = new Set(['ide_isa', 'xtide_at_1ch', 'xtide_at_ps2_1ch'])
      const oldChannels: string[] = _nonIde.has(c.hdd_controller) ? [] :
        _primaryOnly.has(c.hdd_controller) ? ['0:0', '0:1'] : ['0:0', '0:1', '1:0', '1:1']
      const newChannels: string[] = _nonIde.has(newId) ? [] :
        _primaryOnly.has(newId) ? ['0:0', '0:1'] : ['0:0', '0:1', '1:0', '1:1']
      const removedChannels = oldChannels.filter(ch => !newChannels.includes(ch))
      const patch = removedChannels.length > 0 ? _reassignDrivesOffChannel(c, removedChannels) : {}
      return { ...c, ...patch, hdd_controller: newId }
    })
  }

  function setDeviceSettings(deviceId: string, key: string, value: number | string) {
    set('device_settings', {
      ...cfg.device_settings,
      [deviceId]: { ...devSettings(deviceId), [key]: value }
    })
  }

  // When machine changes, reset CPU family to first available for that machine
  useEffect(() => {
    if (!hw) return
    const cpus = hw.cpu_families[cfg.machine] || []
    if (cpus.length > 0 && !cpus.find(c => c.id === cfg.cpu_family)) {
      set('cpu_family', cpus[0].id)
      set('cpu_speed', 0)
    }
  }, [cfg.machine, hw])  // eslint-disable-line react-hooks/exhaustive-deps

  // When CPU family changes, clamp speed index to valid range
  useEffect(() => {
    if (!hw) return
    const speeds = hw.cpu_speeds[cfg.cpu_family] || []
    if (speeds.length > 0 && (cfg.cpu_speed < 0 || cfg.cpu_speed >= speeds.length)) {
      set('cpu_speed', speeds.length - 1)
    }
  }, [cfg.cpu_family, hw])  // eslint-disable-line react-hooks/exhaustive-deps

  // Current machine metadata
  const currentMachine = hw?.machines.find(m => m.id === cfg.machine)
  const machineBusFlags = currentMachine?.bus_flags ?? 0
  const machineRamMin = currentMachine?.ram_min ?? 64
  const machineRamMax = currentMachine?.ram_max ?? 524288

  // Returns true if a card is compatible with the current machine (bus_flags 0 = always show)
  const busCompat = (card: { bus_flags?: number }) =>
    !card.bus_flags || (card.bus_flags & machineBusFlags) !== 0

  // When machine changes, reset gfxcard if it's incompatible, and clamp RAM to machine limits
  useEffect(() => {
    if (!hw) return
    const compatCards = hw.video_cards.filter(busCompat)
    if (compatCards.length > 0 && !compatCards.find(c => c.id === cfg.gfxcard)) {
      set('gfxcard', compatCards[0].id)
    }
    const mach = hw.machines.find(m => m.id === cfg.machine)
    if (mach) {
      const ramMin = mach.ram_min ?? 64
      const ramMax = mach.ram_max ?? 524288
      if (cfg.mem_size == null || cfg.mem_size < ramMin) set('mem_size', ramMin)
      else if (cfg.mem_size > ramMax) set('mem_size', ramMax)
    }
  }, [cfg.machine, hw])  // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize device settings with defaults when a device is selected
  useEffect(() => {
    if (!hw) return
    const device = hw.sound_cards.find(c => c.id === cfg.sndcard)
    if (device?.config && !cfg.device_settings?.[cfg.sndcard]) {
      set('device_settings', { ...cfg.device_settings, [cfg.sndcard]: defaultSettings(device) })
    }
  }, [cfg.sndcard, hw])

  useEffect(() => {
    if (!hw) return
    const device = hw.video_cards.find(c => c.id === cfg.gfxcard)
    if (device?.config && !cfg.device_settings?.[cfg.gfxcard]) {
      set('device_settings', { ...cfg.device_settings, [cfg.gfxcard]: defaultSettings(device) })
    }
  }, [cfg.gfxcard, hw])

  useEffect(() => {
    if (!hw) return
    const device = hw.network_cards.find(c => c.id === cfg.net_card)
    if (device?.config && !cfg.device_settings?.[cfg.net_card]) {
      set('device_settings', { ...cfg.device_settings, [cfg.net_card]: defaultSettings(device) })
    }
  }, [cfg.net_card, hw])

  useEffect(() => {
    if (!hw) return
    const device = hw.hdd_controllers.find(c => c.id === cfg.hdd_controller)
    if (device?.config && !cfg.device_settings?.[cfg.hdd_controller]) {
      set('device_settings', { ...cfg.device_settings, [cfg.hdd_controller]: defaultSettings(device) })
    }
  }, [cfg.hdd_controller, hw])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hw) return
    const device = hw.scsi_cards.find(c => c.id === cfg.scsi_card)
    if (device?.config && !cfg.device_settings?.[cfg.scsi_card]) {
      set('device_settings', { ...cfg.device_settings, [cfg.scsi_card]: defaultSettings(device) })
    }
  }, [cfg.scsi_card, hw])  // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!hw) return
    const device = hw.isartc_types.find(c => c.id === cfg.isartc_type)
    if (device?.config && !cfg.device_settings?.[cfg.isartc_type]) {
      set('device_settings', { ...cfg.device_settings, [cfg.isartc_type]: defaultSettings(device) })
    }
  }, [cfg.isartc_type, hw])  // eslint-disable-line react-hooks/exhaustive-deps

  // Normalize IDE channel assignments on load: if a drive has a channel that's no longer
  // available (e.g. tertiary IDE was disabled after saving), reassign it to a free channel.
  useEffect(() => {
    if (!hw) return
    const _nonIde = new Set([
      'none', 'ide_ter', 'ide_qua',
      'st506_xt', 'st506_xt_dtc5150x', 'st506_xt_st11_m', 'st506_xt_st11_r',
      'st506_xt_victor_v86p', 'st506_xt_wd1002a_27x', 'st506_xt_wd1002a_wx1',
      'st506_xt_wd1004_27x', 'st506_xt_wd1004a_27x', 'st506_xt_wd1004a_wx1',
      'st506_xt_gen', 'st506_at', 'esdi_at', 'esdi_mca', 'esdi_integrated_mca',
      'xta_st50x', 'xta_wdxt150',
    ])
    const _primaryOnly = new Set(['ide_isa', 'xtide_at_1ch', 'xtide_at_ps2_1ch'])
    const avail: string[] = []
    if (!_nonIde.has(cfg.hdd_controller)) {
      avail.push('0:0', '0:1')
      if (!_primaryOnly.has(cfg.hdd_controller)) avail.push('1:0', '1:1')
    }
    if (cfg.ide_ter_enabled) avail.push('2:0', '2:1')
    if (cfg.ide_qua_enabled) avail.push('3:0', '3:1')

    const invalid: string[] = []
    for (let i = 1; i <= 8; i++) {
      const n = String(i).padStart(2, '0')
      if (cfg[`hdd_${n}_enabled` as keyof VMConfig] && cfg[`hdd_${n}_bus` as keyof VMConfig] === 'ide') {
        const ch = cfg[`hdd_${n}_ide_channel` as keyof VMConfig] as string
        if (!avail.includes(ch) && !invalid.includes(ch)) invalid.push(ch)
      }
    }
    for (let i = 1; i <= 4; i++) {
      const n = String(i).padStart(2, '0')
      if (cfg[`cdrom_${n}_enabled` as keyof VMConfig]) {
        const ch = cfg[`cdrom_${n}_ide_channel` as keyof VMConfig] as string
        if (!avail.includes(ch) && !invalid.includes(ch)) invalid.push(ch)
      }
    }
    if (invalid.length > 0) {
      setCfg((c: VMConfig) => ({ ...c, ..._reassignDrivesOffChannel(c, invalid) }))
    }
  }, [!!hw])  // eslint-disable-line react-hooks/exhaustive-deps

  // Get available CPUs for current machine
  const availableCPUs = hw?.cpu_families[cfg.machine] ?? []

  // Get available speed names for current CPU family (index = VMConfig.cpu_speed)
  const availableSpeeds = hw?.cpu_speeds[cfg.cpu_family] ?? []

  const groupNetworking = groups.find(g => g.id === groupId)?.network_enabled ?? false

  const compatVideoCards     = withBusGroups(hw?.video_cards.filter(busCompat)     ?? [])
  const compatSoundCards     = withBusGroups(hw?.sound_cards.filter(busCompat)     ?? [])
  const compatNetworkCards   = withBusGroups(hw?.network_cards.filter(busCompat)   ?? [])
  const compatHddControllers = withBusGroups((hw?.hdd_controllers ?? []).filter(busCompat).filter((c: HardwareOption) => c.id !== 'ide_ter' && c.id !== 'ide_qua'))
  const compatScsiCards      = withBusGroups(hw?.scsi_cards.filter(busCompat)      ?? [])
  const compatFdcCards       = withBusGroups(hw?.fdc_cards?.filter(busCompat)      ?? [])
  const compatIsartcTypes    = withBusGroups(hw?.isartc_types.filter(busCompat)    ?? [])
  const compatIsamemTypes    = withBusGroups(hw?.isamem_types?.filter(busCompat)   ?? [])

  // ── Channel map (drives tab + cdrom tab + floating indicators) ────────────
  // Controllers that only provide the primary channel (0:0 / 0:1)
  const PRIMARY_ONLY_HDCS = new Set(['ide_isa', 'xtide_at_1ch', 'xtide_at_ps2_1ch'])
  // Non-IDE controllers (MFM/ESDI/XTA) — IDE channels come from a separate ide_isa etc.
  // Also includes ide_ter/ide_qua which are expansion-only and managed via the 3rd/4th toggles.
  const NON_IDE_HDCS = new Set([
    'none',
    'ide_ter', 'ide_qua',
    'st506_xt', 'st506_xt_dtc5150x', 'st506_xt_st11_m', 'st506_xt_st11_r',
    'st506_xt_victor_v86p', 'st506_xt_wd1002a_27x', 'st506_xt_wd1002a_wx1',
    'st506_xt_wd1004_27x', 'st506_xt_wd1004a_27x', 'st506_xt_wd1004a_wx1',
    'st506_xt_gen', 'st506_at',
    'esdi_at', 'esdi_mca', 'esdi_integrated_mca',
    'xta_st50x', 'xta_wdxt150',
  ])
  const hdcId = cfg.hdd_controller
  const availableIdeChannels: string[] = []
  if (!NON_IDE_HDCS.has(hdcId)) {
    availableIdeChannels.push('0:0', '0:1')
    if (!PRIMARY_ONLY_HDCS.has(hdcId)) availableIdeChannels.push('1:0', '1:1')
  }
  if (cfg.ide_ter_enabled) availableIdeChannels.push('2:0', '2:1')
  if (cfg.ide_qua_enabled) availableIdeChannels.push('3:0', '3:1')

  const channelMap: Record<string, string> = {}
  for (let ci = 1; ci <= 8; ci++) {
    const cn = String(ci).padStart(2, '0')
    if ((cfg[`hdd_${cn}_enabled` as keyof VMConfig] as boolean) && (cfg[`hdd_${cn}_bus` as keyof VMConfig] as string) === 'ide') {
      const ch = cfg[`hdd_${cn}_ide_channel` as keyof VMConfig] as string
      if (ch) channelMap[ch] = `HDD ${ci}`
    }
  }
  for (let ci = 1; ci <= 4; ci++) {
    const cn = String(ci).padStart(2, '0')
    if (cfg[`cdrom_${cn}_enabled` as keyof VMConfig] as boolean) {
      const ch = cfg[`cdrom_${cn}_ide_channel` as keyof VMConfig] as string
      if (ch) channelMap[ch] = `CD-ROM ${ci}`
    }
  }

  // Controller type detection (determines which bus types are valid for HDDs)
  const isMfmController  = hdcId.startsWith('st506') || hdcId.startsWith('xta')
  const isEsdiController = hdcId.startsWith('esdi')
  const scsiAvailable    = cfg.scsi_card !== 'none'

  async function handleSave() {
    if (!name.trim()) { setError('VM name is required'); return }
    setSaving(true)
    setError('')
    try {
      await onSave(name, desc, groupId, cfg, sharedWith)
      onClose()
    } catch (e: any) {
      setError(e.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl">
        {/* Floating IDE/SCSI channel indicators — right edge of modal, flush with header bottom */}
        {(activeTab === 'controllers' || activeTab === 'disks' || activeTab === 'cdrom') && hw && (
          <div className="absolute -right-36 top-[57px] flex flex-col gap-2 z-10">
            {availableIdeChannels.map(ch => {
              const occupant = channelMap[ch]
              return (
                <div key={ch} className={clsx('px-3 py-1.5 rounded-lg w-32', occupant ? 'bg-amber-100 dark:bg-amber-900/50' : 'bg-emerald-100 dark:bg-emerald-900/50')}>
                  <div className={clsx('text-[10px] font-medium leading-tight', occupant ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300')}>{IDE_CHANNEL_LABELS[ch]}</div>
                  <div className={clsx('text-xs font-bold leading-tight mt-0.5', occupant ? 'text-amber-900 dark:text-amber-100' : 'text-emerald-900 dark:text-emerald-100')}>{occupant || 'Free'}</div>
                </div>
              )
            })}
            {scsiAvailable && (
              <div className="px-3 py-1.5 rounded-lg w-32 bg-blue-100 dark:bg-blue-900/50">
                <div className="text-[10px] font-medium leading-tight text-blue-700 dark:text-blue-300">SCSI</div>
                <div className="text-xs font-bold leading-tight mt-0.5 text-blue-900 dark:text-blue-100">Available</div>
              </div>
            )}
          </div>
        )}
      <div className="h-[85vh] card flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={handleClose} className="btn-ghost p-1.5 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar tabs */}
          <div className="w-44 flex-shrink-0 border-r border-slate-200 dark:border-slate-800 py-3 px-2 space-y-0.5 overflow-y-auto">
            {TABS.map(tab => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left',
                    activeTab === tab.id
                      ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-400 font-medium'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  )}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {tab.label}
                </button>
              )
            })}
          </div>

          {/* Tab content */}
          <fieldset disabled={readOnly || !serverOnline} className="flex-1 min-w-0 border-0 p-0 m-0 overflow-hidden flex flex-col">
          <DisabledCtx.Provider value={readOnly || !serverOnline}>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">

            {/* ── General ─────────────────────────────────────────────── */}
            {activeTab === 'general' && (
              <>
                <FieldGroup label="Identity">
                  <Field label="VM Name">
                    <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="My 486 PC" />
                  </Field>
                  <Field label="Description">
                    <input className="input" value={desc} onChange={e => setDesc(e.target.value)} placeholder="Optional description" />
                  </Field>
                  <Field label="Group">
                    <div className="flex items-center gap-2">
                      {groupId && (() => { const g = groups.find(g => g.id === groupId); return g ? <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: g.color }} /> : null })()}
                      <select className="input flex-1" value={groupId ?? ''} onChange={e => setGroupId(e.target.value ? parseInt(e.target.value) : null)}>
                        <option value="">No group</option>
                        {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>
                    {(() => { const g = groups.find(g => g.id === groupId); return g?.network_enabled ? (
                      <p className="text-xs text-blue-500 dark:text-blue-400 mt-1 flex items-center gap-1"><Network className="w-3 h-3" />Networking enabled — VMs in this group share a private LAN</p>
                    ) : g && !g.network_enabled ? (
                      <p className="text-xs text-slate-400 mt-1">No networking — VMs in this group are isolated</p>
                    ) : null })()}
                  </Field>
                  <FieldGroup label="Sharing">
                  <Field label="Shared with user" hint="Select users who can access this VM">
                    {(() => {
                      const selectedGroup = groups.find(g => g.id === groupId);
                      const isGroupShared = selectedGroup && selectedGroup.shared_with_user_ids && selectedGroup.shared_with_user_ids.length > 0;
                      const effectiveSharedWith = isGroupShared ? selectedGroup.shared_with_user_ids! : sharedWith;

                      if (isGroupShared) {
                        return (
                          <div className="space-y-3">
                            <p className="text-xs text-amber-500 dark:text-amber-400 font-medium">
                              Permissions are inherited from the group "{selectedGroup.name}". 
                              To assign specific permissions, remove this VM from the group first.
                            </p>
                            <div className="flex flex-wrap gap-2 opacity-60 pointer-events-none">
                              {users.filter(u => effectiveSharedWith.includes(u.id)).map(u => (
                                <span key={u.id} className="inline-flex items-center gap-1.5 bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2.5 py-1 rounded-md text-sm font-medium">
                                  {u.username}
                                </span>
                              ))}
                            </div>
                          </div>
                        );
                      }

                      if (!currentUser?.is_admin) {
                        return <p className="text-xs text-slate-500 mt-2">Only Admins can share VMs.</p>;
                      }

                      return (
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
                            {sharedWith.length === 0 && <span className="text-sm text-slate-500 italic">Not shared with any user.</span>}
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
                      );
                    })()}
                  </Field>
                </FieldGroup>
                </FieldGroup>
              </>
            )}

            {/* ── Machine ─────────────────────────────────────────────── */}
            {activeTab === 'machine' && hw && (
              <>
                <FieldGroup label="System">
                  <Field label="Machine" hint="System board / chipset">
                    <Select
                      value={cfg.machine}
                      onChange={v => set('machine', v)}
                      options={hw.machines}
                      grouped
                    />
                  </Field>
                  <Field label="CPU" hint="Processor family">
                    <select className="input" value={cfg.cpu_family} onChange={e => set('cpu_family', e.target.value)}>
                      {availableCPUs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      {availableCPUs.length === 0 && <option value={cfg.cpu_family}>{cfg.cpu_family}</option>}
                    </select>
                  </Field>
                  <Field label="CPU Speed">
                    {availableSpeeds.length > 0 ? (
                      <div className="space-y-2">
                        <div className="flex justify-between text-xs text-slate-500 dark:text-slate-400">
                          <span>{availableSpeeds[0]} MHz</span>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {availableSpeeds[cfg.cpu_speed] ?? availableSpeeds[0]} MHz
                          </span>
                          <span>{availableSpeeds[availableSpeeds.length - 1]} MHz</span>
                        </div>
                        <input
                          type="range"
                          min={0}
                          max={availableSpeeds.length - 1}
                          value={Math.min(cfg.cpu_speed, availableSpeeds.length - 1)}
                          onChange={e => set('cpu_speed', parseInt(e.target.value))}
                          className="w-full accent-blue-600"
                        />
                        <div className="flex flex-wrap gap-1">
                          {availableSpeeds.map((s, idx) => (
                            <button
                              key={idx}
                              onClick={() => set('cpu_speed', idx)}
                              className={clsx(
                                'text-xs px-2 py-0.5 rounded border transition-colors',
                                cfg.cpu_speed === idx
                                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
                                  : 'border-slate-200 dark:border-slate-700 text-slate-500 hover:border-slate-300'
                              )}
                            >
                              {s} MHz
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">Select a CPU family first</span>
                    )}
                  </Field>
                </FieldGroup>
                <FieldGroup label="Processor">
                  <Field label="Dynamic Recompiler" hint="Faster emulation for 486+">
                    <Toggle disabled={readOnly} value={cfg.cpu_use_dynarec} onChange={v => set('cpu_use_dynarec', v)} label="Enable" />
                  </Field>
                  <Field label="Wait States" hint="CPU bus wait cycles">
                    <input type="number" min={0} max={15} className="input w-24" value={cfg.cpu_waitstates} onChange={e => set('cpu_waitstates', parseInt(e.target.value))} />
                  </Field>
                  <Field label="FPU">
                    <select className="input" value={cfg.fpu_type} onChange={e => set('fpu_type', e.target.value)}>
                      <option value="none">None</option>
                      <option value="builtin">Built-in</option>
                      <option value="8087">8087</option>
                      <option value="287">287</option>
                      <option value="387">387</option>
                    </select>
                  </Field>
                  <Field label="Soft-float FPU" hint="Software FPU emulation">
                    <Toggle disabled={readOnly} value={cfg.fpu_softfloat} onChange={v => set('fpu_softfloat', v)} />
                  </Field>
                </FieldGroup>
                <FieldGroup label="Memory">
                  <Field label="RAM" hint="System memory">
                    <MemorySlider
                      value={cfg.mem_size}
                      onChange={v => set('mem_size', v)}
                      min={machineRamMin}
                      max={machineRamMax}
                    />
                  </Field>
                </FieldGroup>
                <FieldGroup label="Clock">
                  <Field label="Time Sync">
                    <select className="input w-40" value={cfg.time_sync} onChange={e => set('time_sync', e.target.value)}>
                      <option value="disabled">Disabled</option>
                      <option value="local">Local Time</option>
                      <option value="utc">UTC</option>
                    </select>
                  </Field>
                </FieldGroup>
              </>
            )}

            {/* ── Display ─────────────────────────────────────────────── */}
            {activeTab === 'display' && hw && (
              <>
                <FieldGroup label="Video Card">
                  <Field label="Video Card">
                    <Select value={cfg.gfxcard} onChange={v => set('gfxcard', v)} options={compatVideoCards} grouped />
                    <DeviceSettings
                      device={hw?.video_cards.find(c => c.id === cfg.gfxcard)}
                      settings={devSettings(cfg.gfxcard)}
                      onChange={(k, v) => setDeviceSettings(cfg.gfxcard, k, v)}
                    />
                  </Field>
                  <Field label="Secondary Monitors" hint="Show dual monitor support">
                    <Toggle disabled={readOnly} value={cfg.show_second_monitors} onChange={v => set('show_second_monitors', v)} />
                  </Field>
                </FieldGroup>
                <FieldGroup label="3dfx Voodoo">
                  <Field label="Voodoo Card" hint="Add Voodoo 3D accelerator">
                    <Toggle disabled={readOnly} value={cfg.voodoo_enabled} onChange={v => set('voodoo_enabled', v)} label="Enable Voodoo" />
                  </Field>
                  {cfg.voodoo_enabled && voodooTypes && (
                    <Field label="Voodoo Type">
                      <select className="input" value={cfg.voodoo_type} onChange={e => set('voodoo_type', e.target.value)}>
                        {voodooTypes.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                    </Field>
                  )}
                </FieldGroup>
              </>
            )}

            {/* ── Sound ───────────────────────────────────────────────── */}
            {activeTab === 'sound' && hw && (
              <>
                <FieldGroup label="Audio">
                  <Field label="Sound Card">
                    <Select value={cfg.sndcard} onChange={v => set('sndcard', v)} options={compatSoundCards} grouped />
                    <DeviceSettings
                      device={hw?.sound_cards.find(c => c.id === cfg.sndcard)}
                      settings={devSettings(cfg.sndcard)}
                      onChange={(k, v) => setDeviceSettings(cfg.sndcard, k, v)}
                    />
                  </Field>
                  <Field label="FM Driver" hint="OPL synthesizer accuracy vs. speed">
                    <select className="input w-48" value={cfg.fm_driver} onChange={e => set('fm_driver', e.target.value)}>
                      <option value="nuked">Nuked OPL (accurate)</option>
                      <option value="ymfm">YMFM (faster)</option>
                    </select>
                  </Field>
                  <Field label="Float Audio" hint="32-bit float mixing (higher quality)">
                    <Toggle disabled={readOnly} value={cfg.sound_is_float} onChange={v => set('sound_is_float', v)} />
                  </Field>
                </FieldGroup>
                <FieldGroup label="MIDI">
                  <Field label="MIDI Output">
                    <Select value={cfg.midi_device} onChange={v => set('midi_device', v)} options={hw.midi_devices} />
                  </Field>
                  <Field label="Standalone MPU-401" hint="Add MPU-401 without a sound card">
                    <Toggle disabled={readOnly} value={cfg.mpu401_standalone_enable} onChange={v => set('mpu401_standalone_enable', v)} />
                  </Field>
                </FieldGroup>
              </>
            )}

            {/* ── Network ─────────────────────────────────────────────── */}
            {activeTab === 'network' && hw && (
              <>
                <FieldGroup label="Network Card">
                  <Field label="Network Card">
                    <Select value={cfg.net_card} onChange={v => set('net_card', v)} options={compatNetworkCards} grouped />
                    <DeviceSettings
                      device={hw?.network_cards.find(c => c.id === cfg.net_card)}
                      settings={devSettings(cfg.net_card)}
                      onChange={(k, v) => setDeviceSettings(cfg.net_card, k, v)}
                    />
                  </Field>
                  {cfg.net_card !== 'none' && (
                    <>
                      {groupNetworking && (
                        <Field label="Use Group Network" hint="Connect this adapter to the group's private LAN bridge">
                          <Toggle value={cfg.net_use_group ?? true} onChange={v => set('net_use_group', v)} />
                        </Field>
                      )}
                      {groupNetworking && (cfg.net_use_group ?? true) && (
                        <p className="text-xs text-blue-500 dark:text-blue-400 flex items-center gap-1">
                          <Network className="w-3 h-3 flex-shrink-0" />
                          Adapter will connect to the group bridge via TAP at start time — slirp/pcap settings are ignored.
                        </p>
                      )}
                      {(!groupNetworking || !(cfg.net_use_group ?? true)) && (
                        <>
                          <Field label="Network Type" hint="How the VM connects to the network">
                            <select className="input w-48" value={cfg.net_type} onChange={e => set('net_type', e.target.value)}>
                              <option value="slirp">SLiRP (NAT) — recommended</option>
                              <option value="pcap">PCap (bridged)</option>
                              <option value="vde">VDE</option>
                            </select>
                          </Field>
                          {cfg.net_type === 'pcap' && (
                            <Field label="Host Device" hint="Network interface to bridge to">
                              <input className="input" value={cfg.net_host_dev} onChange={(e: React.ChangeEvent<HTMLInputElement>) => set('net_host_dev', e.target.value)} placeholder="eth0" />
                            </Field>
                          )}
                        </>
                      )}
                    </>
                  )}
                </FieldGroup>
              </>
            )}

            {/* ── Controllers ─────────────────────────────────────────── */}
            {activeTab === 'controllers' && hw && (
              <>
                <FieldGroup label="Hard Disk Controller">
                  <Field label="HDC Controller" hint="Primary hard disk controller">
                    <Select value={cfg.hdd_controller} onChange={setHddController} options={compatHddControllers} grouped />
                    <DeviceSettings
                      device={hw?.hdd_controllers.find(c => c.id === cfg.hdd_controller)}
                      settings={devSettings(cfg.hdd_controller)}
                      onChange={(k, v) => setDeviceSettings(cfg.hdd_controller, k, v)}
                    />
                  </Field>
                  <Field label="3rd IDE Channel" hint="Enables tertiary IDE (channels 2:0 / 2:1)">
                    <Toggle disabled={readOnly} value={cfg.ide_ter_enabled} onChange={v => toggleIdeChannel('ter', v)} />
                  </Field>
                  <Field label="4th IDE Channel" hint="Enables quaternary IDE (channels 3:0 / 3:1); requires 3rd">
                    <Toggle disabled={readOnly} value={cfg.ide_qua_enabled} onChange={v => toggleIdeChannel('qua', v)} />
                  </Field>
                </FieldGroup>

                <FieldGroup label="SCSI">
                  <Field label="SCSI Card">
                    <Select
                      value={cfg.scsi_card}
                      onChange={v => set('scsi_card', v)}
                      options={[
                        { id: 'none', name: 'None' },
                        ...compatScsiCards.filter(c => c.id !== 'none'),
                      ]}
                      grouped
                    />
                    <DeviceSettings
                      device={hw?.scsi_cards.find(c => c.id === cfg.scsi_card)}
                      settings={devSettings(cfg.scsi_card)}
                      onChange={(k, v) => setDeviceSettings(cfg.scsi_card, k, v)}
                    />
                  </Field>
                </FieldGroup>

                <FieldGroup label="Floppy Controller">
                  <Field label="FDC Card" hint="Add-in floppy controller (most machines have built-in)">
                    <Select
                      value={cfg.fdc_card}
                      onChange={v => set('fdc_card', v)}
                      options={[
                        { id: 'none', name: 'None (use built-in)' },
                        ...compatFdcCards.filter(c => c.id !== 'none'),
                      ]}
                      grouped
                    />
                  </Field>
                </FieldGroup>
              </>
            )}

            {/* ── Hard Disks ───────────────────────────────────────────── */}
            {activeTab === 'disks' && hw && (() => {
              const enabledSlots = [1,2,3,4,5,6,7,8].filter(i => {
                const n = String(i).padStart(2, '0')
                return cfg[`hdd_${n}_enabled` as keyof VMConfig] as boolean
              })
              const nextFreeSlot = [1,2,3,4,5,6,7,8].find(i => {
                const n = String(i).padStart(2, '0')
                return !(cfg[`hdd_${n}_enabled` as keyof VMConfig] as boolean)
              })
              return (
                <FieldGroup label="Hard Disks">
                  {enabledSlots.length === 0 && (
                    <p className="text-sm text-slate-400 italic">No hard disks configured. Click &ldquo;Add Hard Disk&rdquo; to get started.</p>
                  )}
                  {enabledSlots.map(i => {
                    const n = String(i).padStart(2, '0')
                    const bus = cfg[`hdd_${n}_bus` as keyof VMConfig] as string
                    const size = cfg[`hdd_${n}_size_mb` as keyof VMConfig] as number
                    const speed = cfg[`hdd_${n}_speed` as keyof VMConfig] as string
                    const ideChannel = cfg[`hdd_${n}_ide_channel` as keyof VMConfig] as string
                    const freeChannels = availableIdeChannels.filter(ch => !channelMap[ch] || channelMap[ch] === `HDD ${i}`)
                    // Only offer buses valid for the current controller
                    const busOptions = [
                      ...(!isMfmController && !isEsdiController ? [{ v: 'ide',  l: 'IDE'     }] : []),
                      ...(isMfmController                        ? [{ v: 'mfm',  l: 'MFM/RLL' }] : []),
                      ...(isEsdiController                       ? [{ v: 'esdi', l: 'ESDI'    }] : []),
                      ...(scsiAvailable                          ? [{ v: 'scsi', l: 'SCSI'    }] : []),
                    ]
                    const rawCyl = cfg[`hdd_${n}_cylinders` as keyof VMConfig] as number | null
                    const rawHds = cfg[`hdd_${n}_heads` as keyof VMConfig] as number | null
                    const rawSpt = cfg[`hdd_${n}_spt` as keyof VMConfig] as number | null
                    const chs = (rawCyl && rawHds && rawSpt) ? {cyl: rawCyl, heads: rawHds, spt: rawSpt} : calcChsFromSize(size)
                    const cyl = chs.cyl, hds = chs.heads, spt = chs.spt
                    const typeIndex = findHddTypeIndex(cyl, hds, spt)
                    const limits = hddBusLimits(bus)
                    const sizeMb = calcSizeFromChs(cyl, hds, spt)
                    return (
                      <div key={i} className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Hard Disk {i}</span>
                          {!readOnly && (
                            <button
                              onClick={() => set(`hdd_${n}_enabled` as any, false)}
                              className="p-1 text-slate-400 hover:text-red-500 transition-colors"
                              title="Remove this disk"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                        <div className="space-y-3">
                          {/* Type dropdown */}
                          <div>
                            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Type (CHS Preset)</label>
                            <select className="input text-xs" disabled={readOnly} value={typeIndex} onChange={e => {
                              const idx = parseInt(e.target.value)
                              if (idx < 127) {
                                const [c, h, s] = HDD_TABLE[idx]
                                set(`hdd_${n}_cylinders` as any, c)
                                set(`hdd_${n}_heads` as any, h)
                                set(`hdd_${n}_spt` as any, s)
                                set(`hdd_${n}_size_mb` as any, calcSizeFromChs(c, h, s))
                              } else if (idx === 128) {
                                set(`hdd_${n}_heads` as any, 16)
                                set(`hdd_${n}_spt` as any, 63)
                                set(`hdd_${n}_size_mb` as any, calcSizeFromChs(cyl, 16, 63))
                              }
                            }}>
                              {HDD_TABLE.map(([c, h, s], idx) => {
                                const mb = calcSizeFromChs(c, h, s)
                                return <option key={idx} value={idx}>{mb} MB (CHS: {c}, {h}, {s})</option>
                              })}
                              <option value={127}>Custom…</option>
                              <option value={128}>Custom (large)…</option>
                            </select>
                          </div>
                          {/* CHS + Size row */}
                          <div className="grid grid-cols-4 gap-2">
                            <div>
                              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Cylinders</label>
                              <input type="number" min={1} max={limits.maxCyl} className="input text-xs" disabled={readOnly}
                                value={cyl}
                                onChange={e => {
                                  const v = Math.min(parseInt(e.target.value) || 1, limits.maxCyl)
                                  set(`hdd_${n}_cylinders` as any, v)
                                  set(`hdd_${n}_size_mb` as any, calcSizeFromChs(v, hds, spt))
                                }} />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Heads</label>
                              <input type="number" min={1} max={limits.maxHeads} className="input text-xs" disabled={readOnly}
                                value={hds}
                                onChange={e => {
                                  const v = Math.min(parseInt(e.target.value) || 1, limits.maxHeads)
                                  set(`hdd_${n}_heads` as any, v)
                                  set(`hdd_${n}_size_mb` as any, calcSizeFromChs(cyl, v, spt))
                                }} />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Sectors/Track</label>
                              <input type="number" min={1} max={limits.maxSpt} className="input text-xs" disabled={readOnly}
                                value={spt}
                                onChange={e => {
                                  const v = Math.min(parseInt(e.target.value) || 1, limits.maxSpt)
                                  set(`hdd_${n}_spt` as any, v)
                                  set(`hdd_${n}_size_mb` as any, calcSizeFromChs(cyl, hds, v))
                                }} />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Size (MB)</label>
                              <input type="number" min={1} max={131072} className="input text-xs" disabled={readOnly}
                                value={sizeMb}
                                onChange={e => {
                                  const mb = Math.max(1, parseInt(e.target.value) || 1)
                                  const chsNew = calcChsFromSize(mb)
                                  set(`hdd_${n}_cylinders` as any, chsNew.cyl)
                                  set(`hdd_${n}_heads` as any, chsNew.heads)
                                  set(`hdd_${n}_spt` as any, chsNew.spt)
                                  set(`hdd_${n}_size_mb` as any, mb)
                                }} />
                            </div>
                          </div>
                          {/* Bus + Channel row */}
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Bus</label>
                              <select className="input text-xs" disabled={readOnly} value={bus} onChange={e => set(`hdd_${n}_bus` as any, e.target.value)}>
                                {busOptions.map(b => <option key={b.v} value={b.v}>{b.l}</option>)}
                              </select>
                            </div>
                            {bus === 'ide' && (
                              <div>
                                <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">IDE Channel</label>
                                {freeChannels.length === 0 ? (
                                  <p className="text-xs text-red-500 mt-2">No free IDE channels — enable more via Controllers tab.</p>
                                ) : (
                                  <select className="input text-xs" disabled={readOnly} value={freeChannels.includes(ideChannel) ? ideChannel : freeChannels[0]} onChange={e => set(`hdd_${n}_ide_channel` as any, e.target.value)}>
                                    {freeChannels.map(ch => <option key={ch} value={ch}>{IDE_CHANNEL_LABELS[ch]} ({ch})</option>)}
                                  </select>
                                )}
                              </div>
                            )}
                          </div>
                          {/* Speed/Model row */}
                          <div>
                            <label className="text-xs text-slate-500 dark:text-slate-400 mb-1 block">Model / Speed Era</label>
                            <select className="input text-xs" disabled={readOnly} value={speed} onChange={e => {
                              const id = e.target.value
                              set(`hdd_${n}_speed` as any, id)
                              const preset = hw?.hdd_speed_presets.find(p => p.id === id)
                              if (!preset) return
                              const parsed = parseHddPreset(preset)
                              if (!parsed) return
                              if (busOptions.some(b => b.v === parsed.bus)) set(`hdd_${n}_bus` as any, parsed.bus)
                            }}>
                              {hddSpeedGroups.map(([cat, presets]: [string, HardwareOption[]]) => (
                                <optgroup key={cat} label={cat}>
                                  {presets.map((p: HardwareOption) => <option key={p.id} value={p.id}>{p.name}</option>)}
                                </optgroup>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                  {!readOnly && nextFreeSlot && (
                    <button
                      onClick={() => {
                        const n = String(nextFreeSlot).padStart(2, '0')
                        set(`hdd_${n}_enabled` as any, true)
                      }}
                      className="btn-secondary w-full justify-center"
                    >
                      <Plus className="w-4 h-4" />
                      Add Hard Disk
                    </button>
                  )}
                  {!nextFreeSlot && (
                    <p className="text-xs text-slate-400 italic text-center">Maximum of 8 hard disks reached.</p>
                  )}
                </FieldGroup>
              )
            })()}

            {/* ── Floppy Drives ────────────────────────────────────────── */}
            {activeTab === 'floppy' && hw && (
              <>
                <FieldGroup label="Drives">
                  {([1, 2, 3, 4] as const).map(i => {
                    const n = `0${i}` as '01' | '02' | '03' | '04'
                    const type = cfg[`fdd_${n}_type` as keyof VMConfig] as string
                    const fn = cfg[`fdd_${n}_fn` as keyof VMConfig] as string
                    const prevN = i > 1 ? `0${i - 1}` : null
                    const prevEnabled = prevN ? (cfg[`fdd_${prevN}_type` as keyof VMConfig] as string) !== 'none' : true
                    return (
                      <div key={i} className="space-y-2">
                        <Field label={`Drive ${i}`}>
                          <Select
                            value={type}
                            disabled={readOnly || !prevEnabled}
                            onChange={v => {
                              set(`fdd_${n}_type` as any, v)
                              // If disabling this drive, also clear subsequent drives
                              if (v === 'none') {
                                for (let j = i + 1; j <= 4; j++) {
                                  const jn = `0${j}`
                                  set(`fdd_${jn}_type` as any, 'none')
                                  set(`fdd_${jn}_fn` as any, '')
                                }
                              }
                            }}
                            options={hw.floppy_types}
                          />
                        </Field>
                        {type !== 'none' && (
                          <Field label="" hint="">
                            <div className="flex gap-2 flex-wrap items-center">
                              <Toggle disabled={readOnly} value={cfg[`fdd_${n}_turbo` as keyof VMConfig] as boolean} onChange={v => set(`fdd_${n}_turbo` as any, v)} label="Turbo" />
                              <Toggle disabled={readOnly} value={cfg[`fdd_${n}_check_bpb` as keyof VMConfig] as boolean} onChange={v => set(`fdd_${n}_check_bpb` as any, v)} label="Check BPB" />
                            </div>
                          </Field>
                        )}
                        {type !== 'none' && vmId && (
                          <Field label="Image" hint="Floppy image to mount at startup">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => !readOnly && setImagePicker({ key: `fdd_${n}_fn`, kind: 'floppy' })}
                                disabled={readOnly}
                                className="btn-secondary text-xs flex-1 justify-start font-mono truncate"
                                title={fn || 'No image selected'}
                              >
                                <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                <span className="truncate">{fn ? fn.split('/').pop() : '— No image —'}</span>
                              </button>
                              {fn && !readOnly && (
                                <button onClick={() => set(`fdd_${n}_fn` as any, '')} className="btn-ghost p-1.5 text-slate-400 hover:text-red-500" title="Eject">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </Field>
                        )}
                      </div>
                    )
                  })}
                </FieldGroup>

                {vmId && (
                  <FieldGroup label="Media Files">
                    <div className="space-y-2">
                      {mediaFiles.filter(f => /\.(img|ima|vfd|flp)$/i.test(f.name)).map(f => (
                        <div key={f.name} className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <span className="font-mono text-slate-700 dark:text-slate-300 truncate flex-1">{f.name}</span>
                          <span className="text-xs text-slate-400 ml-3 flex-shrink-0">{formatBytes(f.size)}</span>
                          <button onClick={() => handleMediaDelete(f.name)} className="ml-2 p-1 text-red-400 hover:text-red-600 flex-shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {mediaFiles.filter(f => /\.(img|ima|vfd|flp)$/i.test(f.name)).length === 0 && (
                        <p className="text-xs text-slate-400 italic">No floppy images uploaded.</p>
                      )}
                      <div className="pt-1 space-y-2">
                        <input ref={fileInputRef} type="file" className="hidden"
                          accept=".001,.002,.003,.004,.005,.006,.007,.008,.009,.010,.12,.144,.360,.720,.86f,.bin,.cq,.cqm,.ddi,.dsk,.fdi,.fdf,.flp,.hdm,.ima,.imd,.img,.json,.mfm,.td0,.vfd,.xdf"
                          onChange={handleMediaUpload} />
                        <div className="flex items-center gap-3">
                          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-secondary text-xs">
                            <Upload className="w-3.5 h-3.5" />
                            {uploading ? 'Uploading…' : 'Upload Floppy Image'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </FieldGroup>
                )}
              </>
            )}

            {/* ── CD-ROM Drives ────────────────────────────────────────── */}
            {activeTab === 'cdrom' && hw && (
              <>
                <FieldGroup label="Drives">
                  {([1, 2, 3, 4] as const).map(i => {
                    const n = `0${i}` as '01' | '02' | '03' | '04'
                    const enabled = cfg[`cdrom_${n}_enabled` as keyof VMConfig] as boolean
                    const speed = cfg[`cdrom_${n}_speed` as keyof VMConfig] as number
                    const driveType = cfg[`cdrom_${n}_drive_type` as keyof VMConfig] as string
                    const fn = cfg[`cdrom_${n}_fn` as keyof VMConfig] as string
                    const ideCh = cfg[`cdrom_${n}_ide_channel` as keyof VMConfig] as string
                    const freeChannels = availableIdeChannels.filter(ch => !channelMap[ch] || channelMap[ch] === `CD-ROM ${i}`)
                    const prevCdN = i > 1 ? `0${i - 1}` : null
                    const prevCdEnabled = prevCdN ? (cfg[`cdrom_${prevCdN}_enabled` as keyof VMConfig] as boolean) : true
                    return (
                      <div key={i} className="p-4 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">CD-ROM Drive {i}</span>
                          <Toggle
                            disabled={readOnly || !prevCdEnabled}
                            value={enabled}
                            onChange={v => {
                              set(`cdrom_${n}_enabled` as any, v)
                              // If disabling, also disable subsequent drives
                              if (!v) {
                                for (let j = i + 1; j <= 4; j++) {
                                  const jn = `0${j}`
                                  set(`cdrom_${jn}_enabled` as any, false)
                                  set(`cdrom_${jn}_fn` as any, '')
                                }
                              }
                            }}
                            label="Enable"
                          />
                        </div>
                        {enabled && (
                          <>
                            <Field label="Drive Model" hint="Emulated drive identity reported to the OS">
                              <select className="input text-xs" disabled={readOnly} value={driveType} onChange={e => {
                                const sel = hw?.cdrom_drive_types.find(d => d.id === e.target.value)
                                set(`cdrom_${n}_drive_type` as any, e.target.value)
                                if (sel && sel.id) {
                                  // Auto-set speed from the drive's rated speed if it embeds "(Nx)" in the name
                                  const m = sel.name.match(/\((\d+)x\)/)
                                  if (m) set(`cdrom_${n}_speed` as any, parseInt(m[1]))
                                }
                              }}>
                                <option value="">— 86Box default —</option>
                                {hw?.cdrom_drive_types.map(d => (
                                  <option key={d.id} value={d.id}>{d.name}</option>
                                ))}
                              </select>
                            </Field>
                            <Field label="IDE Channel" hint="Avoid conflicts with HDDs">
                              {freeChannels.length === 0 ? (
                                <p className="text-xs text-red-500">No free IDE channels — enable more via Controllers tab or remove another drive.</p>
                              ) : (
                                <select className="input" disabled={readOnly} value={freeChannels.includes(ideCh) ? ideCh : freeChannels[0]} onChange={e => set(`cdrom_${n}_ide_channel` as any, e.target.value)}>
                                  {freeChannels.map(ch => (
                                    <option key={ch} value={ch}>{IDE_CHANNEL_LABELS[ch]} ({ch})</option>
                                  ))}
                                </select>
                              )}
                            </Field>
                            <Field label="Speed" hint="Override rated speed (ignored when a specific drive model is selected)">
                              <div className="flex items-center gap-3">
                                <input type="range" min={1} max={72} value={speed} onChange={e => set(`cdrom_${n}_speed` as any, parseInt(e.target.value))} className="flex-1 accent-blue-600" />
                                <span className="text-sm text-slate-700 dark:text-slate-300 w-12 text-right tabular-nums">{speed}×</span>
                              </div>
                            </Field>
                            {vmId && (
                              <Field label="ISO Image" hint="CD/DVD image to mount at startup">
                                <div className="flex items-center gap-2">
                                  <button
                                    onClick={() => !readOnly && setImagePicker({ key: `cdrom_${n}_fn`, kind: 'cdrom' })}
                                    disabled={readOnly}
                                    className="btn-secondary text-xs flex-1 justify-start font-mono truncate"
                                    title={fn || 'No image selected'}
                                  >
                                    <FolderOpen className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{fn ? fn.split('/').pop() : '— No image —'}</span>
                                  </button>
                                  {fn && !readOnly && (
                                    <button onClick={() => set(`cdrom_${n}_fn` as any, '')} className="btn-ghost p-1.5 text-slate-400 hover:text-red-500" title="Eject">
                                      <X className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </Field>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </FieldGroup>

                {vmId && (
                  <FieldGroup label="ISO / Disc Images">
                    <div className="space-y-2">
                      {mediaFiles.filter(f => /\.(iso|bin|cue)$/i.test(f.name)).map(f => (
                        <div key={f.name} className="flex items-center justify-between text-sm py-1.5 px-2 rounded hover:bg-slate-50 dark:hover:bg-slate-800/50">
                          <span className="font-mono text-slate-700 dark:text-slate-300 truncate flex-1">{f.name}</span>
                          <span className="text-xs text-slate-400 ml-3 flex-shrink-0">{formatBytes(f.size)}</span>
                          <button onClick={() => handleMediaDelete(f.name)} className="ml-2 p-1 text-red-400 hover:text-red-600 flex-shrink-0">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                      {mediaFiles.filter(f => /\.(iso|bin|cue)$/i.test(f.name)).length === 0 && (
                        <p className="text-xs text-slate-400 italic">No ISO images uploaded.</p>
                      )}
                      <div className="pt-1 space-y-2">
                        <input ref={fileInputRef} type="file" className="hidden"
                          accept=".iso,.bin,.img,.cue,.mds,.mdx,.viso"
                          onChange={handleMediaUpload} />
                        <div className="flex items-center gap-3">
                          <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="btn-secondary text-xs">
                            <Upload className="w-3.5 h-3.5" />
                            {uploading ? 'Uploading…' : 'Upload ISO Image'}
                          </button>
                          {uploading && uploadProgress !== null && (
                            <div className="flex items-center gap-1.5 text-slate-400">
                              <div className="w-24 h-1.5 rounded-full overflow-hidden bg-slate-200 dark:bg-slate-700">
                                <div className="h-full bg-blue-500 rounded-full transition-all duration-150" style={{ width: `${uploadProgress}%` }} />
                              </div>
                              <span className="text-xs tabular-nums">{uploadProgress}%</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </FieldGroup>
                )}
              </>
            )}

            {/* ── Ports & Input ────────────────────────────────────────── */}
            {activeTab === 'ports' && hw && (
              <>
                <FieldGroup label="Mouse">
                  <Field label="Mouse Type">
                    <Select value={cfg.mouse_type} onChange={v => set('mouse_type', v)} options={hw.mouse_types} />
                  </Field>
                </FieldGroup>
                <FieldGroup label="Joystick">
                  <Field label="Joystick">
                    <Select value={cfg.joystick_type} onChange={v => set('joystick_type', v)} options={hw.joystick_types} />
                  </Field>
                </FieldGroup>
                <FieldGroup label="Keyboard">
                  <Field label="Keyboard Type">
                    <select className="input" value={cfg.keyboard_type} onChange={e => set('keyboard_type', e.target.value)}>
                      <option value="keyboard_pc_xt">PC/XT Keyboard</option>
                      <option value="keyboard_at">AT Keyboard</option>
                      <option value="keyboard_mf2">MF2 (101/102 key)</option>
                      <option value="keyboard_mf2_jp">MF2 Japanese</option>
                      <option value="keyboard_ps2">PS/2 Keyboard</option>
                    </select>
                  </Field>
                </FieldGroup>
                <FieldGroup label="COM Ports">
                  {([1, 2, 3, 4] as const).map(i => (
                    <Field key={i} label={`COM${i}`}>
                      <Toggle
                        value={cfg[`com_${i}_enabled` as keyof VMConfig] as boolean}
                        onChange={v => set(`com_${i}_enabled` as any, v)}
                        label="Enable"
                      />
                    </Field>
                  ))}
                </FieldGroup>
                <FieldGroup label="LPT Ports">
                  {([1, 2, 3] as const).map(i => (
                    <Field key={i} label={`LPT${i}`}>
                      <Toggle
                        value={cfg[`lpt_${i}_enabled` as keyof VMConfig] as boolean}
                        onChange={v => set(`lpt_${i}_enabled` as any, v)}
                        label="Enable"
                      />
                    </Field>
                  ))}
                </FieldGroup>
              </>
            )}

            {/* ── Other ─────────────────────────────────────────────── */}
            {activeTab === 'other' && hw && (
              <>
                <FieldGroup label="ISA RTC">
                  <Field label="ISA RTC Card">
                    <Select value={cfg.isartc_type} onChange={v => set('isartc_type', v)} options={[{id:'none',name:'None'},...compatIsartcTypes.filter(c=>c.id!=='none')]} grouped />
                    <DeviceSettings
                      device={hw?.isartc_types.find(c => c.id === cfg.isartc_type)}
                      settings={devSettings(cfg.isartc_type)}
                      onChange={(k, v) => setDeviceSettings(cfg.isartc_type, k, v)}
                    />
                  </Field>
                </FieldGroup>
                <FieldGroup label="ISA Memory Expansion">
                  {([1, 2] as const).map(slot => (
                    <div key={slot} className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 space-y-3">
                      <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Slot {slot}</span>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-xs text-slate-500 mb-1 block">Base Address (hex)</label>
                          <input type="number" min={0} step={16384} className="input text-xs"
                            value={cfg[`isamem_${slot}_base` as keyof VMConfig] as number}
                            onChange={e => set(`isamem_${slot}_base` as any, parseInt(e.target.value) || 0)} />
                        </div>
                        <div>
                          <label className="text-xs text-slate-500 mb-1 block">Size (KB)</label>
                          <select className="input text-xs"
                            value={cfg[`isamem_${slot}_size` as keyof VMConfig] as number}
                            onChange={e => set(`isamem_${slot}_size` as any, parseInt(e.target.value))}>
                            <option value={0}>Disabled</option>
                            <option value={64}>64 KB</option>
                            <option value={128}>128 KB</option>
                            <option value={256}>256 KB</option>
                            <option value={512}>512 KB</option>
                            <option value={1024}>1 MB</option>
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                </FieldGroup>
                <FieldGroup label="VNC">
                  <Field label="VNC Password" hint="Leave blank for no password">
                    <input
                      type="password"
                      className="input"
                      value={cfg.vnc_password}
                      onChange={e => set('vnc_password', e.target.value)}
                      placeholder="Optional VNC password"
                      autoComplete="new-password"
                    />
                  </Field>
                </FieldGroup>
              </>
            )}
          </div>
          </DisabledCtx.Provider>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200 dark:border-slate-800 flex-shrink-0">
          {!serverOnline
            ? <p className="text-xs text-red-500 dark:text-red-400 flex items-center gap-1.5"><CloudOff className="w-3.5 h-3.5" />Server unreachable — settings are read-only</p>
            : readOnly
              ? <p className="text-xs text-amber-600 dark:text-amber-400">Settings are read-only while the VM is running</p>
              : error && <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          }
          <div className="flex items-center gap-3 ml-auto">
            {readOnly || !serverOnline ? (
              <button onClick={handleClose} className="btn-primary">Close</button>
            ) : (
              <>
                <button onClick={handleClose} className="btn-secondary">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="btn-primary">
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      </div>{/* end positioning wrapper */}

      {imagePicker && (
        <ImagePickerModal
          kind={imagePicker.kind}
          currentPath={cfg[imagePicker.key as keyof VMConfig] as string}
          onSelect={path => set(imagePicker.key as any, path)}
          onClear={() => set(imagePicker.key as any, '')}
          onClose={() => setImagePicker(null)}
        />
      )}
    </div>,
    document.body
  )
}

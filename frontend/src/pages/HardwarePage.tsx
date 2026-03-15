import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Search, ChevronRight, Cpu, Monitor, Volume2, Network, HardDrive, Mouse, CloudOff, Disc, ServerCog } from 'lucide-react'
import { systemApi } from '../lib/api'
import { withBusGroups, busLabel, BUS_SLOTS } from '../lib/busGroups'
import { HardwareOption, HardwareLists } from '../types'
import { useStore } from '../store/useStore'

// ─── Bus helpers ──────────────────────────────────────────────────────────────

function busLabels(flags: number): string[] {
  if (!flags) return []
  return BUS_SLOTS.filter(([mask]) => flags & mask).map(([, label]) => label)
}

function formatRam(kb: number): string {
  if (kb >= 1024 * 1024) return `${kb / 1024 / 1024} GB`
  if (kb >= 1024) return `${kb / 1024} MB`
  return `${kb} KB`
}

// ─── Category config ──────────────────────────────────────────────────────────

type Category = 'machines' | 'video' | 'sound' | 'network' | 'controllers' | 'harddrives' | 'optical' | 'input'

const CATEGORIES: { id: Category; label: string; Icon: any }[] = [
  { id: 'machines',    label: 'Machines',     Icon: Cpu },
  { id: 'video',       label: 'Video Cards',  Icon: Monitor },
  { id: 'sound',       label: 'Sound Cards',  Icon: Volume2 },
  { id: 'network',     label: 'Network Cards', Icon: Network },
  { id: 'controllers', label: 'Controllers',  Icon: ServerCog },
  { id: 'harddrives',  label: 'Hard Drives',  Icon: HardDrive },
  { id: 'optical',     label: 'Optical Drives', Icon: Disc },
  { id: 'input',       label: 'Input Devices', Icon: Mouse },
]

function getItems(hw: HardwareLists, voodooTypes: { id: string; name: string }[], cat: Category): HardwareOption[] {
  switch (cat) {
    case 'machines':
      return hw.machines
    case 'video':
      return [
        ...withBusGroups(hw.video_cards),
        ...voodooTypes.map(v => ({ ...v, category: '3dfx Voodoo', bus_flags: 0x00080000 })),
      ]
    case 'sound':
      return [
        ...withBusGroups(hw.sound_cards.filter(s => s.id !== 'none')),
        ...hw.midi_devices.filter(m => m.id !== 'none').map(m => ({ ...m, category: 'MIDI' })),
      ]
    case 'network':
      return withBusGroups(hw.network_cards.filter(n => n.id !== 'none'))
    case 'controllers':
      return [
        ...hw.hdd_controllers.map(h => ({ ...h, category: 'HDD Controllers' })),
        ...hw.scsi_cards.filter(s => s.id !== 'none').map(s => ({ ...s, category: 'SCSI Cards' })),
        ...(hw.fdc_cards ?? []).filter(f => f.id !== 'none').map(f => ({ ...f, category: 'FDC Cards' })),
      ]
    case 'harddrives':
      return (hw.hdd_speed_presets ?? []).map(h => ({ ...h, category: h.category ?? 'Generic' }))
    case 'optical':
      return (hw.cdrom_drive_types ?? []).map(d => ({
        ...d,
        category: d.is_dvd ? 'DVD' : 'CD-ROM',
      }))
    case 'input':
      return [
        ...hw.mouse_types.filter(m => m.id !== 'none').map(m => ({ ...m, category: 'Mouse' })),
        ...hw.joystick_types.filter(j => j.id !== 'none').map(j => ({ ...j, category: 'Joystick' })),
      ]
  }
}

// ─── Pill badge ───────────────────────────────────────────────────────────────

function Pill({ label, color = 'slate' }: { label: string; color?: 'blue' | 'purple' | 'green' | 'amber' | 'slate' }) {
  const cls = {
    blue:   'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300',
    purple: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300',
    green:  'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300',
    amber:  'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    slate:  'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300',
  }[color]
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded ${cls}`}>
      {label}
    </span>
  )
}

function busPillColor(bus: string): 'blue' | 'purple' | 'green' | 'amber' | 'slate' {
  if (bus.includes('PCI')) return 'blue'
  if (bus.includes('AGP')) return 'purple'
  if (bus.includes('ISA')) return 'green'
  if (bus.includes('MCA') || bus.includes('EISA') || bus.includes('VL')) return 'amber'
  return 'slate'
}

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-2">
        {title}
      </p>
      {children}
    </div>
  )
}

function CompatSection({ title, items }: { title: string; items: HardwareOption[] }) {
  if (!items.length) return null
  return (
    <Section title={`${title} (${items.length})`}>
      <div className="space-y-0.5 max-h-52 overflow-y-auto pr-1">
        {items.map(item => (
          <div key={item.id} className="flex items-baseline gap-2 py-0.5">
            <span className="text-xs text-slate-700 dark:text-slate-300 leading-snug">{item.name}</span>
            {item.category && (
              <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">{item.category}</span>
            )}
          </div>
        ))}
      </div>
    </Section>
  )
}

// ─── Detail panel — Machine ───────────────────────────────────────────────────

function MachineDetail({
  machine, hw, machineCpuMap, allVideo, allSound, allNetwork,
}: {
  machine: HardwareOption
  hw: HardwareLists
  machineCpuMap: Record<string, string>
  allVideo: HardwareOption[]
  allSound: HardwareOption[]
  allNetwork: HardwareOption[]
}) {
  const buses = busLabels(machine.bus_flags ?? 0)
  const mFlags = machine.bus_flags ?? 0

  const cpuFamilies: HardwareOption[] = useMemo(() => {
    if (hw.cpu_families[machine.id]) return hw.cpu_families[machine.id]
    const key = machineCpuMap[machine.id]
    return key ? (hw.cpu_families[key] ?? []) : []
  }, [machine.id])

  const compatVideo   = useMemo(() => allVideo.filter(v => !v.bus_flags || (mFlags & v.bus_flags)), [mFlags])
  const compatSound   = useMemo(() => allSound.filter(s => !s.bus_flags || (mFlags & s.bus_flags)), [mFlags])
  const compatNetwork = useMemo(() => allNetwork.filter(n => !n.bus_flags || (mFlags & n.bus_flags)), [mFlags])

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{machine.name}</h2>
        <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">{machine.id}</p>
        {machine.category && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{machine.category}</p>
        )}
      </div>

      {(machine.ram_min !== undefined || machine.ram_max !== undefined) && (
        <Section title="Memory">
          <div className="flex gap-6 text-sm text-slate-600 dark:text-slate-300">
            {machine.ram_min !== undefined && (
              <span>Min: <span className="font-mono">{formatRam(machine.ram_min)}</span></span>
            )}
            {machine.ram_max !== undefined && (
              <span>Max: <span className="font-mono">{formatRam(machine.ram_max)}</span></span>
            )}
          </div>
        </Section>
      )}

      {buses.length > 0 && (
        <Section title="Expansion Buses">
          <div className="flex flex-wrap gap-1.5">
            {buses.map(b => <Pill key={b} label={b} color={busPillColor(b)} />)}
          </div>
        </Section>
      )}

      {cpuFamilies.length > 0 && (
        <Section title="CPU Families">
          <div className="space-y-2.5">
            {cpuFamilies.map(cpu => {
              const speeds = hw.cpu_speeds[cpu.id] ?? []
              return (
                <div key={cpu.id}>
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-300">{cpu.name}</p>
                  {speeds.length > 0 && (
                    <p className="text-[10px] font-mono text-slate-400 dark:text-slate-500 mt-0.5 leading-relaxed">
                      {speeds.join(' · ')} MHz
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}

      <CompatSection title="Video Cards" items={compatVideo} />
      <CompatSection title="Sound Cards" items={compatSound} />
      <CompatSection title="Network Cards" items={compatNetwork} />
    </div>
  )
}

// ─── Detail panel — Component ─────────────────────────────────────────────────

function ComponentDetail({ item, hw }: { item: HardwareOption; hw: HardwareLists }) {
  const itemFlags = item.bus_flags ?? 0

  const compatMachines = useMemo(() =>
    itemFlags ? hw.machines.filter(m => (m.bus_flags ?? 0) & itemFlags) : [],
  [itemFlags])

  // Split config entries by type for distinct rendering
  const selectionConfigs = useMemo(() =>
    (item.config ?? []).filter(c => (c.type === 'selection' || c.type === 'hex16') && c.options?.length),
  [item.config])

  const binaryConfigs = useMemo(() =>
    (item.config ?? []).filter(c => c.type === 'binary'),
  [item.config])

  const spinnerConfigs = useMemo(() =>
    (item.config ?? []).filter(c =>
      (c.type === 'spinner' || c.type === 'int' || c.type === 'memory') &&
      (c.spinner_min !== undefined || c.spinner_max !== undefined)
    ),
  [item.config])

  // HDD preset technical specs
  const hddRpm = item.rpm ?? null
  const hddFullStroke = item.full_stroke_ms ?? null
  const hddTrackSeek = item.track_seek_ms ?? null
  const hddHeads = item.heads ?? null
  const hddSpt = item.avg_spt ?? null
  const hasHddSpecs = hddRpm || hddFullStroke || hddTrackSeek

  // Optical drive specs
  const driveSpeedX = item.speed_x ?? null

  return (
    <div className="h-full overflow-y-auto p-5 space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">{item.name}</h2>
        <p className="text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">{item.id}</p>
        {item.category && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{item.category}</p>
        )}
      </div>

      {/* Bus interface */}
      {itemFlags > 0 && (
        <Section title="Interface">
          <Pill label={busLabel(itemFlags)} color={busPillColor(busLabel(itemFlags))} />
        </Section>
      )}

      {/* Optical drive speed */}
      {driveSpeedX && (
        <Section title="Drive Specifications">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            <span className="text-xs text-slate-500 dark:text-slate-400">Speed</span>
            <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{driveSpeedX}x</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">Type</span>
            <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{item.is_dvd ? 'DVD-ROM' : 'CD-ROM'}</span>
          </div>
        </Section>
      )}

      {/* HDD technical specs */}
      {hasHddSpecs && (
        <Section title="Drive Specifications">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {hddRpm && (
              <>
                <span className="text-xs text-slate-500 dark:text-slate-400">Rotation</span>
                <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{hddRpm.toLocaleString()} RPM</span>
              </>
            )}
            {hddFullStroke && (
              <>
                <span className="text-xs text-slate-500 dark:text-slate-400">Full stroke seek</span>
                <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{hddFullStroke} ms</span>
              </>
            )}
            {hddTrackSeek && (
              <>
                <span className="text-xs text-slate-500 dark:text-slate-400">Track-to-track seek</span>
                <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{hddTrackSeek} ms</span>
              </>
            )}
            {hddHeads && (
              <>
                <span className="text-xs text-slate-500 dark:text-slate-400">Heads</span>
                <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{hddHeads}</span>
              </>
            )}
            {hddSpt && (
              <>
                <span className="text-xs text-slate-500 dark:text-slate-400">Avg sectors/track</span>
                <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{hddSpt}</span>
              </>
            )}
          </div>
        </Section>
      )}

      {/* Selection / address config options */}
      {selectionConfigs.length > 0 && (
        <Section title="Configuration">
          <div className="space-y-4">
            {selectionConfigs.map((c, i) => (
              <div key={i}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1.5">
                  {c.description || c.name}
                </p>
                <div className="flex flex-wrap gap-1">
                  {c.options!.map((opt, j) => {
                    const isDefault = opt.value === c.default
                    return (
                      <span
                        key={j}
                        className={`text-[11px] px-2 py-0.5 rounded ${
                          isDefault
                            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {opt.description}
                        {isDefault && <span className="ml-1 opacity-60 text-[9px]">default</span>}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Spinner / numeric range options */}
      {spinnerConfigs.length > 0 && (
        <Section title={spinnerConfigs.length === 1 ? (spinnerConfigs[0].description || spinnerConfigs[0].name) : 'Numeric Options'}>
          <div className="space-y-1.5">
            {spinnerConfigs.map((c, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
                {spinnerConfigs.length > 1 && (
                  <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">{c.description || c.name}</span>
                )}
                <span className="text-xs font-mono text-slate-600 dark:text-slate-400">
                  {c.spinner_min} – {c.spinner_max}
                  {c.spinner_step && c.spinner_step !== 1 ? ` (step ${c.spinner_step})` : ''}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Binary toggles */}
      {binaryConfigs.length > 0 && (
        <Section title="Optional Features">
          <div className="flex flex-wrap gap-1.5">
            {binaryConfigs.map((c, i) => (
              <span
                key={i}
                className={`text-[11px] px-2 py-0.5 rounded ${
                  c.default === 1
                    ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                }`}
              >
                {c.description || c.name}
              </span>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1.5">
            Green = enabled by default
          </p>
        </Section>
      )}

      {/* Compatible machines */}
      {compatMachines.length > 0 && (
        <Section title={`Compatible Machines (${compatMachines.length})`}>
          <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1">
            {compatMachines.map(m => (
              <div key={m.id} className="flex items-baseline gap-2 py-0.5">
                <span className="text-xs text-slate-700 dark:text-slate-300">{m.name}</span>
                <span className="text-[10px] font-mono text-slate-400 dark:text-slate-600">{m.id}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Fallback for devices with no extra data */}
      {!itemFlags && !hasHddSpecs && !selectionConfigs.length && !spinnerConfigs.length && !binaryConfigs.length && !compatMachines.length && (
        <p className="text-xs text-slate-400 dark:text-slate-600 italic">No additional details available.</p>
      )}
    </div>
  )
}

// ─── Subcategory list ─────────────────────────────────────────────────────────

function SubcatList({
  subcats, counts, selectedSubcat, onSelect,
}: {
  subcats: string[]
  counts: Record<string, number>
  selectedSubcat: string | null
  onSelect: (subcat: string) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto py-1">
      {subcats.map(cat => (
        <button
          key={cat}
          onClick={() => onSelect(cat)}
          className={`w-full text-left px-3 py-2 flex items-center justify-between gap-1 transition-colors border-b border-slate-100/60 dark:border-slate-800/40 ${
            selectedSubcat === cat
              ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500'
              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
          }`}
        >
          <span className={`text-xs font-medium leading-snug truncate ${
            selectedSubcat === cat ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300'
          }`}>
            {cat}
          </span>
          <span className="text-[10px] font-mono text-slate-400 dark:text-slate-500 flex-shrink-0">
            {counts[cat] ?? 0}
          </span>
        </button>
      ))}
    </div>
  )
}

// ─── Column list ──────────────────────────────────────────────────────────────

function ColumnList({
  items, selectedId, onSelect, searchQuery, onSearchChange,
}: {
  items: HardwareOption[]
  selectedId: string | null
  onSelect: (item: HardwareOption) => void
  searchQuery: string
  onSearchChange: (q: string) => void
}) {
  const filtered = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return q ? items.filter(i => i.name.toLowerCase().includes(q) || i.id.toLowerCase().includes(q)) : items
  }, [items, searchQuery])

  const groups = useMemo(() => {
    const map = new Map<string, HardwareOption[]>()
    for (const item of filtered) {
      const cat = item.category ?? ''
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(item)
    }
    return map
  }, [filtered])

  const hasCategories = useMemo(() => {
    const cats = new Set(filtered.map(i => i.category ?? '').filter(Boolean))
    return cats.size > 1
  }, [filtered])

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 p-2 border-b border-slate-200 dark:border-slate-800">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search…"
            className="w-full pl-7 pr-2 py-1.5 text-xs bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <p className="text-[10px] text-slate-400 dark:text-slate-600 mt-1 pl-0.5">
          {filtered.length} of {items.length}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto">
        {hasCategories ? (
          Array.from(groups.entries()).map(([cat, catItems]) => (
            <div key={cat}>
              {cat && (
                <div className="sticky top-0 px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-600 bg-slate-50 dark:bg-[#0d0d14] border-b border-slate-100 dark:border-slate-800/50 z-10">
                  {cat} <span className="font-mono font-normal normal-case">({catItems.length})</span>
                </div>
              )}
              {catItems.map(item => (
                <ListRow key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} />
              ))}
            </div>
          ))
        ) : (
          filtered.map(item => (
            <ListRow key={item.id} item={item} selected={item.id === selectedId} onSelect={onSelect} />
          ))
        )}
        {filtered.length === 0 && (
          <p className="px-3 py-8 text-xs text-slate-400 dark:text-slate-600 text-center">No results</p>
        )}
      </div>
    </div>
  )
}

function ResizeHandle({ onMouseDown }: { onMouseDown: (e: { preventDefault(): void; clientX: number }) => void }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className="w-[4px] flex-shrink-0 cursor-col-resize group relative hover:bg-blue-400/20 dark:hover:bg-blue-500/20 transition-colors"
    >
      <div className="absolute inset-y-0 left-[1.5px] w-px bg-slate-200 dark:bg-slate-800 group-hover:bg-blue-400 dark:group-hover:bg-blue-500 transition-colors" />
    </div>
  )
}

function ListRow({ item, selected, onSelect }: {
  item: HardwareOption; selected: boolean; onSelect: (item: HardwareOption) => void
}) {
  return (
    <button
      onClick={() => onSelect(item)}
      className={`w-full text-left px-3 py-2 flex items-center justify-between gap-1 transition-colors border-b border-slate-100/60 dark:border-slate-800/40 ${
        selected
          ? 'bg-blue-50 dark:bg-blue-900/20 border-l-2 border-l-blue-500'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-medium leading-snug truncate ${selected ? 'text-blue-700 dark:text-blue-300' : 'text-slate-800 dark:text-slate-200'}`}>
          {item.name}
        </p>
        <p className="text-[10px] font-mono text-slate-400 dark:text-slate-600 mt-0.5 truncate">{item.id}</p>
      </div>
      {selected && <ChevronRight className="w-3 h-3 text-blue-400 flex-shrink-0" />}
    </button>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HardwarePage() {
  const { serverOnline } = useStore()
  const [category, setCategory] = useState<Category>('machines')
  const [selectedSubcat, setSelectedSubcat] = useState<string | null>(null)
  const [selectedItem, setSelectedItem] = useState<HardwareOption | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  const [col1Width, setCol1Width] = useState(160)
  const [col2Width, setCol2Width] = useState(192)
  const [col3Width, setCol3Width] = useState(240)

  const startDrag = useCallback((
    e: { preventDefault(): void; clientX: number },
    currentWidth: number,
    setWidth: (w: number) => void,
    min: number,
    max: number,
  ) => {
    e.preventDefault()
    const startX = e.clientX
    const onMove = (ev: MouseEvent) =>
      setWidth(Math.min(max, Math.max(min, currentWidth + ev.clientX - startX)))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const { data: hw, isLoading } = useQuery({
    queryKey: ['hardware'],
    queryFn: systemApi.hardware,
    staleTime: 5 * 60_000,
  })

  const { data: machineCpuMap = {} } = useQuery({
    queryKey: ['machine-cpu-map'],
    queryFn: systemApi.machineCpuMap,
    staleTime: 5 * 60_000,
  })

  const { data: voodooTypes = [] } = useQuery({
    queryKey: ['voodoo-types'],
    queryFn: systemApi.voodooTypes,
    staleTime: 5 * 60_000,
  })

  const allVideo   = useMemo(() => hw ? getItems(hw, voodooTypes, 'video')   : [], [hw, voodooTypes])
  const allSound   = useMemo(() => hw ? getItems(hw, voodooTypes, 'sound')   : [], [hw, voodooTypes])
  const allNetwork = useMemo(() => hw ? getItems(hw, voodooTypes, 'network') : [], [hw, voodooTypes])
  const items      = useMemo(() => hw ? getItems(hw, voodooTypes, category)  : [], [hw, voodooTypes, category])

  // Derive ordered subcategories and counts from the full item list
  const { subcats, subcatCounts } = useMemo(() => {
    const seen = new Set<string>()
    const subcats: string[] = []
    const subcatCounts: Record<string, number> = {}
    for (const item of items) {
      const cat = item.category ?? ''
      if (!cat) continue
      if (!seen.has(cat)) { seen.add(cat); subcats.push(cat) }
      subcatCounts[cat] = (subcatCounts[cat] ?? 0) + 1
    }
    return { subcats, subcatCounts }
  }, [items])

  const hasSubcats = subcats.length > 1

  const visibleItems = useMemo(() =>
    hasSubcats && selectedSubcat ? items.filter(i => i.category === selectedSubcat) : items,
  [items, selectedSubcat, hasSubcats])

  function handleCategoryChange(cat: Category) {
    setCategory(cat)
    setSelectedSubcat(null)
    setSelectedItem(null)
    setSearchQuery('')
  }

  function handleSubcatChange(subcat: string) {
    setSelectedSubcat(subcat)
    setSelectedItem(null)
    setSearchQuery('')
  }

  if (!serverOnline) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-400">
        <CloudOff className="w-8 h-8 opacity-40" />
        <p className="text-sm font-medium">Server unavailable</p>
        <p className="text-xs text-slate-500">Waiting to reconnect…</p>
      </div>
    )
  }

  if (isLoading || !hw) {
    return (
      <div className="flex h-full items-center justify-center text-slate-400">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        Loading database…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0a0a0f]">
      {/* Page header */}
      <div className="flex-shrink-0 px-6 py-6 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Database Explorer</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Browse 86Box hardware: machines, CPUs, and compatible devices
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">

      {/* Column 1: Category */}
      <div className="flex-shrink-0 flex flex-col bg-white dark:bg-slate-900" style={{ width: col1Width }}>
        <div className="px-3 py-3 border-b border-slate-200 dark:border-slate-800">
          <p className="text-[10px] text-slate-400 dark:text-slate-600 uppercase tracking-wider font-semibold">
            {hw.machines.length} machines
          </p>
        </div>
        <nav className="flex-1 py-2 space-y-0.5 px-2 overflow-y-auto">
          {CATEGORIES.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => handleCategoryChange(id)}
              className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-left text-xs font-medium transition-colors ${
                category === id
                  ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="truncate">{label}</span>
              <span className="ml-auto text-[9px] font-mono text-slate-400 dark:text-slate-600">
                {getItems(hw, voodooTypes, id).length}
              </span>
            </button>
          ))}
        </nav>
      </div>

      <ResizeHandle onMouseDown={e => startDrag(e, col1Width, setCol1Width, 120, 320)} />

      {/* Column 2: Subcategory */}
      {hasSubcats && (
        <div className="flex-shrink-0 flex flex-col bg-white dark:bg-slate-900 overflow-hidden" style={{ width: col2Width }}>
          <div className="flex-shrink-0 px-3 py-3 border-b border-slate-200 dark:border-slate-800">
            <p className="text-[10px] text-slate-400 dark:text-slate-600 uppercase tracking-wider font-semibold">
              {subcats.length} subcategories
            </p>
          </div>
          <SubcatList
            subcats={subcats}
            counts={subcatCounts}
            selectedSubcat={selectedSubcat}
            onSelect={handleSubcatChange}
          />
        </div>
      )}

      {hasSubcats && <ResizeHandle onMouseDown={e => startDrag(e, col2Width, setCol2Width, 120, 320)} />}

      {/* Column 3: Items */}
      <div className="flex-shrink-0 flex flex-col bg-white dark:bg-slate-900 overflow-hidden" style={{ width: col3Width }}>
        {hasSubcats && !selectedSubcat ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-slate-600 p-4">
            <ChevronRight className="w-6 h-6 opacity-20" />
            <p className="text-xs text-center">Select a subcategory</p>
          </div>
        ) : (
          <ColumnList
            items={visibleItems}
            selectedId={selectedItem?.id ?? null}
            onSelect={setSelectedItem}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
          />
        )}
      </div>

      <ResizeHandle onMouseDown={e => startDrag(e, col3Width, setCol3Width, 140, 480)} />

      {/* Column 4: Detail */}
      <div className="flex-1 overflow-hidden">
        {selectedItem ? (
          category === 'machines' ? (
            <MachineDetail
              machine={selectedItem}
              hw={hw}
              machineCpuMap={machineCpuMap}
              allVideo={allVideo}
              allSound={allSound}
              allNetwork={allNetwork}
            />
          ) : (
            <ComponentDetail item={selectedItem} hw={hw} />
          )
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 gap-2">
            <ChevronRight className="w-8 h-8 opacity-20" />
            <p className="text-sm">Select an item to explore</p>
            <p className="text-xs opacity-60">{hasSubcats ? 'Choose a subcategory, then click an item' : 'Click an item from the list'}</p>
          </div>
        )}
      </div>
      </div>
    </div>
  )
}

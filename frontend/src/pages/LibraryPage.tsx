import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Disc, FolderOpen, HardDrive, Loader2, Save, CloudOff } from 'lucide-react'
import { libraryApi, formatBytes, LibraryNode } from '../lib/api'
import { useStore } from '../store/useStore'
import WritableImageBrowser from '../components/WritableImageBrowser'

type Tab = 'images' | 'library'

// ─── Shared file icon ─────────────────────────────────────────────────────────

function FileIcon({ node, selected }: { node: LibraryNode; selected: boolean }) {
  if (node.type === 'directory') return <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-yellow-500'}`} />
  if (node.image_type === 'floppy') return <Save  className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-blue-400'}`} />
  if (node.image_type === 'cdrom')  return <Disc  className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-orange-400'}`} />
  return <HardDrive className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-slate-500'}`} />
}

// ─── Read-only library column browser ────────────────────────────────────────

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

function LibraryBrowser({ library }: { library: LibraryNode[] }) {
  const [columnPath, setColumnPath] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<number[]>([])

  function startDrag(e: { preventDefault(): void; clientX: number }, ci: number, currentWidth: number) {
    e.preventDefault()
    const startX = e.clientX
    const onMove = (ev: MouseEvent) =>
      setColWidths(prev => {
        const next = [...prev]
        next[ci] = Math.min(480, Math.max(120, currentWidth + ev.clientX - startX))
        return next
      })
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const columns = useMemo(() => {
    const cols: LibraryNode[][] = [library]
    let current = library
    for (const name of columnPath) {
      const node = current.find(n => n.name === name && n.type === 'directory')
      if (!node) break
      current = node.children ?? []
      cols.push(current)
    }
    return cols
  }, [library, columnPath])

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [columns.length])

  const breadcrumb = useMemo(() => {
    const items: string[] = ['Library']
    let current = library
    for (const name of columnPath) {
      const node = current.find(n => n.name === name)
      if (!node) break
      items.push(node.name)
      if (node.type !== 'directory') break
      current = node.children ?? []
    }
    return items
  }, [library, columnPath])

  function handleSelect(colIndex: number, node: LibraryNode) {
    setColumnPath([...columnPath.slice(0, colIndex), node.name])
  }

  const selectedFile = useMemo(() => {
    if (!columnPath.length) return null
    let current = library
    let file: LibraryNode | null = null
    for (const name of columnPath) {
      const node = current.find(n => n.name === name)
      if (!node) break
      if (node.type === 'file') { file = node; break }
      current = node.children ?? []
    }
    return file
  }, [library, columnPath])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1 px-5 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50 flex-shrink-0">
        {breadcrumb.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-700 shrink-0" />}
            <button
              onClick={() => setColumnPath(columnPath.slice(0, i))}
              className={`text-xs transition-colors ${
                i === breadcrumb.length - 1
                  ? 'text-slate-800 dark:text-slate-200 font-medium cursor-default'
                  : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {item}
            </button>
          </Fragment>
        ))}
      </div>

      {/* Columns + file info panel */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} className="flex flex-1 overflow-x-auto min-h-0">
          {columns.map((col, ci) => (
            <Fragment key={ci}>
              <div
                className="overflow-y-auto flex-shrink-0 py-1 bg-white dark:bg-slate-900/30 text-xs"
                style={{ width: colWidths[ci] ?? 208 }}
              >
                {col.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-400 dark:text-slate-600 italic">Empty folder</p>
                ) : col.map(node => {
                  const selected = columnPath[ci] === node.name
                  return (
                    <button
                      key={node.name}
                      onClick={() => handleSelect(ci, node)}
                      className={`flex items-center justify-between w-full px-3.5 py-1.5 text-left text-xs transition-colors ${
                        selected
                          ? 'bg-blue-600 text-white'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileIcon node={node} selected={selected} />
                        <span className="truncate">{node.name}</span>
                      </div>
                      {node.type === 'directory' ? (
                        <ChevronRight className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-blue-200' : 'text-slate-300 dark:text-slate-600'}`} />
                      ) : (
                        <span className={`text-xs shrink-0 ml-2 tabular-nums ${selected ? 'text-blue-200' : 'text-slate-400 dark:text-slate-600'}`}>
                          {formatBytes(node.size ?? 0)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <ResizeHandle onMouseDown={e => startDrag(e, ci, colWidths[ci] ?? 208)} />
            </Fragment>
          ))}
          <div className="flex-1 bg-white dark:bg-slate-900/30" />
        </div>

        {/* File info panel */}
        {selectedFile && (
          <div className="w-56 flex-shrink-0 border-l border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex flex-col items-center justify-center gap-3 p-6 text-center">
            {selectedFile.image_type === 'floppy'
              ? <Save className="w-10 h-10 text-blue-400 opacity-80" />
              : selectedFile.image_type === 'cdrom'
              ? <Disc className="w-10 h-10 text-orange-400 opacity-80" />
              : <HardDrive className="w-10 h-10 text-slate-400 opacity-80" />}
            <div>
              <p className="text-sm font-medium text-slate-800 dark:text-slate-200 break-all leading-tight">
                {selectedFile.name}
              </p>
              <p className="text-xs text-slate-400 dark:text-slate-600 mt-1 uppercase tracking-wide">
                {selectedFile.image_type === 'floppy' ? 'Floppy image'
                  : selectedFile.image_type === 'cdrom' ? 'CD-ROM image'
                  : 'Disk image'}
              </p>
              <p className="text-sm font-mono text-slate-500 dark:text-slate-500 mt-2">
                {formatBytes(selectedFile.size ?? 0)}
              </p>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-600 leading-relaxed">
              Available in VMs via <span className="font-mono">media/library/</span>
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LibraryPage() {
  const { authConfig, serverOnline } = useStore()
  const userManagement = authConfig?.user_management ?? true

  const [tab, setTab] = useState<Tab>('images')

  const { data: library = [], isLoading: libLoading } = useQuery({
    queryKey: ['library-tree'],
    queryFn: libraryApi.tree,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const hasLibrary = !libLoading && library.length > 0

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-[#0a0a0f]">

      {/* Header */}
      <div className="flex-shrink-0 px-6 py-6 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Media</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
              Browse the read-only library and manage your images
            </p>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex-shrink-0 flex gap-0 px-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <button
          onClick={() => setTab('images')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'images'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          {userManagement ? 'My Images' : 'Images'}
        </button>
        <button
          onClick={() => setTab('library')}
          disabled={!hasLibrary && !libLoading}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
            tab === 'library'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
              : !hasLibrary && !libLoading
              ? 'border-transparent text-slate-300 dark:text-slate-700 cursor-not-allowed'
              : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
          }`}
        >
          Library
          {!libLoading && !hasLibrary && (
            <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-600 font-normal">not mounted</span>
          )}
        </button>
      </div>

      {/* Tab content */}
      {!serverOnline && (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
          <CloudOff className="w-8 h-8 opacity-40" />
          <p className="text-sm font-medium">Server unavailable</p>
          <p className="text-xs text-slate-500">Waiting to reconnect…</p>
        </div>
      )}

      {serverOnline && tab === 'images' && <WritableImageBrowser />}

      {serverOnline && tab === 'library' && (
        libLoading ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin mr-2" />
            Loading library…
          </div>
        ) : hasLibrary ? (
          <LibraryBrowser library={library} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 gap-3">
            <FolderOpen className="w-14 h-14 opacity-20" />
            <div className="text-center">
              <p className="text-base font-medium text-slate-600 dark:text-slate-400">No library mounted</p>
              <p className="text-sm text-slate-400 dark:text-slate-600 mt-1">
                Set{' '}
                <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">LIBRARY_PATH</code>
                {' '}in your{' '}
                <code className="font-mono text-xs bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">.env</code>
                {' '}to a directory of disk images
              </p>
            </div>
          </div>
        )
      )}
    </div>
  )
}

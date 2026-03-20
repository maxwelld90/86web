/**
 * ImagePickerModal — two-tab image browser used in two modes:
 *
 * Picker mode  (kind + onSelect provided): select a floppy/cdrom image to mount.
 *              Filters the browser to matching extensions.  Shows Eject/Cancel footer.
 *
 * Manager mode (vmName provided, no onSelect): upload / organise images for a VM.
 *              Shows all image types.  Shows an availability notice, no footer.
 */
import { Fragment, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Disc, FolderOpen, HardDrive, Loader2, Save, Trash2, Upload, X, CloudOff } from 'lucide-react'
import { libraryApi, formatBytes, LibraryNode } from '../lib/api'
import { useStore } from '../store/useStore'

type Tab = 'images' | 'library'

interface Props {
  // Picker mode
  kind?: 'floppy' | 'cdrom'
  currentPath?: string
  onSelect?: (path: string) => void
  onClear?: () => void

  // Manager mode
  vmName?: string

  onClose: () => void
}

// ─── Shared ───────────────────────────────────────────────────────────────────

const FLOPPY_EXT = /\.(img|ima|vfd|flp)$/i
const CDROM_EXT  = /\.(iso|bin|cue|mdf|nrg|img)$/i

function matchesKind(node: LibraryNode, kind?: 'floppy' | 'cdrom'): boolean {
  if (node.type === 'directory') return true
  if (!kind) return true
  if (kind === 'floppy') return node.image_type === 'floppy' || FLOPPY_EXT.test(node.name)
  return node.image_type === 'cdrom' || CDROM_EXT.test(node.name)
}

function FileIcon({ node, selected }: { node: LibraryNode; selected: boolean }) {
  if (node.type === 'directory') return <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-yellow-500 dark:text-yellow-400'}`} />
  if (node.image_type === 'floppy' || FLOPPY_EXT.test(node.name)) return <Save className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-blue-400'}`} />
  if (node.image_type === 'cdrom'  || CDROM_EXT.test(node.name))  return <Disc className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-orange-400'}`} />
  return <HardDrive className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-slate-400'}`} />
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

// ─── Read-only column browser (Library tab) ───────────────────────────────────

function ColumnBrowser({ tree, kind, onSelect }: {
  tree: LibraryNode[]
  kind?: 'floppy' | 'cdrom'
  onSelect?: (node: LibraryNode, path: string) => void
}) {
  const [columnPath, setColumnPath] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<number[]>([])

  function startDrag(e: { preventDefault(): void; clientX: number }, ci: number, currentWidth: number) {
    e.preventDefault()
    const startX = e.clientX
    const onMove = (ev: MouseEvent) =>
      setColWidths((prev: number[]) => {
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

  const filtered = useMemo(() => {
    function filterTree(nodes: LibraryNode[]): LibraryNode[] {
      return nodes
        .filter(n => matchesKind(n, kind))
        .map(n => n.type === 'directory' ? { ...n, children: filterTree(n.children ?? []) } : n)
    }
    return filterTree(tree)
  }, [tree, kind])

  const columns = useMemo(() => {
    const cols: LibraryNode[][] = [filtered]
    let current = filtered
    for (const name of columnPath) {
      const node = current.find(n => n.name === name && n.type === 'directory')
      if (!node) break
      current = node.children ?? []
      cols.push(current)
    }
    return cols
  }, [filtered, columnPath])

  const breadcrumb = useMemo(() => {
    const items: string[] = ['Root']
    let current = filtered
    for (const name of columnPath) {
      const node = current.find(n => n.name === name)
      if (!node) break
      items.push(node.name)
      if (node.type !== 'directory') break
      current = node.children ?? []
    }
    return items
  }, [filtered, columnPath])

  function handleClick(colIndex: number, node: LibraryNode, relPath: string) {
    if (node.type === 'directory') {
      setColumnPath([...columnPath.slice(0, colIndex), node.name])
    } else {
      onSelect?.(node, relPath)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
        {breadcrumb.map((item, i) => (
          <Fragment key={i}>
            {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-700 shrink-0" />}
            <button
              onClick={() => setColumnPath(columnPath.slice(0, i))}
              className={`text-xs transition-colors ${i === breadcrumb.length - 1
                ? 'text-slate-800 dark:text-slate-200 font-medium cursor-default'
                : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              {item}
            </button>
          </Fragment>
        ))}
      </div>
      <div ref={scrollRef} className="flex flex-1 overflow-x-auto min-h-0">
        {columns.map((col, ci) => {
          const dirPath = columnPath.slice(0, ci).join('/')
          return (
            <Fragment key={ci}>
              <div
                className="overflow-y-auto flex-shrink-0 py-1 bg-white dark:bg-slate-900/30"
                style={{ width: colWidths[ci] ?? 208 }}
              >
                {col.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-400 dark:text-slate-600 italic">Empty</p>
                ) : col.map(node => {
                  const isSelected = columnPath[ci] === node.name
                  const relPath = dirPath ? `${dirPath}/${node.name}` : node.name
                  return (
                    <button
                      key={node.name}
                      onClick={() => handleClick(ci, node, relPath)}
                      className={`flex items-center justify-between w-full px-3.5 py-1.5 text-left text-xs transition-colors ${
                        isSelected ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <FileIcon node={node} selected={isSelected} />
                        <span className="truncate">{node.name}</span>
                      </div>
                      {node.type === 'directory' ? (
                        <ChevronRight className={`w-3 h-3 shrink-0 ${isSelected ? 'text-blue-200' : 'text-slate-300 dark:text-slate-600'}`} />
                      ) : (
                        <span className={`text-xs shrink-0 ml-2 tabular-nums ${isSelected ? 'text-blue-200' : 'text-slate-400 dark:text-slate-600'}`}>
                          {formatBytes(node.size ?? 0)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <ResizeHandle onMouseDown={e => startDrag(e, ci, colWidths[ci] ?? 208)} />
            </Fragment>
          )
        })}
        <div className="flex-1 bg-white dark:bg-slate-900/30" />
      </div>
    </div>
  )
}

// ─── Writable column browser (My Images tab) ─────────────────────────────────

function WritableColumnBrowser({ tree, kind, onSelect }: {
  tree: LibraryNode[]
  kind?: 'floppy' | 'cdrom'
  onSelect?: (node: LibraryNode, path: string) => void
}) {
  const qc = useQueryClient()
  const { setActiveUpload, updateUploadProgress } = useStore()
  const [columnPath, setColumnPath] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<number[]>([])
  const [deleting, setDeleting] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [osDragOver, setOsDragOver] = useState(false)
  const osDragCounter = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const currentDir = columnPath.join('/')

  function startDrag(e: { preventDefault(): void; clientX: number }, ci: number, currentWidth: number) {
    e.preventDefault()
    const startX = e.clientX
    const onMove = (ev: MouseEvent) =>
      setColWidths((prev: number[]) => {
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

  const filtered = useMemo(() => {
    function filterTree(nodes: LibraryNode[]): LibraryNode[] {
      return nodes
        .filter(n => matchesKind(n, kind))
        .map(n => n.type === 'directory' ? { ...n, children: filterTree(n.children ?? []) } : n)
    }
    return filterTree(tree)
  }, [tree, kind])

  const columns = useMemo(() => {
    const cols: LibraryNode[][] = [filtered]
    let current = filtered
    for (const name of columnPath) {
      const node = current.find(n => n.name === name && n.type === 'directory')
      if (!node) break
      current = node.children ?? []
      cols.push(current)
    }
    return cols
  }, [filtered, columnPath])

  const breadcrumb = useMemo(() => {
    const items: string[] = ['My Images']
    let current = filtered
    for (const name of columnPath) {
      const node = current.find(n => n.name === name)
      if (!node) break
      items.push(node.name)
      if (node.type !== 'directory') break
      current = node.children ?? []
    }
    return items
  }, [filtered, columnPath])

  async function handleUploadFiles(files: FileList | null) {
    if (!files) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const controller = new AbortController()
        abortRef.current = controller
        setActiveUpload({ filename: file.name, progress: 0, abort: () => controller.abort() })
        await libraryApi.uploadImage(file, currentDir, (pct) => { updateUploadProgress(pct) }, controller.signal)
        setActiveUpload(null)
        abortRef.current = null
      }
      qc.invalidateQueries({ queryKey: ['user-images-tree'] })
    } catch (e: any) {
      setActiveUpload(null)
      abortRef.current = null
      if (e.name !== 'AbortError') alert(e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(relPath: string) {
    setDeleting(relPath)
    try {
      await libraryApi.deleteImage(relPath)
      qc.invalidateQueries({ queryKey: ['user-images-tree'] })
      if (columnPath.join('/') === relPath || columnPath.join('/').startsWith(relPath + '/')) {
        setColumnPath(columnPath.slice(0, -1))
      }
    } catch (e: any) {
      alert(e.message)
    } finally {
      setDeleting(null)
    }
  }

  // OS drag-and-drop
  function onDragEnter(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    osDragCounter.current++
    setOsDragOver(true)
  }
  function onDragLeave(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('Files')) return
    osDragCounter.current--
    if (osDragCounter.current === 0) setOsDragOver(false)
  }
  function onDragOver(e: React.DragEvent) {
    if (e.dataTransfer.types.includes('Files')) e.preventDefault()
  }
  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    osDragCounter.current = 0
    setOsDragOver(false)
    await handleUploadFiles(e.dataTransfer.files)
  }

  function handleClick(colIndex: number, node: LibraryNode, relPath: string) {
    if (node.type === 'directory') {
      setColumnPath([...columnPath.slice(0, colIndex), node.name])
    } else {
      onSelect?.(node, relPath)
    }
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* OS drag overlay */}
      {osDragOver && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 pointer-events-none bg-blue-50/90 dark:bg-blue-900/30 border-2 border-blue-400 border-dashed dark:border-blue-500 rounded">
          <Upload className="w-8 h-8 text-blue-500" />
          <p className="text-sm font-medium text-blue-600 dark:text-blue-400">
            Drop to upload to <span className="font-mono">{currentDir || 'My Images'}</span>
          </p>
        </div>
      )}

      {/* Toolbar: breadcrumb + upload */}
      <div className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
            {breadcrumb.map((item, i) => (
              <Fragment key={i}>
                {i > 0 && <ChevronRight className="w-3 h-3 text-slate-300 dark:text-slate-700 shrink-0" />}
                <button
                  onClick={() => setColumnPath(columnPath.slice(0, i))}
                  className={`text-xs transition-colors ${i === breadcrumb.length - 1
                    ? 'text-slate-800 dark:text-slate-200 font-medium cursor-default'
                    : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                >
                  {item}
                </button>
              </Fragment>
            ))}
          </div>
          <label className={`${uploading ? 'opacity-50 pointer-events-none' : ''} text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer flex-shrink-0 flex items-center gap-1`}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            {uploading ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              className="hidden"
              accept=".img,.ima,.vfd,.flp,.iso,.bin,.cue,.mdf,.nrg"
              multiple
              onChange={e => { handleUploadFiles(e.target.files); e.target.value = '' }}
            />
          </label>
        </div>
      </div>

      {/* Columns */}
      <div ref={scrollRef} className="flex flex-1 overflow-x-auto min-h-0">
        {columns.map((col, ci) => {
          const dirPath = columnPath.slice(0, ci).join('/')
          return (
            <Fragment key={ci}>
              <div
                className="overflow-y-auto flex-shrink-0 py-1 bg-white dark:bg-slate-900/30"
                style={{ width: colWidths[ci] ?? 208 }}
              >
                {col.length === 0 ? (
                  <p className="px-4 py-3 text-xs text-slate-400 dark:text-slate-600 italic">Empty</p>
                ) : col.map(node => {
                  const isSelected = columnPath[ci] === node.name
                  const relPath = dirPath ? `${dirPath}/${node.name}` : node.name
                  const isDeletingThis = deleting === relPath
                  return (
                    <div
                      key={node.name}
                      className={`group flex items-center w-full transition-colors ${
                        isSelected ? 'bg-blue-600 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <button
                        className="flex items-center gap-2.5 flex-1 min-w-0 px-3.5 py-1.5 text-left text-xs"
                        onClick={() => handleClick(ci, node, relPath)}
                      >
                        <FileIcon node={node} selected={isSelected} />
                        <span className="truncate">{node.name}</span>
                        {node.type === 'directory' ? (
                          <ChevronRight className={`w-3 h-3 shrink-0 ml-auto ${isSelected ? 'text-blue-200' : 'text-slate-300 dark:text-slate-600'}`} />
                        ) : (
                          <span className={`text-xs shrink-0 ml-auto tabular-nums ${isSelected ? 'text-blue-200' : 'text-slate-400 dark:text-slate-600'}`}>
                            {formatBytes(node.size ?? 0)}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(relPath) }}
                        disabled={!!deleting}
                        title="Delete"
                        className={`opacity-0 group-hover:opacity-100 p-1 mr-1 rounded shrink-0 transition-all
                          ${isSelected ? 'hover:bg-blue-500 text-blue-200 hover:text-white' : 'text-slate-400 hover:text-red-400'}
                          disabled:opacity-20`}
                        style={{ opacity: isDeletingThis ? 1 : undefined }}
                      >
                        {isDeletingThis ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                      </button>
                    </div>
                  )
                })}
              </div>
              <ResizeHandle onMouseDown={e => startDrag(e, ci, colWidths[ci] ?? 208)} />
            </Fragment>
          )
        })}
        <div className="flex-1 bg-white dark:bg-slate-900/30" />
      </div>
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function ImagePickerModal({ kind, currentPath, onSelect, onClear, vmName, onClose }: Props) {
  const { serverOnline } = useStore()
  const [tab, setTab] = useState<Tab>('images')

  const { data: imagesTree = [], isLoading: imagesLoading } = useQuery({
    queryKey: ['user-images-tree'],
    queryFn: libraryApi.imagesTree,
    staleTime: 10_000,
    refetchInterval: 10_000,
  })

  const { data: libraryTree = [], isLoading: libLoading } = useQuery({
    queryKey: ['library-tree'],
    queryFn: libraryApi.tree,
    staleTime: 30_000,
    refetchInterval: 30_000,
  })

  const hasLibrary = !libLoading && libraryTree.length > 0
  const isManagerMode = !!vmName

  const title = isManagerMode
    ? 'Media'
    : kind === 'floppy' ? 'Select Floppy Image' : 'Select CD-ROM Image'

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl h-[36rem] flex flex-col card shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
            {isManagerMode && (
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{vmName}</p>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost p-1 text-slate-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        {!serverOnline && (
          <div className="flex items-center gap-2.5 px-5 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 text-xs flex-shrink-0">
            <CloudOff className="w-3.5 h-3.5 flex-shrink-0" />
            Server connection lost — media changes are unavailable until reconnected.
          </div>
        )}

        {/* Manager mode: availability notice */}
        {isManagerMode && (
          <div className="flex-shrink-0 px-5 py-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50">
            <p className="text-xs text-slate-400 dark:text-slate-500 leading-relaxed">
              Available in <span className="font-mono text-slate-600 dark:text-slate-400">{vmName}</span> via{' '}
              <span className="font-mono text-slate-600 dark:text-slate-400">media/images/</span> — navigate there in 86Box's file dialogs.
            </p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex-shrink-0 flex items-center gap-0 px-5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
          <button
            onClick={() => setTab('images')}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              tab === 'images'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
            }`}
          >
            My Images
          </button>
          <button
            onClick={() => hasLibrary && setTab('library')}
            disabled={!hasLibrary && !libLoading}
            className={`px-3 py-2 text-xs font-medium border-b-2 transition-colors -mb-px ${
              tab === 'library'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 dark:border-blue-400'
                : hasLibrary
                ? 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                : 'border-transparent text-slate-400 dark:text-slate-500 cursor-not-allowed'
            }`}
          >
            Library
            {libLoading && <span className="ml-1 text-slate-400 dark:text-slate-500">…</span>}
            {!libLoading && !hasLibrary && (
              <span className="ml-1 font-normal text-slate-400 dark:text-slate-500 italic">not mounted</span>
            )}
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col flex-1 min-h-0">
          {tab === 'images' && (
            imagesLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400 mr-2" />
                <span className="text-sm text-slate-400">Loading…</span>
              </div>
            ) : (
              <WritableColumnBrowser
                tree={imagesTree}
                kind={kind}
                // FIX: Prepend the correct VM media subdirectory
                onSelect={onSelect ? (node, path) => { onSelect(`media/images/${path}`); onClose() } : undefined}
              />
            )
          )}
          {tab === 'library' && (
            libLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 animate-spin text-slate-400 mr-2" />
                <span className="text-sm text-slate-400">Loading…</span>
              </div>
            ) : (
              <ColumnBrowser
                tree={libraryTree}
                kind={kind}
                // FIX: Prepend the correct VM media subdirectory
                onSelect={onSelect ? (node, path) => { onSelect(`media/library/${path}`); onClose() } : undefined}
              />
            )
          )}
        </div>

        {/* Footer — picker mode only */}
        {!isManagerMode && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 flex-shrink-0">
            <div className="flex-1 min-w-0 mr-4">
              {currentPath ? (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono">
                  {currentPath.split('/').pop() || currentPath}
                </p>
              ) : (
                <p className="text-xs text-slate-400 dark:text-slate-600 italic">No image selected</p>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {currentPath && (
                <button
                  className="btn-ghost text-xs text-red-400 hover:text-red-600"
                  onClick={() => { onClear?.(); onClose() }}
                >
                  Eject
                </button>
              )}
              <button onClick={onClose} className="btn-secondary text-xs">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}

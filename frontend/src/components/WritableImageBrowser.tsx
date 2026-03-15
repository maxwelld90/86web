/**
 * WritableImageBrowser — macOS column-view browser for user images.
 * Supports New Folder, Upload, Delete, Move (drag-and-drop), and Rename.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ChevronRight, Disc, FolderOpen, FolderPlus, HardDrive,
  Loader2, Pencil, Save, Trash2, Upload,
} from 'lucide-react'
import { libraryApi, formatBytes, LibraryNode } from '../lib/api'
import { useStore } from '../store/useStore'

interface Props {
  dark?: boolean
}

function ResizeHandle({ onMouseDown, dark }: { onMouseDown: (e: { preventDefault(): void; clientX: number }) => void; dark: boolean }) {
  return (
    <div
      onMouseDown={onMouseDown}
      className={`w-[4px] flex-shrink-0 cursor-col-resize group relative transition-colors ${dark ? 'hover:bg-white/10' : 'hover:bg-blue-400/20 dark:hover:bg-blue-500/20'}`}
    >
      <div className={`absolute inset-y-0 left-[1.5px] w-px transition-colors ${dark ? 'bg-white/10 group-hover:bg-white/30' : 'bg-slate-200 dark:bg-slate-800 group-hover:bg-blue-400 dark:group-hover:bg-blue-500'}`} />
    </div>
  )
}

// ─── File icon ────────────────────────────────────────────────────────────────

function FileIcon({ node, selected, dark }: { node: LibraryNode; selected: boolean; dark: boolean }) {
  const dim = selected ? 'text-white' : dark ? 'text-yellow-400/80' : 'text-yellow-500'
  if (node.type === 'directory') return <FolderOpen className={`w-3.5 h-3.5 shrink-0 ${dim}`} />
  if (node.image_type === 'floppy') return <Save  className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-blue-400'}`} />
  if (node.image_type === 'cdrom')  return <Disc  className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : 'text-orange-400'}`} />
  return <HardDrive className={`w-3.5 h-3.5 shrink-0 ${selected ? 'text-white' : dark ? 'text-white/40' : 'text-slate-500'}`} />
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function WritableImageBrowser({ dark = false }: Props) {
  const qc = useQueryClient()
  const { setActiveUpload, updateUploadProgress } = useStore()
  const scrollRef = useRef<HTMLDivElement>(null)

  const [columnPath, setColumnPath] = useState<string[]>([])
  const [colWidths, setColWidths] = useState<number[]>([])
  const [selectedFile, setSelectedFile] = useState<LibraryNode | null>(null)
  const [newFolderInput, setNewFolderInput] = useState<string | null>(null)
  const newFolderRef = useRef<HTMLInputElement>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const uploadAbortRef = useRef<AbortController | null>(null)

  // Drag-and-drop OS file upload
  const [osDragOver, setOsDragOver] = useState(false)
  const osDragCounter = useRef(0)

  // Internal item drag-to-move
  const [draggedPath, setDraggedPath] = useState<string | null>(null)
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null)

  // Inline rename
  const [renamingPath, setRenamingPath] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameRef = useRef<HTMLInputElement>(null)

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ['user-images-tree'],
    queryFn: libraryApi.imagesTree,
    refetchInterval: 10_000,
  })

  // Build columns from tree + selected path
  const columns = useMemo(() => {
    const cols: LibraryNode[][] = [tree]
    let current = tree
    for (const name of columnPath) {
      const node = current.find(n => n.name === name && n.type === 'directory')
      if (!node) break
      current = node.children ?? []
      cols.push(current)
    }
    return cols
  }, [tree, columnPath])

  // Auto-scroll right as columns open
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth
    }
  }, [columns.length])

  // Focus new-folder input when shown
  useEffect(() => {
    if (newFolderInput !== null) newFolderRef.current?.focus()
  }, [newFolderInput !== null])

  // Focus rename input when activating
  useEffect(() => {
    if (renamingPath !== null) renameRef.current?.focus()
  }, [renamingPath])

  // Breadcrumb items
  const breadcrumb = useMemo(() => {
    const items: string[] = ['Images']
    let current = tree
    for (const name of columnPath) {
      const node = current.find(n => n.name === name)
      if (!node) break
      items.push(node.name)
      if (node.type !== 'directory') break
      current = node.children ?? []
    }
    return items
  }, [tree, columnPath])

  // Current relative directory path for operations
  const currentDir = columnPath.join('/')

  function handleSelect(colIndex: number, node: LibraryNode) {
    if (node.type === 'directory') {
      setColumnPath([...columnPath.slice(0, colIndex), node.name])
      setSelectedFile(null)
    } else {
      setColumnPath(columnPath.slice(0, colIndex))
      setSelectedFile(node)
    }
  }

  async function handleMkdir() {
    const name = newFolderInput?.trim()
    setNewFolderInput(null)
    if (!name) return
    const newPath = currentDir ? `${currentDir}/${name}` : name
    try {
      await libraryApi.mkdirImages(newPath)
      qc.invalidateQueries({ queryKey: ['user-images-tree'] })
      setColumnPath(currentDir ? [...columnPath, name] : [name])
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function handleUpload(file: File) {
    const controller = new AbortController()
    uploadAbortRef.current = controller
    setUploading(true)
    setUploadProgress(0)
    setUploadError(null)
    setActiveUpload({ filename: file.name, progress: 0, abort: () => controller.abort() })
    try {
      await libraryApi.uploadImage(file, currentDir, (pct) => {
        setUploadProgress(pct)
        updateUploadProgress(pct)
      }, controller.signal)
      qc.invalidateQueries({ queryKey: ['user-images-tree'] })
    } catch (e: any) {
      if (e.name !== 'AbortError') setUploadError(e.message)
    } finally {
      setUploading(false)
      setUploadProgress(null)
      uploadAbortRef.current = null
      setActiveUpload(null)
    }
  }

  async function handleUploadFiles(files: FileList | null) {
    if (!files) return
    for (const file of Array.from(files)) {
      await handleUpload(file)
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

  async function handleMove(src: string, dst: string) {
    if (src === dst) return
    try {
      await libraryApi.moveImage(src, dst)
      qc.invalidateQueries({ queryKey: ['user-images-tree'] })
      // If moved item was in the current path, update it
      if (columnPath.join('/') === src || columnPath.join('/').startsWith(src + '/')) {
        setColumnPath([])
      }
    } catch (e: any) {
      alert(e.message)
    }
  }

  async function handleRename(relPath: string) {
    const newName = renameValue.trim()
    setRenamingPath(null)
    if (!newName || newName === relPath.split('/').pop()) return
    const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
    const dst = parent ? `${parent}/${newName}` : newName
    await handleMove(relPath, dst)
  }

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

  // ─── OS drag-and-drop upload handlers ─────────────────────────────────────

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
    if (e.dataTransfer.files.length > 0) {
      await handleUploadFiles(e.dataTransfer.files)
    }
  }

  // ─── Internal item drag-to-move handlers ──────────────────────────────────

  function onItemDragStart(e: React.DragEvent, relPath: string) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('application/x-image-path', relPath)
    setDraggedPath(relPath)
  }

  function onItemDragEnd() {
    setDraggedPath(null)
    setDropTargetPath(null)
  }

  function onFolderDragOver(e: React.DragEvent, relPath: string) {
    if (!e.dataTransfer.types.includes('application/x-image-path')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropTargetPath(relPath)
  }

  function onFolderDragLeave(e: React.DragEvent) {
    // Only clear if leaving the folder element itself (not a child)
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDropTargetPath(null)
    }
  }

  async function onFolderDrop(e: React.DragEvent, folderRelPath: string) {
    e.preventDefault()
    setDropTargetPath(null)
    const src = e.dataTransfer.getData('application/x-image-path')
    if (!src || src === folderRelPath || src.startsWith(folderRelPath + '/')) return
    await handleMove(src, folderRelPath)
    setDraggedPath(null)
  }

  // ─── Theming ────────────────────────────────────────────────────────────────

  const d = dark
  const bar        = d ? 'border-white/8 bg-white/4'         : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/50'
  const colBg      = d ? 'bg-white/3'                        : 'bg-white dark:bg-slate-900/30'
  const colBorder  = d ? 'border-white/8'                    : 'border-slate-200 dark:border-slate-800'
  const itemBase   = d ? 'text-white/75 hover:bg-white/8'    : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
  const emptyTxt   = d ? 'text-white/30'                     : 'text-slate-400 dark:text-slate-600'
  const chevronDim = d ? 'text-white/20'                     : 'text-slate-300 dark:text-slate-600'
  const breadActive   = d ? 'text-white/80'  : 'text-slate-800 dark:text-slate-200'
  const breadInactive = d ? 'text-white/35 hover:text-white/65' : 'text-slate-400 dark:text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
  const inputCls = d
    ? 'bg-white/10 border border-white/20 text-white placeholder-white/30 text-xs rounded-lg px-2.5 py-1 outline-none focus:border-blue-500'
    : 'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white placeholder-slate-400 text-xs rounded-lg px-2.5 py-1 outline-none focus:border-blue-500'
  const btnSm = d
    ? 'text-xs px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-white/70 transition-colors'
    : 'text-xs px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors'
  const btnCreate = 'text-xs px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors'

  // ─── Render ─────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className={`w-5 h-5 animate-spin mr-2 ${d ? 'text-white/30' : 'text-slate-400'}`} />
        <span className={d ? 'text-white/30 text-sm' : 'text-slate-400 text-sm'}>Loading…</span>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col flex-1 min-h-0 relative"
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >

      {/* OS drag-over overlay */}
      {osDragOver && (
        <div className={`absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded pointer-events-none
          ${d ? 'bg-blue-500/20 border-2 border-blue-400/60 border-dashed' : 'bg-blue-50/90 dark:bg-blue-900/30 border-2 border-blue-400 border-dashed dark:border-blue-500'}`}>
          <Upload className={`w-8 h-8 ${d ? 'text-blue-300' : 'text-blue-500'}`} />
          <p className={`text-sm font-medium ${d ? 'text-blue-200' : 'text-blue-600 dark:text-blue-400'}`}>
            Drop to upload to <span className="font-mono">{currentDir || 'Images'}</span>
          </p>
        </div>
      )}

      {/* Breadcrumb + actions toolbar */}
      <div className={`flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 ${bar}`}>
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
          {breadcrumb.map((item, i) => (
            <Fragment key={i}>
              {i > 0 && <ChevronRight className={`w-3 h-3 shrink-0 ${chevronDim}`} />}
              <button
                onClick={() => setColumnPath(columnPath.slice(0, i))}
                className={`text-xs truncate transition-colors ${i === breadcrumb.length - 1 ? `${breadActive} font-medium cursor-default` : breadInactive}`}
              >
                {item}
              </button>
            </Fragment>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => setNewFolderInput('')}
            title="New Folder"
            className={btnSm}
          >
            <FolderPlus className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />
            New Folder
          </button>
          <label className={`${uploading ? 'opacity-50 pointer-events-none' : ''} ${btnSm} cursor-pointer`}>
            {uploading ? <Loader2 className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" />}
            {uploading ? 'Uploading…' : 'Upload'}
            <input
              type="file"
              className="hidden"
              accept=".001,.002,.003,.004,.005,.006,.007,.008,.009,.010,.12,.144,.360,.720,.86f,.bin,.cq,.cqm,.ddi,.dsk,.fdi,.fdf,.flp,.hdm,.ima,.imd,.img,.json,.mfm,.td0,.vfd,.xdf,.iso,.cue,.mds,.mdx,.viso"
              multiple
              onChange={e => { handleUploadFiles(e.target.files); e.target.value = '' }}
            />
          </label>
          {uploadError && <span className="text-xs text-red-400 truncate max-w-32">{uploadError}</span>}
        </div>
      </div>

      {/* New folder input bar */}
      {newFolderInput !== null && (
        <div className={`flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 ${bar}`}>
          <span className={`text-xs ${d ? 'text-white/50' : 'text-slate-500 dark:text-slate-400'} shrink-0`}>
            New folder in{' '}
            <span className={`font-mono ${d ? 'text-white/70' : 'text-slate-700 dark:text-slate-300'}`}>
              {currentDir || 'Images'}
            </span>:
          </span>
          <input
            ref={newFolderRef}
            className={`${inputCls} flex-1`}
            placeholder="Folder name"
            value={newFolderInput}
            onChange={e => setNewFolderInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleMkdir()
              if (e.key === 'Escape') setNewFolderInput(null)
            }}
          />
          <button onClick={handleMkdir} className={btnCreate}>Create</button>
          <button onClick={() => setNewFolderInput(null)} className={btnSm}>Cancel</button>
        </div>
      )}

      {/* Column view */}
      {tree.length === 0 && !isLoading ? (
        <div className={`flex-1 flex flex-col items-center justify-center gap-3 ${emptyTxt}`}>
          <FolderOpen className="w-12 h-12 opacity-20" />
          <div className="text-center">
            <p className={`text-sm font-medium ${d ? 'text-white/40' : 'text-slate-500 dark:text-slate-500'}`}>No images yet</p>
            <p className="text-xs mt-1 opacity-70">Drop files here or click Upload to add images</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 min-h-0 overflow-hidden">
        <div ref={scrollRef} className="flex flex-1 overflow-x-auto min-h-0">
          {columns.map((col, ci) => {
            const dirRelPath = columnPath.slice(0, ci).join('/')
            return (
              <Fragment key={ci}>
              <div
                className={`overflow-y-auto flex-shrink-0 py-1 ${colBg}`}
                style={{ width: colWidths[ci] ?? 208 }}
              >
                {col.length === 0 ? (
                  <p className={`px-4 py-3 text-xs italic ${emptyTxt}`}>Empty folder</p>
                ) : col.map(node => {
                  const relPath = dirRelPath ? `${dirRelPath}/${node.name}` : node.name
                  const isSelected = columnPath[ci] === node.name
                  const isDeletingThis = deleting === relPath
                  const isDragSource = draggedPath === relPath
                  const isDropTarget = dropTargetPath === relPath && node.type === 'directory'
                  const isRenaming = renamingPath === relPath

                  return (
                    <div
                      key={node.name}
                      draggable={!isRenaming}
                      onDragStart={e => onItemDragStart(e, relPath)}
                      onDragEnd={onItemDragEnd}
                      onDragOver={node.type === 'directory' ? e => onFolderDragOver(e, relPath) : undefined}
                      onDragLeave={node.type === 'directory' ? onFolderDragLeave : undefined}
                      onDrop={node.type === 'directory' ? e => onFolderDrop(e, relPath) : undefined}
                      className={`group flex items-center w-full transition-colors
                        ${isDragSource ? 'opacity-40' : ''}
                        ${isDropTarget ? (d ? 'bg-blue-500/30 outline outline-1 outline-blue-400' : 'bg-blue-100 dark:bg-blue-900/40 outline outline-1 outline-blue-400') : ''}
                        ${!isDropTarget && !isDragSource ? (isSelected ? 'bg-blue-600 text-white' : itemBase) : ''}
                      `}
                    >
                      <button
                        className="flex items-center gap-2 flex-1 min-w-0 px-3 py-1.5 text-left text-xs"
                        onClick={() => { if (!isRenaming) handleSelect(ci, node) }}
                      >
                        <FileIcon node={node} selected={isSelected && !isDropTarget} dark={dark} />
                        {isRenaming ? (
                          <input
                            ref={renameRef}
                            className={`flex-1 min-w-0 ${inputCls} py-0.5`}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') handleRename(relPath)
                              if (e.key === 'Escape') { setRenamingPath(null) }
                            }}
                            onBlur={() => handleRename(relPath)}
                            onClick={e => e.stopPropagation()}
                          />
                        ) : (
                          <span className="truncate">{node.name}</span>
                        )}
                        {!isRenaming && (node.type === 'directory' ? (
                          <ChevronRight className={`w-3 h-3 shrink-0 ml-auto ${isSelected ? 'text-blue-200' : chevronDim}`} />
                        ) : (
                          <span className={`text-xs shrink-0 ml-auto tabular-nums ${isSelected ? 'text-blue-200' : emptyTxt}`}>
                            {formatBytes(node.size ?? 0)}
                          </span>
                        ))}
                      </button>

                      {/* Rename button */}
                      {!isRenaming && (
                        <button
                          onClick={e => { e.stopPropagation(); setRenamingPath(relPath); setRenameValue(node.name) }}
                          title="Rename"
                          className={`opacity-0 group-hover:opacity-100 p-1 rounded shrink-0 transition-all
                            ${isSelected ? 'hover:bg-blue-500 text-blue-200 hover:text-white' : `hover:text-blue-500 ${d ? 'text-white/30' : 'text-slate-400'}`}`}
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}

                      {/* Delete button */}
                      {!isRenaming && (
                        <button
                          onClick={() => handleDelete(relPath)}
                          disabled={!!deleting}
                          title={node.type === 'directory' ? 'Delete folder (must be empty)' : 'Delete'}
                          className={`opacity-0 group-hover:opacity-100 p-1 mr-1 rounded shrink-0 transition-all
                            ${isSelected ? 'hover:bg-blue-500 text-blue-200 hover:text-white' : `hover:text-red-400 ${d ? 'text-white/30' : 'text-slate-400'}`}
                            disabled:opacity-20`}
                          style={{ opacity: isDeletingThis ? 1 : undefined }}
                        >
                          {isDeletingThis
                            ? <Loader2 className="w-3 h-3 animate-spin" />
                            : <Trash2 className="w-3 h-3" />}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
              <ResizeHandle onMouseDown={e => startDrag(e, ci, colWidths[ci] ?? 208)} dark={dark} />
              </Fragment>
            )
          })}
          <div className={`flex-1 ${colBg}`} />
        </div>

        {/* File info panel */}
        {selectedFile && (
          <div className={`w-52 flex-shrink-0 flex flex-col items-center justify-center gap-3 p-5 text-center border-l
            ${d ? 'border-white/8 bg-white/4' : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60'}`}>
            {selectedFile.image_type === 'floppy'
              ? <Save className={`w-9 h-9 opacity-70 ${d ? 'text-blue-300' : 'text-blue-400'}`} />
              : selectedFile.image_type === 'cdrom'
              ? <Disc className={`w-9 h-9 opacity-70 ${d ? 'text-orange-300' : 'text-orange-400'}`} />
              : <HardDrive className={`w-9 h-9 opacity-70 ${d ? 'text-white/40' : 'text-slate-400'}`} />}
            <div>
              <p className={`text-sm font-medium break-all leading-tight ${d ? 'text-white/80' : 'text-slate-800 dark:text-slate-200'}`}>
                {selectedFile.name}
              </p>
              <p className={`text-[11px] mt-1 uppercase tracking-wide ${d ? 'text-white/30' : 'text-slate-400 dark:text-slate-600'}`}>
                {selectedFile.image_type === 'floppy' ? 'Floppy image'
                  : selectedFile.image_type === 'cdrom' ? 'CD-ROM image'
                  : 'Disk image'}
              </p>
              <p className={`text-sm font-mono mt-2 ${d ? 'text-white/50' : 'text-slate-500'}`}>
                {formatBytes(selectedFile.size ?? 0)}
              </p>
            </div>
            <p className={`text-[11px] leading-relaxed ${d ? 'text-white/25' : 'text-slate-400 dark:text-slate-600'}`}>
              Available in VMs via <span className="font-mono">media/images/</span>
            </p>
          </div>
        )}
        </div>
      )}
    </div>
  )
}

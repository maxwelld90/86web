import { useEffect } from 'react'
import { CheckCircle, XCircle, Info, Upload, X } from 'lucide-react'
import { useStore, Toast } from '../store/useStore'
import { clsx } from 'clsx'

function ToastItem({ toast }: { toast: Toast }) {
  const { removeToast } = useStore()
  const icons = {
    success: <CheckCircle className="w-4 h-4 text-emerald-400 flex-shrink-0" />,
    error: <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />,
    info: <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />,
  }
  return (
    <div
      className={clsx(
        'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-sm',
        'bg-slate-900 border-slate-700 text-slate-100',
        'animate-in slide-in-from-right-2 duration-200',
        toast.onClick && 'cursor-pointer hover:bg-slate-800 transition-colors',
      )}
      onClick={toast.onClick ? () => { toast.onClick!(); removeToast(toast.id) } : undefined}
    >
      {icons[toast.type]}
      <span className="flex-1">{toast.message}</span>
      <button
        onClick={e => { e.stopPropagation(); removeToast(toast.id) }}
        className="opacity-50 hover:opacity-100 p-0.5"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

function UploadToastItem() {
  const { activeUpload, setActiveUpload } = useStore()

  useEffect(() => {
    if (!activeUpload) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [!!activeUpload]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeUpload) return null

  return (
    <div className={clsx(
      'rounded-lg shadow-lg border text-sm',
      'bg-slate-900 border-slate-700 text-slate-100',
      'animate-in slide-in-from-right-2 duration-200',
    )}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Upload className="w-4 h-4 text-blue-400 flex-shrink-0" />
        <span className="flex-1 truncate" title={activeUpload.filename}>{activeUpload.filename}</span>
        <span className="text-xs text-slate-400 tabular-nums flex-shrink-0">{activeUpload.progress}%</span>
        <button
          onClick={() => { activeUpload.abort(); setActiveUpload(null) }}
          title="Cancel upload"
          className="opacity-50 hover:opacity-100 p-0.5 flex-shrink-0"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="h-1 rounded-b-lg bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-150"
          style={{ width: `${activeUpload.progress}%` }}
        />
      </div>
    </div>
  )
}

export default function Toaster() {
  const { toasts, activeUpload } = useStore()
  if (toasts.length === 0 && !activeUpload) return null
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
      <UploadToastItem />
      {toasts.map(t => <ToastItem key={t.id} toast={t} />)}
    </div>
  )
}

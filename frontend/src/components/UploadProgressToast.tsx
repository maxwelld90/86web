import { useEffect } from 'react'
import { Upload, X } from 'lucide-react'
import { useStore } from '../store/useStore'

export default function UploadProgressToast() {
  const { activeUpload, setActiveUpload } = useStore()

  // Warn on browser close/refresh while uploading
  useEffect(() => {
    if (!activeUpload) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [!!activeUpload]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!activeUpload) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl p-4 w-72">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Upload className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
          <span className="text-sm font-medium text-slate-900 dark:text-white">Uploading</span>
        </div>
        <button
          onClick={() => { activeUpload.abort(); setActiveUpload(null) }}
          title="Cancel upload"
          className="text-slate-400 hover:text-red-500 transition-colors flex-shrink-0 p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400 truncate mb-2" title={activeUpload.filename}>
        {activeUpload.filename}
      </p>
      <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-150"
          style={{ width: `${activeUpload.progress}%` }}
        />
      </div>
      <p className="text-xs text-slate-400 dark:text-slate-500 mt-1.5 text-right tabular-nums">
        {activeUpload.progress}%
      </p>
    </div>
  )
}

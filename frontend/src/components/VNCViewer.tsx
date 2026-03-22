import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Maximize2, RefreshCw, PowerOff, Play, Pause, AlertCircle, Monitor, Settings, FolderOpen, Volume2, VolumeX, Keyboard, CloudOff, Camera, ZoomIn, ZoomOut, Mouse, Eye, EyeOff } from 'lucide-react'
import { vmApi, systemApi } from '../lib/api'
import { useStore } from '../store/useStore'
import { VMConfig } from '../types'
import VMConfigModal from './VMConfigModal'
import ImagePickerModal from './ImagePickerModal'
import ConfirmDialog from './ConfirmDialog'
import { clsx } from 'clsx'

interface Props {
  vmId: number
  vmName: string
}

// ─── Main VNCViewer ───────────────────────────────────────────────────────────

export default function VNCViewer({ vmId, vmName }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<any>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const keyboardInputRef = useRef<HTMLTextAreaElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [muted, setMuted] = useState(true)  // start muted so autoplay is allowed
  const [showSettings, setShowSettings] = useState(false)
  const [showMedia, setShowMedia] = useState(false)
  const [confirm, setConfirm] = useState<'poweroff' | null>(null)
  const { updateTabStatus, addToast, serverOnline } = useStore()
  const [busy, setBusy] = useState(false)
  const [scaleToFit, setScaleToFit] = useState(true)
  const [showScreenMenu, setShowScreenMenu] = useState(false)
  const screenMenuRef = useRef<HTMLDivElement>(null)
  const [elapsedSecs, setElapsedSecs] = useState(0)
  const startedAtRef = useRef<number | null>(null)  // Date.now() when VM started
  // 86Box starts in fullscreen with its UI (menu+status bar) hidden.
  // This tracks whether the user has toggled it back on.
  const [uiVisible, setUiVisible] = useState(false)
  const [keyboardActive, setKeyboardActive] = useState(false)

  const handleHiddenInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    if (!val || !rfbRef.current) return
    
    for (const char of val) {
      const code = char.charCodeAt(0)
      rfbRef.current.sendKey(code, char, true)
      rfbRef.current.sendKey(code, char, false)
    }
    e.target.value = ''
  }

  const handleHiddenKeyDown = (e: React.KeyboardEvent) => {
    if (!rfbRef.current) return
    
    const keyMap: Record<string, number> = {
      'Backspace': 0xff08,
      'Enter': 0xff0d,
      'Tab': 0xff09,
      'Escape': 0xff1b,
      'ArrowUp': 0xff52,
      'ArrowDown': 0xff54,
      'ArrowLeft': 0xff51,
      'ArrowRight': 0xff53,
    }

    if (keyMap[e.key]) {
      rfbRef.current.sendKey(keyMap[e.key], e.key, true)
      rfbRef.current.sendKey(keyMap[e.key], e.key, false)
      e.preventDefault()
    }
  }

  const toggleKeyboard = () => {
    if (keyboardActive) {
      keyboardInputRef.current?.blur()
    } else {
      keyboardInputRef.current?.focus()
    }
  }

  const sendSpecialKey = (keysym: number, name: string) => {
    if (rfbRef.current) {
      rfbRef.current.sendKey(keysym, name, true)
      setTimeout(() => {
        rfbRef.current?.sendKey(keysym, name, false)
      }, 50) // Short delay so that the VM registers the input
    }
  }

  // 86Box keybindings — locked to defaults in 86box_global.cfg at runner startup.
  const KEY_TOGGLE_UI  = 'ctrl+alt+Next'   // Ctrl+Alt+PgDown — Toggle UI in fullscreen
  const KEY_CAD        = 'ctrl+F12'        // Send Ctrl+Alt+Del to guest
  const KEY_RELEASE_MOUSE = 'ctrl+End'     // Release mouse pointer

  const qc = useQueryClient()

  const { data: vmStatus, refetch } = useQuery({
    queryKey: ['vm-status', vmId],
    queryFn: () => vmApi.status(vmId),
    refetchInterval: 3000,
  })

  const { data: version } = useQuery({
    queryKey: ['version'],
    queryFn: systemApi.version,
    staleTime: 300_000,
  })

  const { data: vmFull } = useQuery({
    queryKey: ['vm-full', vmId],
    queryFn: () => vmApi.get(vmId),
    refetchInterval: 15000,
  })

  const { data: groups = [] } = useQuery({
    queryKey: ['vm-groups'],
    queryFn: vmApi.listGroups,
  })

  const updateVMMut = useMutation({
    mutationFn: (data: { name: string; description?: string; group_id?: number | null; config: VMConfig }) =>
      vmApi.update(vmId, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['vm-full', vmId] }) },
  })

  const isRunning = vmStatus?.status === 'running'
  const isPaused  = vmStatus?.status === 'paused'
  const isAlive   = isRunning || isPaused  // process is up (running or paused)

  // Sync startedAt from server uptime on each poll, then tick locally every second
  useEffect(() => {
    if (vmStatus?.uptime != null && isAlive) {
      startedAtRef.current = Date.now() - vmStatus.uptime * 1000
      setElapsedSecs(Math.floor(vmStatus.uptime))
    } else if (!isAlive) {
      startedAtRef.current = null
      setElapsedSecs(0)
    }
  }, [vmStatus?.uptime, isAlive])

  useEffect(() => {
    if (!isAlive) return
    const id = setInterval(() => {
      if (startedAtRef.current != null) {
        setElapsedSecs(Math.floor((Date.now() - startedAtRef.current) / 1000))
      }
    }, 1000)
    return () => clearInterval(id)
  }, [isAlive])

  // 86Box starts in fullscreen — reset UI visibility tracking when VM connects
  // so it always reflects the actual initial state (UI hidden).
  // The fullscreenchange sync is intentionally removed: 86Box is always in its
  // own fullscreen, so toggling the browser fullscreen needs no 86Box action.

  // Close screen menu on outside click
  useEffect(() => {
    if (!showScreenMenu) return
    function onDown(e: MouseEvent) {
      if (screenMenuRef.current && !screenMenuRef.current.contains(e.target as Node)) {
        setShowScreenMenu(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [showScreenMenu])

  // Connect noVNC when VM process is alive (running or paused)
  useEffect(() => {
    if (!isAlive || !canvasRef.current) {
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    let cancelled = false

    const connect = async () => {
      if (rfbRef.current) {
        rfbRef.current.disconnect()
        rfbRef.current = null
      }

      let RFB: any
      try {
        const mod = await (new Function('u', 'return import(u)'))('/novnc/core/rfb.js')
        RFB = mod.default
      } catch {
        if (!cancelled) {
          setError('noVNC client library failed to load')
          setLoading(false)
        }
        return
      }

      if (cancelled || !canvasRef.current) return

      try {
        const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/vnc/${vmId}/websockify`
        const rfb = new RFB(canvasRef.current, url, { viewOnly: false })
        rfb.background = 'black'

        rfb.addEventListener('connect', () => {
          setLoading(false)
          setError(null)
          rfb.scaleViewport = scaleToFit
          setUiVisible(false)  // 86Box starts in fullscreen with UI hidden
        })

        rfb.addEventListener('disconnect', (e: any) => {
          if (e.detail?.clean === false) {
            setError('Connection lost')
          }
        })

        rfb.addEventListener('credentialsrequired', () => {
          rfb.sendCredentials({ password: '' })
        })

        rfbRef.current = rfb
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || 'Failed to connect')
          setLoading(false)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (rfbRef.current) {
        rfbRef.current.disconnect()
        rfbRef.current = null
      }
    }
  }, [isAlive, vmId])

  // Configurable audio buffer (seconds). Set AUDIO_BUFFER_SECS in .env to tune.
  // Lower = less latency but more risk of underrun/choppiness.
  const audioBuf = parseFloat(import.meta.env.VITE_AUDIO_BUFFER_SECS ?? '0.4')

  // MSE-based audio streaming.
  // Using MediaSource Extensions lets us control the buffer directly, keeping
  // playback pinned to the live edge with low latency.
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!isAlive) {
      audio.src = ''
      return
    }

    const controller = new AbortController()
    const ms = new MediaSource()
    const objectUrl = URL.createObjectURL(ms)
    audio.muted = true
    setMuted(true)
    audio.src = objectUrl

    ms.addEventListener('sourceopen', async () => {
      URL.revokeObjectURL(objectUrl)

      const mimeType = 'audio/mpeg'
      let sb: SourceBuffer
      try {
        sb = ms.addSourceBuffer(mimeType)
        // MP3 frames carry no timestamps, so 'sequence' mode is correct:
        // the browser assigns presentation time based on append order.
        sb.mode = 'sequence'
      } catch (e) {
        console.error('MSE SourceBuffer error:', e)
        return
      }

      sb.addEventListener('error', (e) => console.error('SourceBuffer error:', e))

      // Queue stores proper ArrayBuffer copies.
      // IMPORTANT: fetch reader gives Uint8Array views into a larger shared buffer;
      // we must slice out only the valid bytes, not pass the whole .buffer.
      const queue: ArrayBuffer[] = []
      let busy = false
      let started = false

      const pump = () => {
        if (busy || sb.updating) return

        // Trim data behind the playhead first to cap memory usage.
        if (sb.buffered.length > 0) {
          const trimTo = audio.currentTime - 2.0
          if (trimTo > sb.buffered.start(0)) {
            busy = true
            sb.remove(sb.buffered.start(0), trimTo)
            return // updateend fires → pump() resumes
          }
        }

        if (!queue.length) return
        busy = true
        sb.appendBuffer(queue.shift()!)
      }

      sb.addEventListener('updateend', () => {
        busy = false

        if (sb.buffered.length > 0) {
          const liveEdge = sb.buffered.end(sb.buffered.length - 1)

          if (!started && liveEdge >= audioBuf + 0.2) {
            // Start playback once we have audioBuf + a small headroom.
            started = true
            audio.currentTime = Math.max(0, liveEdge - audioBuf)
            audio.play().catch(() => {})
          } else if (started && liveEdge - audio.currentTime > 5.0) {
            // Drift correction only for large gaps (clock skew / tab suspend).
            audio.currentTime = liveEdge - audioBuf
          }
        }

        pump()
      })

      try {
        const res = await fetch(`/vms/${vmId}/audio`, { signal: controller.signal })
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)

        const reader = res.body.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done || controller.signal.aborted) break
          if (value) {
            // Slice out only the valid bytes from the underlying shared buffer.
            queue.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
            pump()
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError') console.error('Audio stream error:', e)
      }
    }, { once: true })

    return () => {
      controller.abort()
      audio.src = ''
    }
  }, [isAlive, vmId])

  // Update tab status
  useEffect(() => {
    if (vmStatus?.status) {
      updateTabStatus(vmId, vmStatus.status)
    }
  }, [vmStatus?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleStart() {
    setBusy(true)
    try {
      await vmApi.start(vmId)
      addToast(`"${vmName}" started`)
      refetch()
    } catch (e: any) {
      addToast(e.message || 'Failed to start VM', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handlePowerOff() {
    setConfirm(null)
    setBusy(true)
    try {
      await vmApi.stop(vmId)
      addToast(`"${vmName}" stopped`)
      refetch()
    } catch (e: any) {
      addToast(e.message || 'Failed to stop VM', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleReset() {
    setBusy(true)
    try {
      await vmApi.reset(vmId)
      refetch()
    } catch (e: any) {
      addToast(e.message || 'Failed to reset VM', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handlePause() {
    setBusy(true)
    try {
      await vmApi.pause(vmId)
      refetch()
    } catch (e: any) {
      addToast(e.message || 'Failed to pause/resume VM', 'error')
    } finally {
      setBusy(false)
    }
  }

  function handleCtrlAltDel() {
    // Send via 86Box's own binding (Ctrl+F12) so it correctly forwards to the guest
    vmApi.sendKey(vmId, KEY_CAD).catch(() => addToast('Failed to send Ctrl+Alt+Del', 'error'))
  }

  async function handleToggleUI() {
    await vmApi.sendKey(vmId, KEY_TOGGLE_UI).catch(() => {})
    setUiVisible(v => !v)
  }

  async function handleScreenshot() {
    const canvas = canvasRef.current?.querySelector('canvas')
    if (!canvas) { addToast('No VNC canvas found', 'error'); return }

    // If the 86Box UI (menu+status bar) is currently visible, hide it first
    // so the screenshot is clean, then restore it afterwards.
    if (uiVisible) {
      await vmApi.sendKey(vmId, KEY_TOGGLE_UI).catch(() => {})
      await new Promise(r => setTimeout(r, 350))
    }

    const url = (canvas as HTMLCanvasElement).toDataURL('image/png')

    if (uiVisible) {
      vmApi.sendKey(vmId, KEY_TOGGLE_UI).catch(() => {})
    }

    const a = document.createElement('a')
    a.href = url
    a.download = `${vmName}-screenshot.png`
    a.click()
  }

  function toggleScale() {
    const next = !scaleToFit
    setScaleToFit(next)
    if (rfbRef.current) rfbRef.current.scaleViewport = next
  }

  function handleFullscreen() {
    canvasRef.current?.requestFullscreen()
  }

  function toggleMute() {
    const audio = audioRef.current
    if (!audio) return
    const next = !muted
    audio.muted = next
    // If the user is unmuting and the element isn't playing (e.g. autoplay was
    // blocked while unmuted, or the element was reset), kick it off now.
    if (!next && audio.paused) {
      audio.play().catch(() => {})
    }
    setMuted(next)
  }

  const autoShutdownMins = version?.vm_auto_shutdown_minutes ?? 0
  const shutdownLimitSecs = autoShutdownMins * 60
  const remainingSecs = shutdownLimitSecs > 0 ? Math.max(0, shutdownLimitSecs - elapsedSecs) : null

  function fmtDuration(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = s % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className={`flex flex-col h-full bg-black${busy ? ' cursor-wait' : ''}`}>
      {/* Hidden audio element for VM audio */}
      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className={`status-dot ${serverOnline && isRunning ? 'status-running' : serverOnline && isPaused ? 'status-starting' : 'status-stopped'}`} />
          <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{vmName}</span>
          <span className="text-xs text-slate-500 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800">
            {vmStatus?.status || 'unknown'}
          </span>
          {isAlive && serverOnline && elapsedSecs > 0 && remainingSecs !== 0 && (
            <span className="text-xs tabular-nums text-slate-400 dark:text-slate-500">
              {fmtDuration(elapsedSecs)}
            </span>
          )}
          {remainingSecs !== null && isAlive && serverOnline && (
            <span className={`text-xs font-medium ${remainingSecs === 0 ? 'text-red-600 dark:text-red-400 animate-pulse' : remainingSecs < 300 ? 'text-red-500 dark:text-red-400' : remainingSecs < 600 ? 'text-amber-500 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500'} ${remainingSecs > 0 ? 'tabular-nums' : ''}`}
              title="Time until auto-shutdown">
              {remainingSecs === 0 ? 'Shutdown imminent' : `${fmtDuration(remainingSecs)} left`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">

          {/* Audio — only when running */}
          {isRunning && serverOnline && (
            <button
              onClick={toggleMute}
              title={muted ? 'Unmute audio' : 'Mute audio'}
              className={`btn-ghost text-xs ${muted ? 'text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300' : 'text-green-500 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300'}`}
            >
              {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Virtual Keyboard Toggle for Mobile / Tablets */}
          {isRunning && serverOnline && (
            <button
              onClick={toggleKeyboard}
              onMouseDown={(e) => e.preventDefault()}
              title="Toggle virtual keyboard"
              className={clsx(
                "btn-ghost text-xs transition-colors",
                keyboardActive 
                  ? "text-blue-500 bg-blue-50 dark:bg-blue-900/30" 
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              )}
            >
              <Keyboard className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Toggle 86Box UI (menu + status bar) — only when running */}
          {isRunning && serverOnline && (
            <button
              onClick={handleToggleUI}
              title={uiVisible ? 'Hide 86Box menu & status bar (Ctrl+Alt+PgDown)' : 'Show 86Box menu & status bar (Ctrl+Alt+PgDown)'}
              className={`btn-ghost text-xs ${uiVisible ? 'text-blue-500 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              {uiVisible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          )}

          {/* Settings */}
          <button onClick={() => setShowSettings(true)} title="VM Settings" className="btn-ghost text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs">
            <Settings className="w-3.5 h-3.5" />
          </button>

          {/* Screen menu — only when running and online */}
          {serverOnline && isRunning && <div ref={screenMenuRef} className="relative">
            <button
              onClick={() => setShowScreenMenu(v => !v)}
              title="Screen options"
              className={`btn-ghost text-xs ${showScreenMenu ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Monitor className="w-3.5 h-3.5" />
            </button>
            {showScreenMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-lg py-1 z-50">
                <button
                  onClick={() => { handleScreenshot(); setShowScreenMenu(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                >
                  <Camera className="w-3.5 h-3.5 flex-shrink-0" />
                  Save screenshot
                </button>
                <button
                  onClick={() => { toggleScale(); setShowScreenMenu(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                >
                  {scaleToFit ? <ZoomIn className="w-3.5 h-3.5 flex-shrink-0" /> : <ZoomOut className="w-3.5 h-3.5 flex-shrink-0" />}
                  {scaleToFit ? '1:1 native pixels' : 'Scale to fit'}
                </button>
                <button
                  onClick={() => { handleFullscreen(); setShowScreenMenu(false) }}
                  className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 text-left"
                >
                  <Maximize2 className="w-3.5 h-3.5 flex-shrink-0" />
                  Fullscreen
                </button>
              </div>
            )}
          </div>}

          {/* Media */}
          <button
            onClick={() => setShowMedia(true)}
            title="Media images"
            className="btn-ghost text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            Media
          </button>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-0.5" />

          {/* Running-only controls */}
          {(isRunning || isPaused) && serverOnline ? (
            <>
              <button
                onClick={handleCtrlAltDel}
                disabled={isPaused}
                title={isPaused ? 'Resume VM before sending Ctrl+Alt+Del' : 'Send Ctrl+Alt+Del'}
                className="btn-ghost text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Keyboard className="w-3.5 h-3.5" />
                Ctrl+Alt+Del
              </button>
              <button
                onClick={handlePause}
                title={isPaused ? 'Resume VM' : 'Pause VM'}
                className={`btn-ghost text-xs ${isPaused ? 'text-amber-500 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300' : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'}`}
              >
                {isPaused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                {isPaused ? 'Resume' : 'Pause'}
              </button>
              <button
                onClick={handleReset}
                disabled={isPaused}
                title={isPaused ? 'Resume VM before resetting' : 'Reset VM'}
                className="btn-ghost text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white text-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Reset
              </button>
              <button
                onClick={() => setConfirm('poweroff')}
                className="btn-ghost text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-xs"
              >
                <PowerOff className="w-3.5 h-3.5" />
                Power Off
              </button>
            </>
          ) : (
            <button
              onClick={handleStart}
              disabled={busy || !serverOnline}
              className="btn-ghost text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 text-xs disabled:opacity-50"
            >
              <Play className="w-3.5 h-3.5" />
              {busy ? 'Starting…' : 'Start'}
            </button>
          )}

        </div>
      </div>

      {/* VNC canvas area */}
      <div className="flex-1 relative bg-black">
        <div ref={canvasRef} className={`absolute inset-0 ${scaleToFit ? 'overflow-hidden' : 'overflow-auto'}`} />

        {keyboardActive && isRunning && (
          <div 
            className="absolute top-2 right-2 flex flex-col gap-1.5 p-2 bg-slate-900/80 backdrop-blur-md border border-slate-700 rounded-xl z-50 shadow-2xl"
            onMouseDown={(e) => e.preventDefault()}
          >
            {/* Upper Bar: F1-F12 */}
            <div className="flex justify-end gap-1.5">
              {[1,2,3,4,5,6,7,8,9,10,11,12].map(num => (
                <button 
                  key={num} 
                  onClick={() => sendSpecialKey(0xffbe + num - 1, `F${num}`)} 
                  className="px-2 py-1 bg-slate-700 text-white rounded text-[10px] hover:bg-slate-600 transition-colors"
                >
                  F{num}
                </button>
              ))}
            </div>

            <div className="w-full h-px bg-slate-700 my-0.5" />

            {/* Lower Bar: Special Keys and Arrow Keys */}
            <div className="flex justify-end gap-1.5">
              <button onClick={() => sendSpecialKey(0xff1b, 'Escape')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] font-bold hover:bg-slate-700 transition-colors">ESC</button>
              <button onClick={() => sendSpecialKey(0xff09, 'Tab')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] font-bold hover:bg-slate-700 transition-colors">TAB</button>
              <button onClick={() => sendSpecialKey(0xffe3, 'Control')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] font-bold hover:bg-slate-700 transition-colors">CTRL</button>
              <button onClick={() => sendSpecialKey(0xffeb, 'Meta')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] font-bold hover:bg-slate-700 transition-colors">WIN</button>
              <button onClick={() => sendSpecialKey(0xffe9, 'Alt')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] font-bold hover:bg-slate-700 transition-colors">ALT</button>
              <button onClick={() => sendSpecialKey(0xffff, 'Delete')} className="px-2 py-1 bg-red-900/60 text-white rounded text-[10px] font-bold hover:bg-red-800 transition-colors">DEL</button>
              
              <div className="w-px h-5 bg-slate-700 mx-1 self-center" />
              
              <button onClick={() => sendSpecialKey(0xff51, 'ArrowLeft')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] hover:bg-slate-700 transition-colors">◀</button>
              <button onClick={() => sendSpecialKey(0xff52, 'ArrowUp')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] hover:bg-slate-700 transition-colors">▲</button>
              <button onClick={() => sendSpecialKey(0xff54, 'ArrowDown')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] hover:bg-slate-700 transition-colors">▼</button>
              <button onClick={() => sendSpecialKey(0xff53, 'ArrowRight')} className="px-2 py-1 bg-slate-800 text-white rounded text-[10px] hover:bg-slate-700 transition-colors">▶</button>
            </div>
          </div>
        )}

        {loading && isRunning && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 text-slate-300">
            <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-sm">Connecting to console…</p>
          </div>
        )}

        {isPaused && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/50 z-10 pointer-events-none">
            <Pause className="w-12 h-12 text-white/60 mb-2" />
            <p className="text-sm font-medium text-white/70">Paused</p>
          </div>
        )}

        {!isRunning && !isPaused && !loading && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 text-slate-400">
            <Monitor className="w-12 h-12 mb-4 opacity-30" />
            <p className="text-base font-medium text-slate-300 mb-1">{vmName}</p>
            <p className="text-sm">VM is not running</p>
            <p className="text-xs text-slate-500 mt-1">Use the Start button above to boot the VM.</p>
          </div>
        )}

        {/* Mouse release hint — top-right strip, visible while running */}
        {isRunning && (
          <button
            className="absolute top-0 right-0 z-10 flex flex-col items-center gap-2.5 bg-black/40 hover:bg-black/60 backdrop-blur-sm px-2 py-3 rounded-bl-lg select-none cursor-pointer transition-colors"
            title="Click here to release mouse from VM"
            onClick={() => vmApi.sendKey(vmId, KEY_RELEASE_MOUSE).catch(() => {})}
          >
            <div className="relative w-4 h-4 text-white/60 flex-shrink-0">
              <Mouse className="w-4 h-4" />
              <svg className="absolute inset-0 w-4 h-4" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <line x1="2" y1="12" x2="12" y2="2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            <span
              className="text-white/60 text-[11px] whitespace-nowrap"
              style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
            >
              Click here to release mouse from VM
            </span>
          </button>
        )}

        {!serverOnline && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 z-10">
            <CloudOff className="w-10 h-10 text-slate-500 mb-3" />
            <p className="text-sm font-medium text-slate-300 mb-1">Server Unavailable</p>
            <p className="text-xs text-slate-500">The connection to the server has been lost.</p>
            <p className="text-xs text-slate-600 mt-1">Waiting to reconnect…</p>
          </div>
        )}

        {error && serverOnline && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90">
            <AlertCircle className="w-10 h-10 text-red-500 mb-3" />
            <p className="text-sm font-medium text-slate-200 mb-1">Connection Error</p>
            <p className="text-xs text-slate-400">{error}</p>
            <button
              onClick={() => { setError(null); setLoading(true); refetch() }}
              className="btn-secondary mt-4 text-xs"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {confirm === 'poweroff' && (
        <ConfirmDialog
          title="Power off VM?"
          message={`This will immediately stop "${vmFull?.name ?? vmName}". Any unsaved work in the VM will be lost.`}
          confirmLabel="Power Off"
          confirmClass="btn-danger"
          onConfirm={handlePowerOff}
          onCancel={() => setConfirm(null)}
        />
      )}

      {showMedia && (
        <ImagePickerModal
          vmName={vmFull?.name ?? vmName}
          onClose={() => setShowMedia(false)}
        />
      )}

      {showSettings && (
        <VMConfigModal
          vmId={vmId}
          title={`Settings — ${vmFull?.name ?? vmName}`}
          initialName={vmFull?.name ?? vmName}
          initialDesc={vmFull?.description}
          initialGroupId={vmFull?.group_id ?? undefined}
          initialConfig={vmFull?.config as any}
          groups={groups}
          readOnly={isRunning || isPaused}
          onClose={() => setShowSettings(false)}
          onSave={async (name, desc, groupId, config) => {
            await updateVMMut.mutateAsync({ name, description: desc, group_id: groupId, config })
            setShowSettings(false)
          }}
        />
      )}

      {/* Hidden textarea with enhanced event listeners */}
      <textarea
        ref={keyboardInputRef}
        className="absolute opacity-0 p-0 w-0 h-0 pointer-events-none"
        style={{ top: '-100px', left: '-100px' }}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onFocus={() => setKeyboardActive(true)}
        onBlur={() => setKeyboardActive(false)}
        onChange={handleHiddenInput}
        onKeyDown={handleHiddenKeyDown}
      />

    </div>
  )
}

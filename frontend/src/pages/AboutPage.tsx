import { ExternalLink } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { systemApi } from '../lib/api'

export default function AboutPage() {
  const { data: version } = useQuery({
    queryKey: ['version'],
    queryFn: systemApi.version,
    staleTime: 60_000,
  })

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">About</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">86Web and the software it runs on</p>
      </div>

      {/* 86Web */}
      <div className="card px-6 py-5 space-y-3">
        <div className="flex items-center gap-3">
          <img src="/icon.png" alt="86Web" className="w-10 h-10 object-contain flex-shrink-0" />
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">86Web</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Version {version?.app_version || '1.0.0'}
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          86Web is a web-based virtual machine manager for{' '}
          <a
            href="https://86box.net"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 dark:text-blue-400 hover:underline"
          >
            86Box
          </a>
          , a highly accurate x86 emulator. It provides a browser-based interface for creating and managing
          emulated retro PCs, with VNC console access and audio streaming.
        </p>
        <p className="text-sm text-slate-500 dark:text-slate-500">
          Developed by David Maxwell.
        </p>
      </div>

      {/* 86Box */}
      <div className="card px-6 py-5 space-y-3">
        <div className="flex items-center gap-3">
          <img
            src="https://86box.net/favicon.ico"
            alt="86Box"
            className="w-8 h-8 rounded"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <div>
            <h2 className="font-semibold text-slate-900 dark:text-white">86Box</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {version?.box86_version ? `Installed: ${version.box86_version}` : 'Not installed'}
              {version?.box86_latest && version.box86_version !== version.box86_latest
                ? ` · Latest: ${version.box86_latest}`
                : ''}
            </p>
          </div>
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
          86Box is an open-source IBM PC emulator with cycle-accurate emulation of vintage hardware
          from the 8088 era through the late 1990s. It supports a wide range of CPUs, graphics cards,
          sound cards, and peripherals.
        </p>
        <a
          href="https://86box.net"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline"
        >
          86box.net
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {/* Credits */}
      <div className="card px-6 py-5 space-y-3">
        <h3 className="font-medium text-slate-900 dark:text-white">Credits</h3>
        <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-2">
          <li>
            <a href="https://86box.net" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">86Box</a>
            {' '}&mdash; the emulator. Developed by the 86Box Team and licensed under the GNU GPL v2. ROM files are not included and must be obtained separately.
          </li>
          <li>
            <a href="https://novnc.com" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">noVNC</a>
            {' '}&mdash; browser VNC client used for console access.
          </li>
          <li>
            <a href="https://www.freedesktop.org/wiki/Software/PulseAudio/" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">PulseAudio</a>
            {' + '}
            <a href="https://ffmpeg.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">ffmpeg</a>
            {' '}&mdash; audio pipeline for real-time browser audio streaming.
          </li>
          <li>
            <a href="https://tigervnc.org" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Xvnc</a>
            {' '}&mdash; virtual framebuffer + VNC server.
          </li>
        </ul>
        <p className="text-sm text-slate-500 dark:text-slate-500 pt-1">
          Built with the help of{' '}
          <a href="https://claude.ai" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">Claude</a>
          {' '}by Anthropic.
        </p>
      </div>
    </div>
  )
}

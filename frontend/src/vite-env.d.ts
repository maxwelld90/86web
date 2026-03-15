/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_AUDIO_BUFFER_SECS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

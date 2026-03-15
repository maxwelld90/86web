import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { authApi } from '../lib/api'
import { useStore } from '../store/useStore'

const APP_VERSION = __APP_VERSION__

// ── Win98 style constants ──────────────────────────────────────────────────
const W98_BG = '#c0c0c0'
const W98_RAISED = {
  boxShadow: 'inset -1px -1px #0a0a0a, inset 1px 1px #ffffff, inset -2px -2px grey, inset 2px 2px #dfdfdf',
}
const W98_SUNKEN = {
  boxShadow: 'inset 1px 1px #0a0a0a, inset -1px -1px #ffffff, inset 2px 2px grey, inset -2px -2px #dfdfdf',
}
const W98_FONT: React.CSSProperties = {
  fontFamily: '"Segoe UI", "MS Sans Serif", system-ui, sans-serif',
  fontSize: '11px',
}

function Win98Button({
  children,
  onClick,
  type = 'button',
  disabled,
  style,
}: {
  children: React.ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
  style?: React.CSSProperties
}) {
  const [pressed, setPressed] = useState(false)
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        ...W98_FONT,
        background: W98_BG,
        border: 'none',
        padding: '4px 16px',
        minWidth: '75px',
        cursor: disabled ? 'default' : 'pointer',
        outline: 'none',
        opacity: disabled ? 0.85 : 1,
        color: disabled ? '#555' : '#000',
        boxShadow: pressed
          ? 'inset 1px 1px #0a0a0a, inset -1px -1px #ffffff, inset 2px 2px grey, inset -2px -2px #dfdfdf'
          : W98_RAISED.boxShadow,
        ...style,
      }}
    >
      {children}
    </button>
  )
}

function TitleBarButton({ children }: { children: React.ReactNode }) {
  const [pressed, setPressed] = useState(false)
  return (
    <div
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        width: 16,
        height: 14,
        background: W98_BG,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'default',
        color: '#000',
        boxShadow: pressed
          ? 'inset 1px 1px #0a0a0a, inset -1px -1px #ffffff, inset 2px 2px grey, inset -2px -2px #dfdfdf'
          : W98_RAISED.boxShadow,
        userSelect: 'none',
        flexShrink: 0,
      }}
    >
      {children}
    </div>
  )
}

// Win98-style minimize icon: thick long bar near bottom
function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <rect x="1" y="7" width="8" height="2.5" fill="#000" />
    </svg>
  )
}

// Win98-style maximize icon: square with double-thick top border
function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      {/* Outer rect */}
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="#000" strokeWidth="1" />
      {/* Thick top bar */}
      <rect x="0.5" y="0.5" width="9" height="2.5" fill="#000" />
    </svg>
  )
}

// Win98-style close icon: bold X
function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="#000" strokeWidth="2" strokeLinecap="square" />
      <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="#000" strokeWidth="2" strokeLinecap="square" />
    </svg>
  )
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { setToken, setCurrentUser, authConfig } = useStore()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    usernameRef.current?.focus()
    usernameRef.current?.select()
  }, [])

  useEffect(() => {
    if (authConfig && !authConfig.user_management) {
      navigate('/', { replace: true })
    }
  }, [authConfig])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const { access_token } = await authApi.login(username, password)
      setToken(access_token)
      const me = await authApi.me()
      setCurrentUser(me)
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.message || 'Invalid credentials')
    } finally {
      setLoading(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    ...W98_FONT,
    width: '100%',
    background: 'white',
    border: 'none',
    padding: '3px 4px',
    outline: 'none',
    boxSizing: 'border-box',
    color: '#000',
    ...W98_SUNKEN,
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#008080',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        position: 'relative',
      }}
    >
      {/* Login window */}
      <div
        style={{
          ...W98_RAISED,
          background: W98_BG,
          width: 340,
          padding: 2,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Title bar */}
        <div
          style={{
            background: 'linear-gradient(to right, #000080, #1084d0)',
            padding: '3px 4px',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginBottom: 2,
            userSelect: 'none',
          }}
        >
          <img src="/icon.png" alt="" style={{ width: 14, height: 14, marginRight: 2, flexShrink: 0, imageRendering: 'pixelated' }} />
          <span
            style={{
              ...W98_FONT,
              color: 'white',
              fontWeight: 'bold',
              fontSize: '11px',
              flex: 1,
            }}
          >
            86Web — Sign In
          </span>
          <div style={{ display: 'flex', gap: 2 }}>
            <TitleBarButton><MinimizeIcon /></TitleBarButton>
            <TitleBarButton><MaximizeIcon /></TitleBarButton>
            <TitleBarButton><CloseIcon /></TitleBarButton>
          </div>
        </div>

        {/* Window body */}
        <div style={{ padding: '16px 16px 12px' }}>
          {/* App identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
            <div
              style={{
                width: 48,
                height: 48,
                ...W98_SUNKEN,
                background: 'white',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <img src="/icon.png" alt="86Web" style={{ width: 32, height: 32, imageRendering: 'pixelated' }} />
            </div>
            <div>
              <div
                style={{
                  ...W98_FONT,
                  fontSize: '16px',
                  fontWeight: 'bold',
                  color: '#000080',
                  lineHeight: 1,
                }}
              >
                86Web
              </div>
              <div style={{ ...W98_FONT, color: '#444', marginTop: 3, fontSize: '11px' }}>
                86Box Virtual Machine Manager
              </div>
              <div style={{ ...W98_FONT, color: '#666', marginTop: 2, fontSize: '10px' }}>
                Please enter your credentials to continue.
              </div>
              <div style={{ ...W98_FONT, color: '#888', marginTop: 2, fontSize: '10px' }}>
                Version {APP_VERSION}
              </div>
            </div>
          </div>

          {/* Divider */}
          <div
            style={{
              height: 0,
              borderTop: '1px solid #808080',
              borderBottom: '1px solid #fff',
              marginBottom: 14,
            }}
          />

          {/* Form */}
          <form onSubmit={handleSubmit}>
            {/* Username */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
              <label
                style={{
                  ...W98_FONT,
                  width: 90,
                  flexShrink: 0,
                  color: '#000',
                }}
              >
                User name:
              </label>
              <input
                ref={usernameRef}
                type="text"
                style={inputStyle}
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>

            {/* Password */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <label style={{ ...W98_FONT, width: 90, flexShrink: 0, color: '#000' }}>
                Password:
              </label>
              <div style={{ flex: 1, position: 'relative' }}>
                <input
                  type={showPw ? 'text' : 'password'}
                  style={{ ...inputStyle, paddingRight: 24 }}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  style={{
                    position: 'absolute',
                    right: 4,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: '#666',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  ...W98_FONT,
                  ...W98_SUNKEN,
                  background: 'white',
                  color: '#800000',
                  padding: '4px 8px',
                  marginBottom: 12,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 14 }}>⚠️</span>
                {error}
              </div>
            )}

            {/* Divider */}
            <div
              style={{
                height: 0,
                borderTop: '1px solid #808080',
                borderBottom: '1px solid #fff',
                marginBottom: 12,
              }}
            />

            {/* Buttons */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
              <Win98Button
                type="submit"
                disabled={loading || !username || !password}
                style={{ minWidth: 80 }}
              >
                {loading ? 'Signing in…' : 'OK'}
              </Win98Button>
              <Win98Button type="button" onClick={() => { setUsername(''); setPassword(''); setError('') }}>
                Cancel
              </Win98Button>
            </div>
          </form>
        </div>
      </div>

    </div>
  )
}

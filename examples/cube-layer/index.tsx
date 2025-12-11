import { StrictMode, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'

function SelectionScreen({ onSelect }: { onSelect: (mode: 'mono' | 'stereo') => void }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        gap: '20px',
        fontFamily: 'system-ui, sans-serif',
        backgroundColor: '#1a1a1a',
        color: 'white',
      }}
    >
      <h1>XRCubeLayer Example</h1>
      <p>Select cube map type:</p>
      <div style={{ display: 'flex', gap: '20px' }}>
        <button
          onClick={() => onSelect('mono')}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            cursor: 'pointer',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: '#4a90d9',
            color: 'white',
          }}
        >
          Mono (6 faces)
        </button>
        <button
          onClick={() => onSelect('stereo')}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            cursor: 'pointer',
            borderRadius: '8px',
            border: 'none',
            backgroundColor: '#9b59b6',
            color: 'white',
          }}
        >
          Stereo (12 faces)
        </button>
      </div>
      <p style={{ fontSize: '12px', color: '#888', marginTop: '20px' }}>
        Mono: Same image for both eyes | Stereo: Different images per eye
      </p>
    </div>
  )
}

function parseHash(): 'mono' | 'stereo' | null {
  const hash = window.location.hash.slice(1)
  return hash === 'mono' || hash === 'stereo' ? hash : null
}

function Root() {
  const [mode, setMode] = useState<'mono' | 'stereo' | null>(parseHash)

  useEffect(() => {
    const handleHashChange = () => setMode(parseHash())
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  const selectMode = (m: 'mono' | 'stereo') => {
    window.location.hash = m
    setMode(m)
  }

  if (!mode) {
    return <SelectionScreen onSelect={selectMode} />
  }

  return <App isStereo={mode === 'stereo'} />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)

import { useMemo } from 'react'
import { Tldraw } from 'tldraw'
import type { TLComponents } from 'tldraw'
import 'tldraw/tldraw.css'

interface CanvasProps {
  roomId: string
  onLoadPdf: () => void
}

export function Canvas({ roomId, onLoadPdf }: CanvasProps) {
  const components = useMemo<TLComponents>(
    () => ({
      SharePanel: () => (
        <div className="CanvasControls">
          <button onClick={onLoadPdf} className="load-pdf-btn">
            Load PDF
          </button>
          <span className="room-id">Room: {roomId}</span>
        </div>
      ),
    }),
    [roomId, onLoadPdf]
  )

  return <Tldraw components={components} />
}

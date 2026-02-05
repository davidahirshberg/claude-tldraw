import { useState, useEffect } from 'react'
import { loadPdf } from './PdfPicker'
import type { Pdf } from './PdfPicker'
import { PdfEditor } from './PdfEditor'
import { SvgDocumentEditor, loadSvgDocument } from './SvgDocument'
import { Canvas } from './Canvas'
import './App.css'

// Document configs - maps doc names to their SVG page URLs
const DOCUMENTS: Record<string, { name: string; pages: number; basePath: string }> = {
  'bregman': {
    name: 'Bregman Lower Bound',
    pages: 43,
    basePath: '/docs/page-',
  },
}

type SvgDoc = Awaited<ReturnType<typeof loadSvgDocument>>

type State =
  | { phase: 'canvas'; roomId: string }
  | { phase: 'loading'; message: string; roomId: string }
  | { phase: 'pdf'; pdf: Pdf; roomId: string }
  | { phase: 'svg'; document: SvgDoc; roomId: string }

function generateRoomId(): string {
  return `room-${Math.random().toString(36).slice(2, 10)}`
}

function App() {
  const [state, setState] = useState<State | null>(null)

  // Check URL params on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const pdfUrl = params.get('pdf')
    const docName = params.get('doc')
    const roomId = params.get('room') || generateRoomId()

    // Update URL with room ID if not present
    if (!params.get('room')) {
      const newUrl = new URL(window.location.href)
      newUrl.searchParams.set('room', roomId)
      window.history.replaceState({}, '', newUrl.toString())
    }

    if (docName && DOCUMENTS[docName]) {
      setState({ phase: 'loading', message: `Loading ${DOCUMENTS[docName].name}...`, roomId })
      loadDocument(docName, roomId)
    } else if (pdfUrl) {
      setState({ phase: 'loading', message: 'Loading PDF...', roomId })
      loadPdfFromUrl(pdfUrl, roomId)
    } else {
      // Start with blank canvas
      setState({ phase: 'canvas', roomId })
    }
  }, [])

  async function loadDocument(docName: string, roomId: string) {
    const config = DOCUMENTS[docName]
    if (!config) {
      setState({ phase: 'canvas', roomId })
      return
    }

    try {
      // Generate URLs for all pages
      const urls = Array.from({ length: config.pages }, (_, i) => {
        const pageNum = String(i + 1).padStart(2, '0')
        return `${config.basePath}${pageNum}.svg`
      })

      const document = await loadSvgDocument(config.name, urls)
      setState({ phase: 'svg', document, roomId })
    } catch (e) {
      console.error('Failed to load document:', e)
      setState({ phase: 'canvas', roomId })
    }
  }

  async function loadPdfFromUrl(url: string, roomId: string) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
      const buffer = await response.arrayBuffer()
      const name = url.split('/').pop() || 'document.pdf'
      const pdf = await loadPdf(name, buffer)
      setState({ phase: 'pdf', pdf, roomId })
    } catch (e) {
      console.error('Failed to load PDF:', e)
      setState({ phase: 'canvas', roomId })
    }
  }

  function handleLoadPdf() {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.addEventListener('change', async (e) => {
      const fileList = (e.target as HTMLInputElement).files
      if (!fileList || fileList.length === 0) return
      const file = fileList[0]

      const roomId = state?.roomId || generateRoomId()
      try {
        const pdf = await loadPdf(file.name, await file.arrayBuffer())

        const newUrl = new URL(window.location.href)
        newUrl.searchParams.set('room', roomId)
        window.history.replaceState({}, '', newUrl.toString())

        setState({ phase: 'pdf', pdf, roomId })
      } catch (e) {
        console.error('Failed to load PDF:', e)
      }
    })
    input.click()
  }

  if (!state) {
    return <div className="App loading">Loading...</div>
  }

  switch (state.phase) {
    case 'canvas':
      return (
        <div className="App">
          <Canvas roomId={state.roomId} onLoadPdf={handleLoadPdf} />
        </div>
      )
    case 'loading':
      return (
        <div className="App">
          <div className="LoadingScreen">
            <p>{state.message}</p>
          </div>
        </div>
      )
    case 'pdf':
      return (
        <div className="App">
          <PdfEditor pdf={state.pdf} roomId={state.roomId} />
        </div>
      )
    case 'svg':
      return (
        <div className="App">
          <SvgDocumentEditor document={state.document} roomId={state.roomId} />
        </div>
      )
  }
}

export default App

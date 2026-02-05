import { useState } from 'react'
import { AssetRecordType, Box, createShapeId } from 'tldraw'
import type { TLAssetId, TLShapeId } from 'tldraw'

export interface PdfPage {
  src: string
  bounds: Box
  assetId: TLAssetId
  shapeId: TLShapeId
}

export interface Pdf {
  name: string
  pages: PdfPage[]
  source: ArrayBuffer
}

const pageSpacing = 32

export async function loadPdf(name: string, source: ArrayBuffer): Promise<Pdf> {
  const PdfJS = await import('pdfjs-dist')
  PdfJS.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url
  ).toString()

  const pdf = await PdfJS.getDocument(source.slice(0)).promise
  const pages: PdfPage[] = []

  const canvas = window.document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Failed to create canvas context')

  const visualScale = 1.5
  const scale = window.devicePixelRatio

  let top = 0
  let widest = 0
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: scale * visualScale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({
      canvasContext: context,
      viewport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any).promise

    const width = viewport.width / scale
    const height = viewport.height / scale
    pages.push({
      src: canvas.toDataURL(),
      bounds: new Box(0, top, width, height),
      assetId: AssetRecordType.createId(),
      shapeId: createShapeId(),
    })
    top += height + pageSpacing
    widest = Math.max(widest, width)
  }
  canvas.width = 0
  canvas.height = 0

  for (const page of pages) {
    page.bounds.x = (widest - page.bounds.width) / 2
  }

  return {
    name,
    pages,
    source,
  }
}

interface PdfPickerProps {
  onOpenPdf: (pdf: Pdf) => void
  initialUrl?: string
}

export function PdfPicker({ onOpenPdf, initialUrl }: PdfPickerProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [url, setUrl] = useState(initialUrl || '')
  const [error, setError] = useState<string | null>(null)

  async function loadFromUrl(pdfUrl: string) {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(pdfUrl)
      if (!response.ok) throw new Error(`Failed to fetch: ${response.status}`)
      const buffer = await response.arrayBuffer()
      const name = pdfUrl.split('/').pop() || 'document.pdf'
      const pdf = await loadPdf(name, buffer)
      onOpenPdf(pdf)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load PDF')
      setIsLoading(false)
    }
  }

  function onClickOpenPdf() {
    const input = window.document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.addEventListener('change', async (e) => {
      const fileList = (e.target as HTMLInputElement).files
      if (!fileList || fileList.length === 0) return
      const file = fileList[0]

      setIsLoading(true)
      setError(null)
      try {
        const pdf = await loadPdf(file.name, await file.arrayBuffer())
        onOpenPdf(pdf)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load PDF')
        setIsLoading(false)
      }
    })
    input.click()
  }

  if (isLoading) {
    return <div className="PdfPicker">Loading PDF...</div>
  }

  return (
    <div className="PdfPicker">
      <h1>PDF Annotator</h1>

      <button onClick={onClickOpenPdf}>Open PDF from device</button>

      <div className="divider">or load from URL</div>

      <div className="url-input">
        <input
          type="text"
          placeholder="https://example.com/document.pdf"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && url && loadFromUrl(url)}
        />
        <button onClick={() => loadFromUrl(url)} disabled={!url}>
          Load
        </button>
      </div>

      {error && <div className="error">{error}</div>}
    </div>
  )
}

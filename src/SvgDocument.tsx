import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import {
  Box,
  SVGContainer,
  Tldraw,
  AssetRecordType,
  createShapeId,
  getIndicesBetween,
  react,
  sortByIndex,
  track,
  useEditor,
  DefaultToolbar,
} from 'tldraw'
import type { TLComponents, TLImageShape, TLShapePartial, Editor, TLShape, TLAssetId, TLShapeId } from 'tldraw'
import 'tldraw/tldraw.css'

interface SvgPage {
  src: string
  bounds: Box
  assetId: TLAssetId
  shapeId: TLShapeId
  width: number
  height: number
}

interface SvgDocument {
  name: string
  pages: SvgPage[]
}

interface SvgDocumentEditorProps {
  document: SvgDocument
  roomId: string
}

const pageSpacing = 32

export async function loadSvgDocument(name: string, svgUrls: string[]): Promise<SvgDocument> {
  // Fetch all SVGs in parallel
  console.log(`Loading ${svgUrls.length} SVG pages...`)

  const svgTexts = await Promise.all(
    svgUrls.map(async (url) => {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Failed to fetch ${url}`)
      return response.text()
    })
  )

  console.log('All SVGs fetched, processing...')

  const pages: SvgPage[] = []
  let top = 0
  let widest = 0

  for (let i = 0; i < svgTexts.length; i++) {
    const svgText = svgTexts[i]

    // Parse SVG to get dimensions
    const parser = new DOMParser()
    const doc = parser.parseFromString(svgText, 'image/svg+xml')
    const svgEl = doc.querySelector('svg')

    let width = 600
    let height = 800

    if (svgEl) {
      // Try to get dimensions from viewBox or width/height attributes
      const viewBox = svgEl.getAttribute('viewBox')
      const widthAttr = svgEl.getAttribute('width')
      const heightAttr = svgEl.getAttribute('height')

      if (viewBox) {
        const parts = viewBox.split(/\s+/)
        if (parts.length === 4) {
          width = parseFloat(parts[2]) || width
          height = parseFloat(parts[3]) || height
        }
      }

      if (widthAttr) {
        const w = parseFloat(widthAttr)
        if (!isNaN(w)) width = w
      }
      if (heightAttr) {
        const h = parseFloat(heightAttr)
        if (!isNaN(h)) height = h
      }
    }

    // Scale to reasonable size (target ~800px wide)
    const scale = 800 / width
    width = width * scale
    height = height * scale

    // Convert SVG to base64 data URL (TLDraw doesn't accept blob URLs)
    const dataUrl = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgText)))

    pages.push({
      src: dataUrl,
      bounds: new Box(0, top, width, height),
      assetId: AssetRecordType.createId(),
      shapeId: createShapeId(),
      width,
      height,
    })

    top += height + pageSpacing
    widest = Math.max(widest, width)
  }

  // Center pages
  for (const page of pages) {
    page.bounds.x = (widest - page.bounds.width) / 2
  }

  console.log('SVG document ready')
  return { name, pages }
}

export function SvgDocumentEditor({ document, roomId }: SvgDocumentEditorProps) {
  // Skip sync for now - just use local store
  const editorRef = useRef<Editor | null>(null)
  const [highlightMarker, setHighlightMarker] = useState<{ x: number; y: number } | null>(null)

  // WebSocket connection for forward sync (Claude → iPad)
  useEffect(() => {
    const ws = new WebSocket('ws://10.0.0.18:5175')

    ws.onopen = () => {
      console.log('WebSocket connected for forward sync')
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        const editor = editorRef.current
        if (!editor) return

        if (data.type === 'highlight') {
          console.log('Received highlight:', data)

          // Scroll to the highlighted location
          editor.centerOnPoint({ x: data.x, y: data.y }, { animation: { duration: 300 } })

          // Create a temporary highlight shape (unless noMarker is set)
          if (!data.noMarker) {
            const markerId = createShapeId()
            editor.createShape({
              id: markerId,
              type: 'geo',
              x: data.x - 30,
              y: data.y - 30,
              props: {
                geo: 'ellipse',
                w: 60,
                h: 60,
                fill: 'none',
                color: 'red',
                size: 'm',
              },
            })

            // Remove after 3 seconds
            setTimeout(() => {
              if (editor.getShape(markerId)) {
                editor.deleteShape(markerId)
              }
            }, 3000)
          }
        }

        // Just scroll, no marker
        if (data.type === 'scroll') {
          editor.centerOnPoint({ x: data.x, y: data.y }, { animation: { duration: 300 } })
        }

        if (data.type === 'note') {
          console.log('Received note:', data)

          // Scroll to the location
          editor.centerOnPoint({ x: data.x, y: data.y }, { animation: { duration: 300 } })

          // Create a note shape (sticky) - TLDraw 4.x uses richText
          editor.createShape({
            id: createShapeId(),
            type: 'note',
            x: data.x,
            y: data.y,
            props: {
              color: 'violet',  // Purple for Claude
              size: 'm',
              font: 'sans',
              align: 'start',
              verticalAlign: 'start',
              richText: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [{ type: 'text', text: data.text || '' }],
                  },
                ],
              },
            },
          })
        }

        // Reply to an existing note - append with highlight mark
        if (data.type === 'reply') {
          console.log('Received reply:', data)
          const targetId = data.shapeId as TLShapeId
          const shape = editor.getShape(targetId)

          if (shape && shape.type === 'note') {
            const noteShape = shape as TLShape & { props: { richText: { content: unknown[] } } }
            const existingRichText = noteShape.props.richText

            // Append with highlight mark using TLDraw color name
            const newContent = [
              ...existingRichText.content,
              { type: 'paragraph', content: [] },
              {
                type: 'paragraph',
                content: [{
                  type: 'text',
                  text: 'Claude: ' + (data.text || ''),
                  marks: [{ type: 'highlight', attrs: { color: 'violet' } }]
                }]
              }
            ]

            editor.updateShape({
              id: targetId,
              type: 'note',
              props: {
                richText: {
                  type: 'doc',
                  content: newContent,
                },
              },
            })

            editor.centerOnPoint({ x: shape.x, y: shape.y }, { animation: { duration: 300 } })
          }
        }
      } catch (e) {
        console.error('WebSocket message error:', e)
      }
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
    }

    ws.onerror = (e) => {
      console.error('WebSocket error:', e)
    }

    return () => {
      ws.close()
    }
  }, [])

  const components = useMemo<TLComponents>(
    () => ({
      PageMenu: null,
      Overlays: () => <HighlightOverlay marker={highlightMarker} />,
      SharePanel: () => <RoomInfo roomId={roomId} name={document.name} />,
      Toolbar: (props) => <DefaultToolbar {...props} orientation="vertical" />,
    }),
    [document, roomId, highlightMarker]
  )

  const licenseKey = 'tldraw-2027-01-19/WyJhUGMwcWRBayIsWyIqLnF0bTI4NS5naXRodWIuaW8iXSw5LCIyMDI3LTAxLTE5Il0.Hq9z1V8oTLsZKgpB0pI3o/RXCoLOsh5Go7Co53YGqHNmtEO9Lv/iuyBPzwQwlxQoREjwkkFbpflOOPmQMwvQSQ'

  return (
    <Tldraw
      licenseKey={licenseKey}
      onMount={(editor) => {
        // Expose editor for debugging/puppeteer access
        (window as unknown as { __tldraw_editor__: Editor }).__tldraw_editor__ = editor
        editorRef.current = editor
        setupSvgEditor(editor, document)
      }}
      components={components}
      forceMobile
    />
  )
}

// Overlay component to show highlight marker
const HighlightOverlay = track(function HighlightOverlay({ marker }: { marker: { x: number; y: number } | null }) {
  const editor = useEditor()

  if (!marker) return null

  // Convert page coordinates to screen coordinates
  const screenPoint = editor.pageToViewport({ x: marker.x, y: marker.y })

  return (
    <div
      className="highlight-marker"
      style={{
        position: 'absolute',
        left: screenPoint.x - 20,
        top: screenPoint.y - 20,
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: '3px solid #ff6b6b',
        backgroundColor: 'rgba(255, 107, 107, 0.2)',
        pointerEvents: 'none',
        animation: 'pulse 1s ease-in-out infinite',
      }}
    />
  )
})

function setupSvgEditor(editor: Editor, document: SvgDocument) {
  // Check if assets already exist (from sync)
  const existingAssets = editor.getAssets()
  const hasAssets = existingAssets.some(a => a.props && 'name' in a.props && a.props.name === 'svg-page')

  if (!hasAssets) {
    // Create assets for each page
    editor.createAssets(
      document.pages.map((page) => ({
        id: page.assetId,
        typeName: 'asset',
        type: 'image',
        meta: {},
        props: {
          w: page.width,
          h: page.height,
          mimeType: 'image/svg+xml',
          src: page.src,
          name: 'svg-page',
          isAnimated: false,
        },
      }))
    )

    // Create shapes for each page
    editor.createShapes(
      document.pages.map(
        (page): TLShapePartial<TLImageShape> => ({
          id: page.shapeId,
          type: 'image',
          x: page.bounds.x,
          y: page.bounds.y,
          isLocked: true,
          props: {
            assetId: page.assetId,
            w: page.bounds.w,
            h: page.bounds.h,
          },
        })
      )
    )
  }

  const shapeIds = document.pages.map((page) => page.shapeId)
  const shapeIdSet = new Set(shapeIds)

  // Don't let the user unlock the pages
  editor.sideEffects.registerBeforeChangeHandler('shape', (prev, next) => {
    if (!shapeIdSet.has(next.id)) return next
    if (next.isLocked) return next
    return { ...prev, isLocked: true }
  })

  // Make sure the shapes are below any of the other shapes
  function makeSureShapesAreAtBottom() {
    const shapes = shapeIds
      .map((id) => editor.getShape(id))
      .filter((s): s is TLShape => s !== undefined)
      .sort(sortByIndex)
    if (shapes.length === 0) return

    const pageId = editor.getCurrentPageId()
    const siblings = editor.getSortedChildIdsForParent(pageId)
    const currentBottomShapes = siblings
      .slice(0, shapes.length)
      .map((id) => editor.getShape(id)!)

    if (currentBottomShapes.every((shape, i) => shape?.id === shapes[i]?.id)) return

    const otherSiblings = siblings.filter((id) => !shapeIdSet.has(id))
    if (otherSiblings.length === 0) return

    const bottomSibling = otherSiblings[0]
    const bottomShape = editor.getShape(bottomSibling)
    if (!bottomShape) return

    const lowestIndex = bottomShape.index
    const indexes = getIndicesBetween(undefined, lowestIndex, shapes.length)

    editor.updateShapes(
      shapes.map((shape, i) => ({
        id: shape.id,
        type: shape.type,
        isLocked: true,
        index: indexes[i],
      }))
    )
  }

  makeSureShapesAreAtBottom()
  editor.sideEffects.registerAfterCreateHandler('shape', makeSureShapesAreAtBottom)
  editor.sideEffects.registerAfterChangeHandler('shape', makeSureShapesAreAtBottom)

  // Constrain the camera to the bounds of the pages
  const targetBounds = document.pages.reduce(
    (acc, page) => acc.union(page.bounds),
    document.pages[0].bounds.clone()
  )

  function updateCameraBounds(isMobile: boolean) {
    editor.setCameraOptions({
      constraints: {
        bounds: targetBounds,
        padding: { x: 100, y: 50 },
        origin: { x: 0.5, y: 0 },
        initialZoom: 'fit-x-100',
        baseZoom: 'default',
        behavior: 'free',
      },
    })
    editor.setCamera(editor.getCamera(), { reset: true })
  }

  let isMobile = editor.getViewportScreenBounds().width < 840

  react('update camera', () => {
    const isMobileNow = editor.getViewportScreenBounds().width < 840
    if (isMobileNow === isMobile) return
    isMobile = isMobileNow
    updateCameraBounds(isMobile)
  })

  updateCameraBounds(isMobile)
}

const PageOverlayScreen = track(function PageOverlayScreen({ document }: { document: SvgDocument }) {
  const editor = useEditor()
  const viewportPageBounds = editor.getViewportPageBounds()

  const relevantPageBounds = document.pages
    .map((page) => {
      if (!viewportPageBounds.collides(page.bounds)) return null
      return page.bounds
    })
    .filter((bounds): bounds is Box => bounds !== null)

  function pathForPageBounds(bounds: Box) {
    return `M ${bounds.x} ${bounds.y} L ${bounds.maxX} ${bounds.y} L ${bounds.maxX} ${bounds.maxY} L ${bounds.x} ${bounds.maxY} Z`
  }

  const viewportPath = `M ${viewportPageBounds.x} ${viewportPageBounds.y} L ${viewportPageBounds.maxX} ${viewportPageBounds.y} L ${viewportPageBounds.maxX} ${viewportPageBounds.maxY} L ${viewportPageBounds.x} ${viewportPageBounds.maxY} Z`

  return (
    <>
      <SVGContainer className="PageOverlayScreen-screen">
        <path
          d={`${viewportPath} ${relevantPageBounds.map(pathForPageBounds).join(' ')}`}
          fillRule="evenodd"
        />
      </SVGContainer>
      {relevantPageBounds.map((bounds, i) => (
        <div
          key={i}
          className="PageOverlayScreen-outline"
          style={{
            width: bounds.w,
            height: bounds.h,
            transform: `translate(${bounds.x}px, ${bounds.y}px)`,
          }}
        />
      ))}
    </>
  )
})

function RoomInfo({ roomId, name }: { roomId: string; name: string }) {
  const editor = useEditor()
  const [shareState, setShareState] = useState<'idle' | 'sending' | 'success' | 'error'>('idle')

  const shareSnapshot = useCallback(async () => {
    if (shareState === 'sending') return

    console.log('Share clicked')
    setShareState('sending')

    try {
      const snapshot = editor.store.getStoreSnapshot()
      console.log('Got snapshot, size:', JSON.stringify(snapshot).length)
      const resp = await fetch('http://10.0.0.18:5174/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(snapshot),
      })
      console.log('Fetch response:', resp.status)

      if (resp.ok) {
        setShareState('success')
        setTimeout(() => setShareState('idle'), 1500)
      } else {
        setShareState('error')
        setTimeout(() => setShareState('idle'), 2000)
      }
    } catch (e) {
      console.error('Share error:', e)
      setShareState('error')
      setTimeout(() => setShareState('idle'), 2000)
    }
  }, [editor, shareState])

  return (
    <div className="RoomInfo">
      <button
        onClick={shareSnapshot}
        className={`share-btn share-btn--${shareState}`}
        disabled={shareState === 'sending'}
        aria-label="Share"
      >
        ✳
      </button>
    </div>
  )
}

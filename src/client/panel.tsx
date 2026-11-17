// Modified for dsh-webdev-viewer from @linxin666/dsh-client-ui-browser-view 0.4.19 (Apache-2.0). See NOTICE.
/**
 * The browser view tab's content, mounted by the right sidebar into its
 * content area under the 'webdev' tab type.
 *
 * The shell owns the column, the chip, the close control and the switch between
 * tabs; this file owns what is drawn inside one tab and scrolls inside it. It
 * therefore has no title bar of its own and no "back" control - a page header
 * in a sidebar tab would repeat the chip right above it - and it fills the
 * height it is given instead of positioning itself against the viewport.
 *
 * The body is laid out like the shipped browser tab's chrome: one 38px toolbar
 * holding the address display, the connection marker and the one control this
 * plugin actually has - refresh the captured frame - then the frame itself,
 * then the action trace. Nothing here claims a capability the host does not
 * expose: there is no forward/back pair, no reload of the page (the host drives
 * navigation, this side only observes it) and no "open in a new window",
 * because the page lives in a Chromium process on the host.
 *
 * The refresh control and the state marker are the product's own atoms -
 * IconRefreshOutlineRegular and StateDot from @deepseek-ai/dsh-client-ui-primitives,
 * the same two the shipped browser tab's toolbar uses - so the chrome is drawn
 * from one source rather than redrawn beside it. The package's Vite config
 * inlines @deepseek-ai packages, which is what lets the jsdom body tests load
 * that entry point (it imports its own stylesheets).
 *
 * Frame rendering: an <img> fed a base64 JPEG data URL, not a <canvas>. The host
 * already decoded and re-encoded the frame (CDP gives it JPEG base64), so there
 * are no pixels for this side to compose - a canvas would add a drawImage hop,
 * a context lifecycle and an invalidation race for zero gain, while the image
 * element decodes off the main thread and lets CSS own the aspect-ratio fit.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  IconRefreshOutlineRegular,
  StateDot,
  type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { BrowserActionTrace, BrowserInputEvent, BrowserPanelState, BrowserPickedElement } from '../core/protocol.ts'
import { BROWSER_VIEW_API_VERSION } from '../core/protocol.ts'
import type { BrowserViewLiveTitleStore } from './live-title.ts'
import { BROWSER_VIEW_PARTS, BROWSER_VIEW_PLUGIN } from './semantic.ts'
import {
  connectBrowserViewSocket,
  type BrowserViewFrame,
  type BrowserViewSocket,
  type BrowserViewSocketHandlers,
  type BrowserViewSocketStatus,
} from './socket.ts'
import css from './panel.module.css'
import { NativeBrowser, nativeBrowserAvailable, type NativeBrowserHandle } from './native-browser.tsx'

/** Page-side socket factory; tests inject a fake transport through it. */
export type BrowserViewSocketFactory = (handlers: BrowserViewSocketHandlers) => BrowserViewSocket

/** Business face injected into the tab body. */
export interface BrowserViewPanelFace {
  /** Session whose screencast this body shows. */
  readonly sessionId?: string
  /** Channel the chip reads this body's page title from. */
  readonly liveTitle?: BrowserViewLiveTitleStore
  /** Composer insertion seat; absent outside a session-scoped tab. */
  readonly inputActions?: ComposerInputActions
}

/** The composer operation a pick uses; intentionally structural. */
export interface ComposerInputActions {
  /**
   * Insert one quote into the current draft.
   * @param text - quote text.
   * @returns whether the draft accepted the insertion.
   */
  insertQuote(text: string): boolean
}

/** Panel props: the locale seat, the injected face, and the seams a test may supply. */
export type BrowserViewPanelProps = PropsLocale<'webdev'> & Partial<BrowserViewPanelFace> & {
  /** Socket factory override; defaults to the real same-origin connection. */
  readonly socketFactory?: BrowserViewSocketFactory
  /** Origin override; defaults to the page's own location. */
  readonly location?: { readonly protocol: string; readonly host: string }
}

/** Trace rows kept on screen; older tool calls scroll out of relevance. */
const TRACE_LIMIT = 5

/** State before the host publishes anything. */
const EMPTY_STATE: BrowserPanelState = { tabs: [], activeTabId: null, running: false }

/** Join truthy class names (CSS Modules maps are typed as plain records). */
function cx(...names: ReadonlyArray<string | false | null | undefined>): string {
  return names.filter((name): name is string => typeof name === 'string' && name.length > 0).join(' ')
}

/** Clamp one coordinate into the frame's logical space. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Keys the page should receive as real key events rather than text insertion. */
const KEY_NAMES = new Set([
  'Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown',
  'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown',
])

/** CDP modifier bitmask: Alt 1, Ctrl 2, Meta 4, Shift 8. */
function modifiersOf(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number {
  return (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0)
}

/** Render picked elements as one composer quote. */
function formatPicks(picks: ReadonlyArray<BrowserPickedElement>, url: string): string {
  const lines = [`## WebDev picks (${picks.length})`, `Page: ${url}`]
  picks.forEach((pick, index) => {
    const label = [
      pick.tag,
      pick.id === undefined ? '' : `#${pick.id}`,
      pick.classes === undefined || pick.classes.length === 0 ? '' : `.${pick.classes.join('.')}`,
    ].join('')
    lines.push('', `### ${index + 1}. ${label}${pick.name === undefined ? '' : ` "${pick.name}"`}`)
    lines.push(`- selector: \`${pick.selector}\``)
    lines.push(`- fingerprint: \`${pick.fingerprint}\``)
    if (pick.role !== undefined) lines.push(`- role: ${pick.role}`)
    if (pick.box !== undefined) lines.push(`- box: ${pick.box.x},${pick.box.y} ${pick.box.width}x${pick.box.height}`)
    if (pick.source?.file !== undefined) lines.push(`- source: ${pick.source.file}${pick.source.line === undefined ? '' : `:${pick.source.line}`}`)
    if (pick.source?.component !== undefined) lines.push(`- component: ${pick.source.component}`)
    if (pick.note !== undefined && pick.note.trim().length > 0) lines.push(`- note: ${pick.note.trim()}`)
    if (pick.text !== undefined) lines.push(`- text: ${pick.text}`)
  })
  lines.push('', 'Use webdev_snapshot to confirm the current DOM before acting; a pick can be stale.')
  return lines.join('\n')
}

/** Common temporary style properties exposed by the native page inspector. */
const STYLE_FIELDS = [
  { key: 'color', label: 'panel.style.color' },
  { key: 'background-color', label: 'panel.style.background' },
  { key: 'font-size', label: 'panel.style.fontSize' },
  { key: 'padding', label: 'panel.style.padding' },
  { key: 'margin', label: 'panel.style.margin' },
  { key: 'border-radius', label: 'panel.style.radius' },
] as const

/** Cursor mark for the interact toggle. */
function CursorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M3 1.5l9.5 6.2-4.1.8-2.1 3.9L3 1.5z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

/** Eye mark for the watch toggle. */
function EyeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path d="M1.5 8s2.4-4 6.5-4 6.5 4 6.5 4-2.4 4-6.5 4S1.5 8 1.5 8z" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

/** Crosshair mark for the pick toggle. */
function PickIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="4.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1v3M8 12v3M1 8h3M12 8h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/** Monitor mark for the desktop/CDP view switch. */
function MonitorIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="1.5" y="2.5" width="13" height="9" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M6 13.5h4M8 11.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Render the browser view tab body.
 * @param props - composed slot props.
 * @returns the tab content.
 */
export function BrowserViewPanel({ t, sessionId, liveTitle, inputActions, socketFactory, location }: BrowserViewPanelProps) {
  const [state, setState] = useState<BrowserPanelState>(EMPTY_STATE)
  const [frame, setFrame] = useState<BrowserViewFrame | null>(null)
  const [traces, setTraces] = useState<ReadonlyArray<BrowserActionTrace>>([])
  const [error, setError] = useState<{ readonly code: string; readonly message: string } | null>(null)
  const [status, setStatus] = useState<BrowserViewSocketStatus>('connecting')
  const [interact, setInteract] = useState(true)
  const [picking, setPicking] = useState(false)
  const [pagePickerActive, setPagePickerActive] = useState(false)
  const [picks, setPicks] = useState<ReadonlyArray<BrowserPickedElement>>([])
  const [hoverPick, setHoverPick] = useState<BrowserPickedElement | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [pickNotice, setPickNotice] = useState<string | null>(null)
  const nativeAvailable = useMemo(() => nativeBrowserAvailable(), [])
  const [nativeMode, setNativeMode] = useState(() => nativeBrowserAvailable())
  const [nativeUrl, setNativeUrl] = useState('')
  const [nativeTitle, setNativeTitle] = useState('')
  const [nativeLoading, setNativeLoading] = useState(false)
  const [nativeAddress, setNativeAddress] = useState('')
  const [nativeError, setNativeError] = useState<string | null>(null)
  const [styleOpen, setStyleOpen] = useState(false)
  const [styleValues, setStyleValues] = useState<Record<string, string>>({})
  const [styleOriginal, setStyleOriginal] = useState<Record<string, string>>({})
  const [styleError, setStyleError] = useState<string | null>(null)
  const nativeRef = useRef<NativeBrowserHandle | null>(null)
  const socketRef = useRef<BrowserViewSocket | null>(null)
  const frameHostRef = useRef<HTMLDivElement | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const imeRef = useRef<HTMLTextAreaElement | null>(null)
  const pickRequestRef = useRef<string | null>(null)
  const hoverRequestRef = useRef<string | null>(null)
  const lastHoverAtRef = useRef(0)
  const frameDataRef = useRef<BrowserViewFrame | null>(null)
  const interactRef = useRef(interact)
  interactRef.current = interact
  const lastPointerMoveRef = useRef(0)
  /** Last active tab seen in a state push; a tab switch invalidates the picture. */
  const lastActiveTabRef = useRef<string | null>(null)
  /** Browser source seen in the last state push; a source switch invalidates it too. */
  const lastSourceRef = useRef<{ mode?: 'isolated' | 'cdp'; cdpEndpoint?: string }>({})

  const factory = useMemo<BrowserViewSocketFactory>(
    () => socketFactory ?? ((handlers) => connectBrowserViewSocket(handlers, { location, sessionId })),
    [socketFactory, location, sessionId],
  )

  useEffect(() => {
    const instance = factory({
      onStatus: (next) => { setStatus(next) },
      onState: (next) => {
        // Compare outside the state updater: an updater must stay pure. A frame
        // from the old browser source or the previous tab must not outlive it.
        const sourceChanged = lastSourceRef.current.mode !== next.mode
          || lastSourceRef.current.cdpEndpoint !== next.cdpEndpoint
        if (sourceChanged) {
          lastSourceRef.current = { mode: next.mode, cdpEndpoint: next.cdpEndpoint }
          lastActiveTabRef.current = next.activeTabId
          setFrame(null)
          setError(null)
          setPicks([])
          setPicking(false)
          setPagePickerActive(false)
          setPickError(null)
          setPickNotice(null)
          setHoverPick(null)
          pickRequestRef.current = null
          hoverRequestRef.current = null
        } else if (lastActiveTabRef.current !== next.activeTabId) {
          lastActiveTabRef.current = next.activeTabId
          setFrame(null)
          setPicks([])
          setPicking(false)
          setPagePickerActive(false)
          setPickError(null)
          setPickNotice(null)
          setHoverPick(null)
          pickRequestRef.current = null
          hoverRequestRef.current = null
        }
        setState(next)
      },
      onFrame: (next) => {
        setError(null)
        setFrame(next)
      },
      onAction: (trace) => {
        setTraces((current) => [trace, ...current].slice(0, TRACE_LIMIT))
      },
      onPickResult: (result) => {
        if (result.requestId.startsWith('page-')) {
          const element = result.element
          if (element !== undefined) {
            setPicks((current) => [...current, element])
            setStyleOpen(false)
            setPickError(null)
            setPickNotice(null)
          } else if (result.error !== undefined) {
            setPickError(result.error)
          }
          return
        }
        if (result.requestId === pickRequestRef.current) {
          pickRequestRef.current = null
          setHoverPick(null)
          if (result.error !== undefined) {
            setPickError(result.error)
            return
          }
          const element = result.element
          if (element !== undefined) {
            setPicks((current) => [...current, element])
            setStyleOpen(false)
            setPickError(null)
            setPickNotice(null)
          }
          return
        }
        if (result.requestId === hoverRequestRef.current) {
          hoverRequestRef.current = null
          if (result.error !== undefined) {
            setHoverPick(null)
            return
          }
          setHoverPick(result.element ?? null)
        }
      },
      onPickMode: (enabled) => {
        setPagePickerActive(enabled)
        if (!enabled) setHoverPick(null)
      },
      onNativeRequest: (request) => {
        const native = nativeRef.current
        if (native === null) {
          socketRef.current?.send({
            v: BROWSER_VIEW_API_VERSION,
            kind: 'native-result',
            requestId: request.requestId,
            error: 'the desktop view is not mounted',
          })
          return
        }
        void native.request(request.op, request.args).then(
          (result) => {
            socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'native-result', requestId: request.requestId, result })
          },
          (error: unknown) => {
            socketRef.current?.send({
              v: BROWSER_VIEW_API_VERSION,
              kind: 'native-result',
              requestId: request.requestId,
              error: error instanceof Error ? error.message : String(error),
            })
          },
        )
      },
      onError: (code, message) => { setError({ code, message }) },
    })
    socketRef.current = instance
    return () => {
      socketRef.current = null
      instance.close()
    }
  }, [factory])

  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId) ?? null
  // Loading is per tab on the wire; the connection phase joins it so a page
  // that is still dialing never claims to be live.
  const loading = activeTab?.loading === true || status !== 'open'
  // The wire carries two failure channels: an explicit error push, and the
  // message a state push may use to say "show this instead of a frame". Both
  // land on the same block so the tab never shows a stale picture beside a host
  // complaint.
  const hostError = state.message !== undefined && state.message.length > 0
    ? { code: '', message: state.message }
    : null
  const effectiveError = error ?? hostError
  // One narrowed value for the stage: a frame is only paintable when the host
  // reported no error, which keeps the null check off the JSX branch.
  const visibleFrame = effectiveError === null ? frame : null
  const dataUrl = visibleFrame === null ? null : `data:image/png;base64,${visibleFrame.data}`
  const nativeActive = nativeAvailable && nativeMode
  const pageTitle = activeTab === null || activeTab.title.length === 0 ? undefined : activeTab.title
  const url = activeTab?.url ?? ''
  const displayUrl = nativeActive ? nativeUrl || url : url
  const displayTitle = nativeActive ? nativeTitle || pageTitle : pageTitle
  const effectiveLoading = nativeActive ? nativeLoading : loading
  // The marker names what the viewer is actually looking at: the socket's phase
  // first (nothing is live before the host answers), then the page's own load
  // state. The same three strings the trace footer used to carry.
  const statusLabel = nativeActive
    ? nativeLoading ? t('panel.status.loading') : t('panel.status.live')
    : status !== 'open'
      ? t('panel.status.connecting')
      : loading ? t('panel.status.loading') : t('panel.status.live')
  // Three of the product's five dot states, in the order a viewer meets them:
  // nothing reached yet, a page still loading, a settled live picture.
  const dotState: StateDotState = nativeActive
    ? nativeLoading ? 'ongoing' : 'done'
    : status !== 'open' ? 'idle' : loading ? 'ongoing' : 'done'
  const modeLabel = nativeActive ? '' : state.mode === 'cdp' ? t('panel.mode.real') : t('panel.mode.isolated')

  frameDataRef.current = visibleFrame
  const frameVisible = dataUrl !== null

  // A native listener because React's wheel subscription is passive: without
  // preventDefault the column scrolls instead of the page.
  useEffect(() => {
    const host = frameHostRef.current
    if (host === null) return
    const onWheel = (event: WheelEvent): void => {
      const current = frameDataRef.current
      if (!interactRef.current || current === null) return
      const target = imageRef.current
      const rect = contentRectOf(target) ?? host.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return
      if (event.clientX < rect.left || event.clientX > rect.left + rect.width || event.clientY < rect.top || event.clientY > rect.top + rect.height) return
      event.preventDefault()
      const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? current.height : 1
      socketRef.current?.send({
        v: BROWSER_VIEW_API_VERSION,
        kind: 'input',
        event: {
          type: 'wheel',
          x: clamp((event.clientX - rect.left) * current.width / rect.width, 0, current.width),
          y: clamp((event.clientY - rect.top) * current.height / rect.height, 0, current.height),
          deltaX: event.deltaX * scale,
          deltaY: event.deltaY * scale,
          modifiers: modifiersOf(event),
        },
      })
    }
    host.addEventListener('wheel', onWheel, { passive: false })
    return () => { host.removeEventListener('wheel', onWheel) }
  }, [frameVisible])

  // Set the page viewport to the pixels the panel actually occupies: the
  // image's displayed width (object-fit can make it narrower than the host)
  // and the host's available height. Sending the image's natural height would
  // leave a short page with a blank strip; sending the host's outer width is
  // what made an 863px page render into a narrower sidebar.
  useEffect(() => {
    if (nativeActive) return
    const host = frameHostRef.current
    if (host === null) return
    const image = imageRef.current
    let timer: ReturnType<typeof setTimeout> | undefined
    let last = { width: 0, height: 0 }
    const send = (): void => {
      const content = contentRectOf(image)
      const width = Math.round(content?.width ?? host.clientWidth)
      const height = Math.round(host.clientHeight)
      if (width < 240 || height < 240) return
      if (Math.abs(width - last.width) < 2 && Math.abs(height - last.height) < 2) return
      last = { width, height }
      socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'viewport', width, height })
    }
    if (typeof ResizeObserver === 'undefined') {
      send()
      return
    }
    const observer = new ResizeObserver(() => {
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(send, 120)
    })
    observer.observe(host)
    if (image !== null) observer.observe(image)
    send()
    // A data URL can still be decoding when the effect runs; naturalWidth is 0
    // until it completes, so retry once after decode instead of quietly
    // keeping the host size.
    if (image !== null && image.naturalWidth === 0 && typeof image.decode === 'function') {
      void image.decode().then(send).catch(() => undefined)
    }
    return () => {
      observer.disconnect()
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [frameVisible, state.activeTabId, nativeActive])

  const pointOf = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const host = frameHostRef.current
    const current = frameDataRef.current
    if (host === null || current === null) return null
    const rect = contentRectOf(imageRef.current) ?? host.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    if (clientX < rect.left || clientX > rect.left + rect.width || clientY < rect.top || clientY > rect.top + rect.height) return null
    return {
      x: clamp((clientX - rect.left) * current.width / rect.width, 0, current.width),
      y: clamp((clientY - rect.top) * current.height / rect.height, 0, current.height),
    }
  }

  const sendInput = (event: BrowserInputEvent): void => {
    socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'input', event })
  }

  const focusIme = (): void => {
    const element = imeRef.current
    if (element !== null && document.activeElement !== element) element.focus({ preventScroll: true })
  }

  const pointerButton = (event: React.PointerEvent<HTMLDivElement>): 'left' | 'middle' | 'right' => {
    return event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left'
  }

  /** The rendered image content box inside an object-fit:contain element. */
  const contentRectOf = (image: HTMLImageElement | null): { left: number; top: number; width: number; height: number } | null => {
    if (image === null) return null
    const rect = image.getBoundingClientRect()
    const naturalWidth = image.naturalWidth
    const naturalHeight = image.naturalHeight
    if (rect.width <= 0 || rect.height <= 0 || naturalWidth <= 0 || naturalHeight <= 0) return null
    const scale = Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
    const width = naturalWidth * scale
    const height = naturalHeight * scale
    return {
      left: rect.left + (rect.width - width) / 2,
      top: rect.top + (rect.height - height) / 2,
      width,
      height,
    }
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (visibleFrame === null) return
    const point = pointOf(event.clientX, event.clientY)
    if (point === null) return
    if (picking) {
      event.preventDefault()
      if (pagePickerActive) {
        // The page owns this gesture: its injected picker turns the click into
        // a binding call that works in the real browser window too.
        focusIme()
        event.currentTarget.setPointerCapture(event.pointerId)
        sendInput({
          type: 'mouse',
          action: 'down',
          x: point.x,
          y: point.y,
          button: pointerButton(event),
          buttons: event.buttons === 0 ? 1 : event.buttons,
          clickCount: event.detail > 0 ? event.detail : 1,
          modifiers: modifiersOf(event),
        })
        return
      }
      const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
      pickRequestRef.current = requestId
      hoverRequestRef.current = null
      setHoverPick(null)
      setPickError(null)
      setPickNotice(null)
      socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'pick', requestId, x: point.x, y: point.y })
      return
    }
    if (!interact) return
    event.preventDefault()
    focusIme()
    event.currentTarget.setPointerCapture(event.pointerId)
    sendInput({
      type: 'mouse',
      action: 'down',
      x: point.x,
      y: point.y,
      button: pointerButton(event),
      buttons: event.buttons === 0 ? 1 : event.buttons,
      clickCount: event.detail > 0 ? event.detail : 1,
      modifiers: modifiersOf(event),
    })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (visibleFrame === null) return
    if (!interact && !picking) return
    const point = pointOf(event.clientX, event.clientY)
    if (picking) {
      if (pagePickerActive) {
        const now = Date.now()
        if (event.buttons === 0 && now - lastPointerMoveRef.current < 16) return
        lastPointerMoveRef.current = now
        if (point === null) return
        sendInput({
          type: 'mouse',
          action: 'move',
          x: point.x,
          y: point.y,
          button: 'none',
          buttons: event.buttons,
          clickCount: 0,
          modifiers: modifiersOf(event),
        })
        return
      }
      // A hover probe is the same element resolution as a pick, but it never
      // appends to the quote. Throttle it so a mouse sweep is not a CDP flood.
      const now = Date.now()
      if (now - lastHoverAtRef.current < 90) return
      lastHoverAtRef.current = now
      if (point === null) {
        setHoverPick(null)
        return
      }
      const requestId = `hover-${now.toString(36)}-${Math.random().toString(36).slice(2)}`
      hoverRequestRef.current = requestId
      socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'pick', requestId, x: point.x, y: point.y })
      return
    }
    const now = Date.now()
    if (event.buttons === 0 && now - lastPointerMoveRef.current < 16) return
    lastPointerMoveRef.current = now
    if (point === null) return
    sendInput({
      type: 'mouse',
      action: 'move',
      x: point.x,
      y: point.y,
      button: 'none',
      buttons: event.buttons,
      clickCount: 0,
      modifiers: modifiersOf(event),
    })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (visibleFrame === null) return
    if (picking && !pagePickerActive) return
    if (!picking && !interact) return
    const point = pointOf(event.clientX, event.clientY)
    if (point === null) return
    event.preventDefault()
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    sendInput({
      type: 'mouse',
      action: 'up',
      x: point.x,
      y: point.y,
      button: pointerButton(event),
      buttons: 0,
      clickCount: 1,
      modifiers: modifiersOf(event),
    })
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (!interact) return
    const native = event.nativeEvent
    if (native.isComposing || native.key === 'Process' || native.key === 'Unidentified') return
    if (native.key.length !== 1 && !KEY_NAMES.has(native.key)) return
    event.preventDefault()
    const key = native.key === ' ' ? 'Space' : native.key
    sendInput({ type: 'key', action: 'down', key, code: native.code, modifiers: modifiersOf(native) })
    sendInput({ type: 'key', action: 'up', key, code: native.code, modifiers: modifiersOf(native) })
    event.currentTarget.value = ''
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    if (!interact) return
    const text = event.clipboardData.getData('text')
    if (text.length === 0) return
    event.preventDefault()
    sendInput({ type: 'text', text })
    event.currentTarget.value = ''
  }

  const onCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>): void => {
    if (!interact) return
    const text = event.data
    if (text.length > 0) sendInput({ type: 'text', text })
    event.currentTarget.value = ''
  }

  const clearPicks = (): void => {
    setPicks([])
    setPicking(false)
    setPagePickerActive(false)
    setHoverPick(null)
    setPickError(null)
    setPickNotice(null)
    setStyleOpen(false)
    pickRequestRef.current = null
    hoverRequestRef.current = null
    if (!nativeActive) socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'pick-mode', enabled: false })
  }

  const updatePickNote = (index: number, note: string): void => {
    setPicks((current) => {
      if (index < 0 || index >= current.length) return current
      const next = current.slice()
      next[index] = { ...next[index], note }
      return next
    })
  }

  const lastPick = picks[picks.length - 1]

  const openStyle = async (): Promise<void> => {
    if (!nativeActive || lastPick === undefined) return
    setStyleOpen(true)
    setStyleError(null)
    try {
      const values = await nativeRef.current?.request('style-get', {
        selector: lastPick.selector,
        properties: STYLE_FIELDS.map((field) => field.key),
      })
      if (typeof values === 'object' && values !== null) {
        const next: Record<string, string> = {}
        for (const field of STYLE_FIELDS) {
          const value = (values as Record<string, unknown>)[field.key]
          if (typeof value === 'string') next[field.key] = value
        }
        setStyleValues(next)
        setStyleOriginal(next)
      }
    } catch (error) {
      setStyleError(error instanceof Error ? error.message : String(error))
    }
  }

  const setStyle = (property: string, value: string): void => {
    if (!nativeActive || lastPick === undefined) return
    setStyleValues((current) => ({ ...current, [property]: value }))
    setStyleError(null)
    void nativeRef.current?.request('style-set', {
      selector: lastPick.selector,
      property,
      value,
    }).catch((error: unknown) => {
      setStyleError(error instanceof Error ? error.message : String(error))
    })
  }

  const resetStyle = (property: string): void => {
    if (!nativeActive || lastPick === undefined) return
    setStyleValues((current) => ({ ...current, [property]: styleOriginal[property] ?? '' }))
    setStyleError(null)
    void nativeRef.current?.request('style-reset', {
      selector: lastPick.selector,
      property,
    }).catch((error: unknown) => {
      setStyleError(error instanceof Error ? error.message : String(error))
    })
  }

  const sendStyle = (): void => {
    if (lastPick === undefined) return
    const changed = STYLE_FIELDS.filter((field) => (styleValues[field.key] ?? '') !== (styleOriginal[field.key] ?? ''))
    if (changed.length === 0) {
      setStyleError(t('panel.style.noChanges'))
      return
    }
    const lines = [
      '## WebDev style change',
      `Page: ${displayUrl}`,
      `Element: \`${lastPick.selector}\``,
      '',
      ...changed.map((field) => `- ${field.key}: ${styleOriginal[field.key] ?? ''} -> ${styleValues[field.key] ?? ''}`),
      '',
      'Temporary preview only; update the source to persist it.',
    ]
    const accepted = inputActions?.insertQuote(lines.join('\n'))
    if (accepted === false) {
      setStyleError(t('panel.pick.insertFailed'))
      return
    }
    setStyleOpen(false)
    setPickNotice(t('panel.style.sent'))
  }

  const togglePicking = (): void => {
    const next = !picking
    setPicking(next)
    setPagePickerActive(false)
    setHoverPick(null)
    hoverRequestRef.current = null
    setPickError(null)
    setPickNotice(null)
    // Native mode injects the picker into the guest; CDP mode asks the host to
    // do the same in the attached page.
    if (nativeActive) return
    socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'pick-mode', enabled: next })
  }

  const toggleNativeMode = (): void => {
    if (!nativeAvailable) return
    const next = !nativeMode
    setNativeMode(next)
    setPicking(false)
    setPagePickerActive(false)
    setPickError(null)
    setPickNotice(null)
    setStyleOpen(false)
    setNativeError(null)
    if (next) setNativeAddress(nativeUrl || url)
  }

  const sendPicks = (): void => {
    if (picks.length === 0) return
    const quote = formatPicks(picks, nativeActive ? nativeUrl || url : url)
    const accepted = inputActions?.insertQuote(quote)
    if (accepted === true) {
      if (!nativeActive) {
        socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'pick-mode', enabled: false })
      }
      setPicks([])
      setPicking(false)
      setPagePickerActive(false)
      setHoverPick(null)
      setStyleOpen(false)
      setPickError(null)
      setPickNotice(t('panel.pick.sent'))
      return
    }
    if (accepted === false) {
      setPickError(t('panel.pick.insertFailed'))
      return
    }
    // No composer seat (for example a tab rendered outside a session): keep the
    // review useful by putting the quote on the clipboard instead of dropping it.
    void navigator.clipboard?.writeText(quote).then(
      () => { setPickNotice(t('panel.pick.copied')) },
      () => { setPickError(t('panel.pick.copyFailed')) },
    )
  }

  const pickCount = t('panel.pick.count').replace('{count}', String(picks.length))

  /** Map a pick's frame-space box onto the displayed image. */
  const boxStyle = (pick: BrowserPickedElement): CSSProperties | undefined => {
    if (visibleFrame === null || pick.box === undefined) return undefined
    const box = pick.box
    return {
      left: `${box.x / visibleFrame.width * 100}%`,
      top: `${box.y / visibleFrame.height * 100}%`,
      width: `${box.width / visibleFrame.width * 100}%`,
      height: `${box.height / visibleFrame.height * 100}%`,
    }
  }
  const hoverStyle = hoverPick === null ? undefined : boxStyle(hoverPick)
  const pickLabel = (pick: BrowserPickedElement): string => `${pick.tag}${pick.id === undefined ? '' : `#${pick.id}`}`

  // The chip beside this tab names the page being streamed, and only this body
  // can know that name. Publishing in an effect keeps render pure; the cleanup
  // clears the entry so a closed tab leaves no stale name behind.
  useEffect(() => {
    liveTitle?.set(sessionId, displayTitle)
    return () => { liveTitle?.set(sessionId, undefined) }
  }, [liveTitle, sessionId, displayTitle])

  // Tell the host which panel owns the desktop guest so desktop_* tools can
  // route requests to this exact webview. Re-send whenever the socket reaches
  // open again: a host reload reconnects the socket without remounting this body.
  useEffect(() => {
    if (!nativeActive || status !== 'open') return
    socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'native-attach', sessionId })
    return () => { socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'native-detach' }) }
  }, [nativeActive, status, sessionId])

  return (
    <div className={css.root} data-dsh-plugin={BROWSER_VIEW_PLUGIN} data-dsh-part={BROWSER_VIEW_PARTS.panel}>
      <div className={css.toolbar} data-dsh-part={BROWSER_VIEW_PARTS.toolbar}>
        <div className={css.addressBox} data-dsh-part={BROWSER_VIEW_PARTS.address}>
          {nativeActive ? (
            <input
              className={css.address}
              type="text"
              value={nativeAddress.length > 0 ? nativeAddress : displayUrl}
              title={displayUrl.length > 0 ? displayUrl : undefined}
              placeholder={t('panel.native.address')}
              aria-label={t('panel.address.label')}
              spellCheck={false}
              onChange={(event) => { setNativeAddress(event.currentTarget.value) }}
              onFocus={(event) => { event.currentTarget.select() }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return
                event.preventDefault()
                const next = nativeAddress.trim()
                if (next.length === 0) return
                setNativeError(null)
                nativeRef.current?.loadUrl(next)
              }}
            />
          ) : (
            <input
              className={css.address}
              type="text"
              readOnly
              value={url}
              title={url.length > 0 ? url : undefined}
              placeholder={t('panel.url.empty')}
              aria-label={t('panel.address.label')}
              spellCheck={false}
              // Selecting on click is the address bar's own gesture: the whole
              // address is ready to copy without a second control.
              onFocus={(event) => { event.currentTarget.select() }}
              onClick={(event) => { event.currentTarget.select() }}
            />
          )}
        </div>
        {nativeAvailable && (
          <button
            type="button"
            className={cx(css.tool, nativeActive && css.toolActive)}
            title={nativeActive ? t('panel.native.switchToCdp') : t('panel.native.switchToNative')}
            aria-label={nativeActive ? t('panel.native.switchToCdp') : t('panel.native.switchToNative')}
            aria-pressed={nativeActive}
            onClick={toggleNativeMode}
          >
            <MonitorIcon />
          </button>
        )}
        {nativeActive && (
          <>
            <button
              type="button"
              className={css.tool}
              title={t('panel.native.back')}
              aria-label={t('panel.native.back')}
              onClick={() => { nativeRef.current?.goBack() }}
            >
              ‹
            </button>
            <button
              type="button"
              className={css.tool}
              title={t('panel.native.forward')}
              aria-label={t('panel.native.forward')}
              onClick={() => { nativeRef.current?.goForward() }}
            >
              ›
            </button>
          </>
        )}
        {!nativeActive && (
          <button
            type="button"
            className={cx(css.tool, css.toolLabeled, interact && css.toolActive)}
            title={interact ? t('panel.toolbar.watch') : t('panel.toolbar.interact')}
            aria-label={interact ? t('panel.toolbar.watch') : t('panel.toolbar.interact')}
            aria-pressed={interact}
            disabled={activeTab === null}
            onClick={() => { setInteract((value) => !value) }}
          >
            {interact ? <CursorIcon /> : <EyeIcon />}
            <span className={css.toolLabel}>{interact ? t('panel.toolbar.interactShort') : t('panel.toolbar.watchShort')}</span>
          </button>
        )}
        <button
          type="button"
          className={cx(css.tool, css.toolLabeled, picking && css.toolActive)}
          title={t('panel.toolbar.pick')}
          aria-label={t('panel.toolbar.pick')}
          aria-pressed={picking}
          disabled={nativeActive ? false : activeTab === null}
          onClick={togglePicking}
        >
          <PickIcon />
          <span className={css.toolLabel}>{t('panel.toolbar.pickShort')}</span>
        </button>
        <span
          className={css.status}
          data-dsh-part={BROWSER_VIEW_PARTS.status}
          aria-live="polite"
          title={nativeActive ? displayUrl : state.cdpEndpoint ?? modeLabel}
        >
          <StateDot state={dotState} size={10} />
          <span className={css.statusText}>{statusLabel}</span>
          {modeLabel.length > 0 && <span className={css.mode}>{modeLabel}</span>}
          {!nativeActive && visibleFrame !== null && (
            <span className={css.frameSize} title={t('panel.toolbar.frameHint')}>
              {visibleFrame.width}×{visibleFrame.height} · PNG
            </span>
          )}
          {!nativeActive && state.mode === 'cdp' && state.cdpEndpoint !== undefined && (
            <span className={css.endpoint}>{state.cdpEndpoint}</span>
          )}
        </span>
        <button
          type="button"
          className={css.tool}
          title={t('panel.toolbar.refresh')}
          aria-label={t('panel.toolbar.refresh')}
          disabled={!nativeActive && activeTab === null}
          onClick={() => {
            if (nativeActive) nativeRef.current?.reload()
            else socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'request-frame' })
          }}
        >
          <IconRefreshOutlineRegular />
        </button>
      </div>
      {(picking || picks.length > 0 || pickError !== null || pickNotice !== null) && (
        <div className={css.pickBar} data-dsh-part={BROWSER_VIEW_PARTS.pickBar}>
          <span className={css.pickHint}>{picking ? t('panel.pick.hint') : pickCount}</span>
          <span className={css.pickActions}>
            {picks.length > 0 && (
              <button type="button" className={css.pickButton} onClick={sendPicks}>
                {t('panel.pick.send')}
              </button>
            )}
            {picks.length > 0 && (
              <button type="button" className={css.pickButton} onClick={clearPicks}>
                {t('panel.pick.clear')}
              </button>
            )}
            {picks.length > 0 && nativeActive && (
              <button type="button" className={css.pickButton} onClick={() => { void openStyle() }}>
                {t('panel.style.open')}
              </button>
            )}
          </span>
          {pickError !== null && <span className={css.pickError} role="alert">{pickError}</span>}
          {pickNotice !== null && <span className={css.pickNotice} role="status">{pickNotice}</span>}
        </div>
      )}
      {picks.length > 0 && (
        <div className={css.pickList}>
          {picks.map((pick, index) => (
            <div className={css.pickRow} key={`${pick.fingerprint}-${index}`}>
              <span className={css.pickNumber}>{index + 1}</span>
              <span className={css.pickLabel} title={pick.selector}>
                {pick.tag}
                {pick.id === undefined ? '' : `#${pick.id}`}
              </span>
              <input
                className={css.pickNote}
                type="text"
                value={pick.note ?? ''}
                placeholder={t('panel.pick.note')}
                aria-label={`${t('panel.pick.note')} ${index + 1}`}
                onChange={(event) => { updatePickNote(index, event.currentTarget.value) }}
              />
            </div>
          ))}
        </div>
      )}
      {styleOpen && nativeActive && lastPick !== undefined && (
        <div className={css.stylePanel} data-dsh-part="style">
          <div className={css.stylePanelHeader}>
            <span className={css.styleTitle}>{t('panel.style.title')}</span>
            <code className={css.styleSelector} title={lastPick.selector}>{lastPick.selector}</code>
            <button type="button" className={css.pickButton} onClick={() => { setStyleOpen(false) }}>
              {t('panel.style.close')}
            </button>
          </div>
          <div className={css.styleGrid}>
            {STYLE_FIELDS.map((field) => (
              <label key={field.key} className={css.styleField}>
                <span>{t(field.label)}</span>
                <input
                  value={styleValues[field.key] ?? ''}
                  spellCheck={false}
                  onChange={(event) => { setStyle(field.key, event.currentTarget.value) }}
                />
              </label>
            ))}
          </div>
          <div className={css.styleFooter}>
            <button type="button" className={css.pickButton} onClick={sendStyle}>
              {t('panel.style.send')}
            </button>
            <button type="button" className={css.pickButton} onClick={() => { for (const field of STYLE_FIELDS) resetStyle(field.key) }}>
              {t('panel.style.reset')}
            </button>
            <span className={css.styleNote}>{t('panel.style.note')}</span>
          </div>
          {styleError !== null && <div className={css.styleError} role="alert">{styleError}</div>}
        </div>
      )}
      {state.tabs.length > 1 && !nativeActive && (
        <div className={css.tabs} role="tablist" data-dsh-part={BROWSER_VIEW_PARTS.tabs}>
          {state.tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === state.activeTabId}
              className={cx(css.tab, tab.id === state.activeTabId && css.tabActive)}
              title={tab.url}
              onClick={() => {
                socketRef.current?.send({ v: BROWSER_VIEW_API_VERSION, kind: 'select-tab', tabId: tab.id })
              }}
            >
              {tab.title.length > 0 ? tab.title : t('panel.tab.untitled')}
            </button>
          ))}
        </div>
      )}
      <div className={css.content}>
        {nativeActive ? (
          <div className={css.nativeStack}>
            <NativeBrowser
              ref={nativeRef}
              sessionId={sessionId ?? 'anonymous'}
              url={url}
              picking={picking}
              onUrl={(next) => { setNativeUrl(next); setNativeAddress(next) }}
              onTitle={(next) => { setNativeTitle(next) }}
              onLoading={(next) => { setNativeLoading(next) }}
              onPick={(element) => {
                setPicks((current) => [...current, element])
                setStyleOpen(false)
                setPickError(null)
                setPickNotice(null)
              }}
              onError={(message) => { setNativeError(message) }}
            />
            {nativeError !== null && (
              <div className={css.nativeError} role="alert">
                <span>{nativeError}</span>
                <button
                  type="button"
                  className={css.pickButton}
                  onClick={() => { setNativeMode(false); setNativeError(null) }}
                >
                  {t('panel.native.cdp')}
                </button>
              </div>
            )}
          </div>
        ) : effectiveError !== null ? (
          <div className={css.error} data-dsh-part={BROWSER_VIEW_PARTS.error} role="alert">
            <span className={css.errorTitle}>{t('panel.error.title')}</span>
            <span className={css.errorBody}>{effectiveError.message}</span>
            {effectiveError.code.length > 0 && <span className={css.errorCode}>{effectiveError.code}</span>}
          </div>
        ) : dataUrl === null || visibleFrame === null ? (
          <div className={css.empty} data-dsh-part={BROWSER_VIEW_PARTS.empty}>
            <span className={css.emptyTitle}>{t('panel.empty.title')}</span>
            <span className={css.emptyHint}>{t('panel.empty.hint')}</span>
          </div>
        ) : (
          <div
            ref={frameHostRef}
            className={cx(css.frameHost, picking && css.picking)}
            data-dsh-part={BROWSER_VIEW_PARTS.frame}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onContextMenu={(event) => { event.preventDefault() }}
          >
            <img
              ref={imageRef}
              className={css.frame}
              src={dataUrl}
              alt={t('panel.frame.alt')}
              width={visibleFrame.width}
              height={visibleFrame.height}
              draggable={false}
            />
            {picking && !pagePickerActive && hoverPick !== null && hoverStyle !== undefined && (
              <div className={css.hoverBox} style={hoverStyle} aria-hidden="true">
                <span className={css.hoverLabel}>{pickLabel(hoverPick)}</span>
              </div>
            )}
            {picks.map((pick, index) => {
              const style = boxStyle(pick)
              if (style === undefined) return null
              return (
                <div key={`${pick.fingerprint}-${index}`} className={css.pickBox} style={style} aria-hidden="true">
                  <span className={css.pickBadge}>{index + 1}</span>
                </div>
              )
            })}
            <textarea
              ref={imeRef}
              className={css.ime}
              aria-hidden="true"
              tabIndex={-1}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              onCompositionEnd={onCompositionEnd}
            />
          </div>
        )}
      </div>
      <footer className={css.trace} data-dsh-part={BROWSER_VIEW_PARTS.trace}>
        <div className={css.traceList}>
          {traces.length === 0
            ? <span className={css.traceIdle}>{t('panel.trace.idle')}</span>
            : traces.map((trace, index) => (
              <div key={`${trace.at}-${index}`} className={css.traceRow}>
                <span className={css.traceTool}>{trace.tool}</span>
                <span className={css.traceSummary}>{trace.summary}</span>
              </div>
            ))}
        </div>
      </footer>
    </div>
  )
}

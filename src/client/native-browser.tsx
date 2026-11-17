// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Native desktop browser view for the right sidebar.
 *
 * DSH Desktop exposes a renderer-side bridge (`globalThis.dshDesktop.browser`)
 * and enables Electron's `<webview>` tag; the shipped sidebar browser uses the
 * same pair. We reuse that contract instead of a CDP screencast: the guest is a
 * real Chromium renderer embedded in the panel, so text is native, scrolling is
 * native, and input needs no coordinate forwarding.
 *
 * The bridge only reserves a partition/lease; the tag itself is the browser.
 * The webview API is used for navigation and for executing the existing page
 * picker. On the web (no Desktop bridge) this component is not mounted and the
 * panel keeps the CDP frame.
 *
 * The lifecycle/lease/partition shape is adapted from the MIT-licensed
 * @deepseek-ai/dsh-client-ui-sidebar-browser 0.2.2-rc.3; see NOTICE.
 *
 * @module dsh-webdev-viewer/client/native-browser
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import type { BrowserPickedElement } from '../core/protocol.ts'
import { PAGE_PICKER_CONSOLE_PREFIX, PAGE_PICKER_SCRIPT } from '../core/page-picker.ts'
import css from './native-browser.module.css'

/** Main-issued identity of one guest reservation. */
type DesktopBrowserLeaseId = string

/** The narrow main-process contract the desktop preload exposes. */
interface DesktopBrowserBridge {
  acquire(workspace: string): Promise<{ lease: DesktopBrowserLeaseId; partition: string }>
  release(lease: DesktopBrowserLeaseId): Promise<void>
  onOpenRequested(lease: DesktopBrowserLeaseId, listener: (url: string) => void): () => void
}

/** Electron's webview tag as this component uses it. */
interface WebviewElement extends HTMLElement {
  loadURL(url: string): Promise<void>
  getURL(): string
  getTitle(): string
  reload(): void
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
  isLoading(): boolean
  executeJavaScript(code: string): Promise<unknown>
}

interface ConsoleMessageEvent extends Event {
  readonly message: string
  readonly level: number
}

interface NavigationEvent extends Event {
  readonly isMainFrame?: boolean
}

interface LoadFailureEvent extends NavigationEvent {
  readonly errorCode: number
  readonly errorDescription: string
}

/** Imperative navigation surface the panel toolbar uses. */
export interface NativeBrowserHandle {
  loadUrl(url: string): void
  reload(): void
  goBack(): void
  goForward(): void
}

/** Callbacks the native view reports back to the panel. */
export interface NativeBrowserProps {
  sessionId: string
  /** URL requested by the host; changing it navigates the native guest. */
  url: string
  /** Whether the page-side picker should capture clicks. */
  picking: boolean
  onUrl?(url: string): void
  onTitle?(title: string): void
  onLoading?(loading: boolean): void
  onPick?(element: BrowserPickedElement): void
  onConsole?(entry: { level: number; message: string }): void
  onError?(message: string): void
}

/** Read the desktop bridge, if this renderer is the installed Desktop shell. */
export function nativeBrowserAvailable(): boolean {
  const carrier = (globalThis as typeof globalThis & {
    dshDesktop?: { readonly protocolVersion?: number; readonly browser?: DesktopBrowserBridge }
  }).dshDesktop
  return carrier?.protocolVersion === 1 && carrier.browser !== undefined
    && typeof carrier.browser.acquire === 'function'
}

/** Short stable identity for a picked native element. */
function fingerprintOf(selector: string, text: string): string {
  const value = `${selector}|${text}`
  let hash = 5381
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Map the page picker payload onto the shared wire element. */
function pickedElement(payload: unknown): BrowserPickedElement | null {
  if (typeof payload !== 'object' || payload === null) return null
  const data = payload as Record<string, unknown>
  if (typeof data.selector !== 'string' || data.selector.length === 0) return null
  const text = typeof data.text === 'string' ? data.text : undefined
  const tag = typeof data.tag === 'string' && data.tag.length > 0 ? data.tag : 'element'
  const id = typeof data.id === 'string' && data.id.length > 0 ? data.id : undefined
  const role = typeof data.role === 'string' && data.role.length > 0 ? data.role : undefined
  const classes = Array.isArray(data.classes)
    ? data.classes.filter((value): value is string => typeof value === 'string').slice(0, 8)
    : undefined
  let box: BrowserPickedElement['box']
  if (typeof data.rect === 'object' && data.rect !== null) {
    const rect = data.rect as Record<string, unknown>
    if (typeof rect.x === 'number' && typeof rect.y === 'number'
      && typeof rect.w === 'number' && typeof rect.h === 'number') {
      box = { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
    }
  }
  return {
    pageVersion: 0,
    selector: data.selector,
    fingerprint: fingerprintOf(data.selector, text ?? ''),
    tag,
    ...id === undefined ? {} : { id },
    ...classes === undefined || classes.length === 0 ? {} : { classes },
    ...role === undefined ? {} : { role },
    ...text === undefined ? {} : { text },
    ...box === undefined ? {} : { box },
  }
}

/**
 * Mount a native Electron webview in the supplied container.
 */
export const NativeBrowser = forwardRef<NativeBrowserHandle, NativeBrowserProps>(function NativeBrowser(props, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const webviewRef = useRef<WebviewElement | null>(null)
  const readyRef = useRef(false)
  const leaseRef = useRef<DesktopBrowserLeaseId | undefined>(undefined)
  const propsRef = useRef(props)
  propsRef.current = props

  const load = (url: string): void => {
    const element = webviewRef.current
    if (element === null || url.length === 0) return
    if (element.getURL() === url) return
    void element.loadURL(url).catch((error: unknown) => {
      propsRef.current.onError?.(error instanceof Error ? error.message : String(error))
    })
  }

  useImperativeHandle(ref, () => ({
    loadUrl(url: string): void { load(url) },
    reload(): void { webviewRef.current?.reload() },
    goBack(): void { try { webviewRef.current?.goBack() } catch { /* no history */ } },
    goForward(): void { try { webviewRef.current?.goForward() } catch { /* no history */ } },
  }), [])

  useEffect(() => {
    const host = hostRef.current
    const carrier = (globalThis as typeof globalThis & {
      dshDesktop?: { readonly protocolVersion?: number; readonly browser?: DesktopBrowserBridge }
    }).dshDesktop
    const bridge = carrier?.protocolVersion === 1 ? carrier.browser : undefined
    if (host === null || bridge === undefined || typeof bridge.acquire !== 'function') {
      propsRef.current.onError?.('The desktop browser bridge is unavailable')
      return
    }
    let disposed = false
    let element: WebviewElement | undefined
    let unsubscribeOpen: (() => void) | undefined
    const listeners = new AbortController()
    const workspace = `session:${propsRef.current.sessionId}`

    const initialize = async (): Promise<void> => {
      let reservation: { lease: DesktopBrowserLeaseId; partition: string }
      try {
        reservation = await bridge.acquire(workspace)
      } catch (error) {
        if (!disposed) propsRef.current.onError?.(error instanceof Error ? error.message : String(error))
        return
      }
      if (disposed) {
        await bridge.release(reservation.lease).catch(() => undefined)
        return
      }
      leaseRef.current = reservation.lease
      const tag = document.createElement('webview') as WebviewElement
      element = tag
      webviewRef.current = tag
      tag.className = css.webview
      tag.setAttribute('name', reservation.lease)
      tag.setAttribute('partition', reservation.partition)
      tag.setAttribute('allowpopups', '')
      tag.setAttribute('src', `about:blank#${reservation.lease}`)
      tag.setAttribute('aria-label', 'Native browser')

      const signal = listeners.signal
      tag.addEventListener('dom-ready', () => {
        readyRef.current = true
        propsRef.current.onLoading?.(false)
        // A native guest starts on about:blank; the real request waits for its
        // first document so loadURL cannot race guest creation.
        load(propsRef.current.url)
        if (propsRef.current.picking) void enablePicker(tag, true)
      }, { signal })
      tag.addEventListener('did-navigate', () => {
        propsRef.current.onUrl?.(tag.getURL())
        propsRef.current.onTitle?.(tag.getTitle())
      }, { signal })
      tag.addEventListener('did-navigate-in-page', (event) => {
        if ((event as NavigationEvent).isMainFrame !== false) {
          propsRef.current.onUrl?.(tag.getURL())
        }
      }, { signal })
      tag.addEventListener('page-title-updated', () => {
        propsRef.current.onTitle?.(tag.getTitle())
      }, { signal })
      tag.addEventListener('did-start-loading', () => { propsRef.current.onLoading?.(true) }, { signal })
      tag.addEventListener('did-stop-loading', () => { propsRef.current.onLoading?.(false) }, { signal })
      tag.addEventListener('did-fail-load', (event) => {
        const failure = event as LoadFailureEvent
        if (failure.isMainFrame === false || failure.errorCode === -3) return
        propsRef.current.onError?.(`${failure.errorDescription} (${failure.errorCode})`)
      }, { signal })
      tag.addEventListener('console-message', (event) => {
        const message = (event as ConsoleMessageEvent).message
        if (message.startsWith(PAGE_PICKER_CONSOLE_PREFIX)) {
          const parsed = (() => {
            try { return JSON.parse(message.slice(PAGE_PICKER_CONSOLE_PREFIX.length)) as unknown } catch { return null }
          })()
          const picked = pickedElement(parsed)
          if (picked !== null) propsRef.current.onPick?.(picked)
          return
        }
        propsRef.current.onConsole?.({ level: (event as ConsoleMessageEvent).level, message })
      }, { signal })

      host.append(tag)
      unsubscribeOpen = bridge.onOpenRequested(reservation.lease, (url) => { load(url) })
      signal.addEventListener('abort', () => { unsubscribeOpen?.() }, { once: true })
    }

    void initialize()
    return () => {
      disposed = true
      listeners.abort()
      unsubscribeOpen?.()
      readyRef.current = false
      webviewRef.current = null
      element?.remove()
      const lease = leaseRef.current
      leaseRef.current = undefined
      if (lease !== undefined) void bridge.release(lease).catch(() => undefined)
    }
    // The guest is per session; URL changes are handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.sessionId])

  useEffect(() => {
    if (readyRef.current) load(props.url)
  }, [props.url])

  useEffect(() => {
    const element = webviewRef.current
    if (!readyRef.current || element === null) return
    void enablePicker(element, props.picking)
  }, [props.picking])

  return <div ref={hostRef} className={css.host} data-dsh-part="native-browser" />
})

/** Install the shared picker and apply the current enable state. */
async function enablePicker(element: WebviewElement, enabled: boolean): Promise<void> {
  try {
    await element.executeJavaScript(PAGE_PICKER_SCRIPT)
    await element.executeJavaScript(`window.__dshWebdevPicker && window.__dshWebdevPicker.setEnabled(${enabled ? 'true' : 'false'})`)
  } catch {
    // A page mid-navigation rejects execution; the next dom-ready reinstalls it.
  }
}

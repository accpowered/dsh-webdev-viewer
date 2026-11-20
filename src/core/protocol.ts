// Modified for dsh-webdev-viewer from @linxin666/dsh-client-ui-browser-view 0.4.19 (Apache-2.0). See NOTICE.
/**
 * The webdev wire contract, shared by both halves.
 *
 * One source of truth for the host <-> browser messages and for the shapes the
 * agent tools return. Both halves compile this file (src/core is compiled into
 * the host program and the browser bundle), so a change here is a change to
 * both sides at once and needs no second definition.
 *
 * Transport: one WebSocket per mounted panel, created by the host half through
 * `ctx.webServer.registerUpgrade`. The host pushes events; the panel sends
 * commands. The browser itself is driven over CDP by the host half, so the
 * panel never speaks the devtools protocol.
 *
 * @module dsh-webdev-viewer/core/protocol
 */

/** Version of the wire contract; a mismatch rejects the socket instead of guessing. */
export const BROWSER_VIEW_API_VERSION = 1

/** Mount path of the panel socket, relative to the GUI origin. */
export const BROWSER_VIEW_SOCKET_PATH = '/api/dsh-webdev-viewer/socket'

/** JPEG quality the host asks CDP for; the panel only displays frames. */
export const DEFAULT_JPEG_QUALITY = 82

/** Viewport the host pins on every tab it creates, in CSS pixels. */
export const DEFAULT_VIEWPORT = { width: 1280, height: 800 } as const

/** How long a tab may live without any session binding before it is reaped. */
export const IDLE_TAB_TTL_MS = 10 * 60_000

/** Deepest DOM snapshot walk the host will perform, in nodes. */
export const SNAPSHOT_NODE_LIMIT = 4000

/** Ring size for captured console and network entries per tab. */
export const EVENT_RING_SIZE = 500

/**
 * Why a browser source could not be reached.
 *
 * The labels are contract, not prose: the panel picks a localized sentence, an
 * agent branches without parsing an error string, and both name the same four
 * failures that actually happen:
 *
 * - `econnrefused` — nothing listens on the endpoint (the browser was never
 *   started, or it was closed).
 * - `not_cdp` — something answers on that port, but it is not a DevTools
 *   endpoint (a web server, an unrelated app, a rejected handshake).
 * - `spawn_denied` — the browser process itself was refused by the OS
 *   (crashpad, an ACL, a sandbox), so a launch leaves no endpoint behind.
 * - `not_installed` — no Chrome/Edge binary is discoverable at all.
 * - `timeout` — the endpoint accepted a connection but never completed it.
 * - `unknown` — anything the host could not classify honestly.
 */
export type BrowserFailureReason =
  | 'econnrefused'
  | 'not_cdp'
  | 'spawn_denied'
  | 'not_installed'
  | 'timeout'
  | 'unknown'

/**
 * Stable code for "the configured real browser cannot be reached".
 *
 * Tool failures for this case embed the code and its fields as JSON in the
 * error text, so a call that ends this way is actionable without a second call.
 */
export const REAL_BROWSER_UNAVAILABLE_CODE = 'webdev.real_browser_unavailable'

/** Stable code for "the real browser went away mid-session". */
export const REAL_BROWSER_DISCONNECTED_CODE = 'webdev.real_browser_disconnected'

/** Stable code for "the isolated Chromium could not be started". */
export const ISOLATED_BROWSER_UNAVAILABLE_CODE = 'webdev.isolated_browser_unavailable'

/** Stable code for a desktop tool call while no panel owns the desktop guest. */
export const PANEL_NOT_MOUNTED_CODE = 'webdev.panel_not_mounted'

/** One classified failure of a browser source, as the panel and the route report it. */
export interface BrowserFailure {
  /** Stable machine code, for example {@link REAL_BROWSER_UNAVAILABLE_CODE}. */
  code: string
  /** Short human sentence suitable for the panel and the status route. */
  message: string
  /** Millisecond timestamp the failure was recorded. */
  at: number
  /** Classified cause; absent when the host could not tell. */
  reason?: BrowserFailureReason
  /** Loopback CDP endpoint the failure concerns, when one is configured. */
  endpoint?: string
  /** One line about what the user or the agent can do next. */
  remediation?: string
  /**
   * The underlying failure's own words (a socket error, a browser's stderr),
   * kept for diagnosis. This is untrusted data; render it as text, never HTML.
   */
  detail?: string
  /** Browser source the failure belongs to. */
  mode?: 'isolated' | 'cdp'
}

/** One open tab as the panel and the tools see it. */
export interface BrowserTabView {
  /** Stable CDP target id, the handle tools accept. */
  id: string
  /** Current top-level URL. */
  url: string
  /** Current document title, empty when the page has none. */
  title: string
  /** Whether the tab is loading right now. */
  loading: boolean
  /** Session that last acted on the tab, when any. */
  sessionId?: string
  /** Whether DSH created this target or adopted an existing real-browser tab. */
  origin?: 'created' | 'adopted'
}

/** What the header of the panel shows. */
export interface BrowserPanelState {
  /** Tabs in creation order. */
  tabs: BrowserTabView[]
  /** Tab the panel is watching, null when none is open. */
  activeTabId: string | null
  /** Whether the host half currently has a live browser process or CDP attachment. */
  running: boolean
  /** Browser source selected for the current configuration; absent in older hosts. */
  mode?: 'isolated' | 'cdp'
  /** Normalized loopback CDP origin when real-browser mode is selected. */
  cdpEndpoint?: string
  /** Last error text the host wants the panel to show instead of a frame. */
  message?: string
  /** Classified last failure, so a tab with no picture is always explainable. */
  lastError?: BrowserFailure
  /** Consecutive failed starts since the last live session; absent at zero. */
  attempts?: number
  /**
   * Whether an isolated Chromium could be launched on this host, so the panel
   * only offers "Open in isolated Chromium" when that action can work.
   * Reported while real-browser mode is configured.
   */
  isolatedAvailable?: boolean
  /**
   * Whether a real-browser source is configured even though the viewer is
   * currently showing the isolated Chromium: the panel uses it to offer a
   * visible way back to the configured browser.
   */
  realBrowserConfigured?: boolean
  /**
   * Temporary runtime style overrides currently applied to the visible page.
   *
   * The status row says Live for the connection; this is the separate "the
   * document was changed in memory" fact. It clears on reload/navigation,
   * explicit reset, detach, or reconfigure.
   */
  preview?: BrowserPreviewState
  /**
   * The last automatic source change this host made, when the profile
   * pre-declared one.
   *
   * `fallbackOnUnavailable: "isolated"` lets an unattended profile keep working
   * when the configured real browser is not there. The switch is still a
   * visible one: this field names the carrier the viewer left and the classified
   * reason, and the panel shows it beside the mode label so "why am I in the
   * isolated browser" is never a mystery. Absent until such a switch happens.
   */
  autoFallback?: BrowserAutoFallback
}

/** How a host may react when the configured real browser cannot be reached. */
export type AutoFallbackMode =
  /** Report the failure and stay put; the caller switches explicitly. */
  | 'never'
  /** Pre-declare the explicit downgrade: switch and report it as `autoFallback`. */
  | 'isolated'

/** One recorded automatic downgrade of the browser source. */
export interface BrowserAutoFallback {
  /** Source the viewer left. */
  from: 'cdp'
  /** Classified reason the real browser was not reachable. */
  reason: BrowserFailureReason
  /** Millisecond timestamp of the switch. */
  at: number
  /** Endpoint that was tried, when one was configured. */
  endpoint?: string
}

/** One element carrying at least one temporary style override. */
export interface PreviewElement {
  /** CSS selector of the picked element. */
  selector: string
  /** Whether the override targeted the element itself or its parent. */
  relation: 'self' | 'parent'
}

/** Temporary-style state as the panel and the route report it. */
export interface BrowserPreviewState {
  /** Whether any override is still applied. */
  active: boolean
  /** Number of distinct elements carrying at least one override. */
  count: number
  /** Exactly those elements, for the hover highlight overlay. */
  elements: PreviewElement[]
}

/** Separator for the opaque panel key, chosen because CSS selectors cannot contain it. */
export const PREVIEW_KEY_SEPARATOR = '\u0000'

/**
 * Build one temporary-override key.
 * @param relation - self or parent of the picked element.
 * @param selector - CSS selector.
 * @param pseudo - `::before`/`::after`, or empty for the element itself.
 * @param property - CSS property.
 * @returns the opaque key the panel and host share.
 */
export function previewKey(relation: 'self' | 'parent', selector: string, pseudo: string, property: string): string {
  return [relation, selector, pseudo, property].join(PREVIEW_KEY_SEPARATOR)
}

/**
 * Read one temporary-override key back.
 * @param key - opaque key from the panel or the agent tool.
 * @returns the fields, or undefined when the key is malformed.
 */
export function parsePreviewKey(key: string): {
  relation: 'self' | 'parent'
  selector: string
  pseudo: string
  property: string
} | undefined {
  const parts = key.split(PREVIEW_KEY_SEPARATOR)
  if (parts.length !== 4) return undefined
  const [relation, selector, pseudo, property] = parts as [string, string, string, string]
  if (relation !== 'self' && relation !== 'parent') return undefined
  if (selector === '' || property === '') return undefined
  return { relation, selector, pseudo, property }
}

/** One line of the panel's "what is the agent doing" trace. */
export interface BrowserActionTrace {
  /** Tool name that produced the change, without its `webdev_` prefix. */
  tool: string
  /** One-line human description, already localized by the host. */
  summary: string
  /** Millisecond timestamp of the action. */
  at: number
  /**
   * Optional presentation tone. `preview` marks a temporary style adjustment
   * (agent tool or panel inspector) so the footer can draw it in the preview
   * blue instead of the ordinary action color.
   */
  tone?: 'preview'
}

/** Host pushes one of these to every attached panel. */
export type BrowserViewEvent =
  | { v: 1; kind: 'hello'; state: BrowserPanelState }
  | { v: 1; kind: 'state'; state: BrowserPanelState }
  | {
      v: 1
      kind: 'frame'
      /** Tab the frame belongs to. */
      tabId: string
      /** Monotonic frame counter, so a slow panel can drop intermediate frames. */
      seq: number
      /** Frame size in CSS pixels. */
      width: number
      /** Frame size in CSS pixels. */
      height: number
      /** Base64 JPEG, no data: prefix. */
      data: string
    }
  | { v: 1; kind: 'action'; trace: BrowserActionTrace }
  | { v: 1; kind: 'pick-mode'; enabled: boolean }
  | {
      v: 1
      kind: 'native-request'
      /** Correlates the answer with the host's request. */
      requestId: string
      /** Operation the native guest should run. */
      op: string
      /** Operation-specific arguments. */
      args?: unknown
    }
  | {
      v: 1
      kind: 'pick-result'
      /** Correlates the answer with the panel's pick request. */
      requestId: string
      /** Resolved element, or absent when resolution failed. */
      element?: BrowserPickedElement
      /** Human-readable failure when no element could be resolved. */
      error?: string
    }
  | { v: 1; kind: 'error'; code: string; message: string }

/** One human input event the panel forwards to the page. */
export type BrowserInputEvent =
  | {
      type: 'mouse'
      action: 'move' | 'down' | 'up'
      x: number
      y: number
      button?: 'left' | 'middle' | 'right' | 'none'
      buttons?: number
      clickCount?: number
      modifiers?: number
    }
  | {
      type: 'wheel'
      x: number
      y: number
      deltaX: number
      deltaY: number
      modifiers?: number
    }
  | {
      type: 'key'
      action: 'down' | 'up'
      key: string
      code?: string
      modifiers?: number
    }
  | {
      type: 'text'
      text: string
    }

/** Panel sends one of these to the host. */
export type BrowserViewCommand =
  | { v: 1; kind: 'attach'; sessionId?: string }
  | { v: 1; kind: 'select-tab'; tabId: string }
  | { v: 1; kind: 'request-frame' }
  | { v: 1; kind: 'close-tab'; tabId: string }
  | { v: 1; kind: 'input'; event: BrowserInputEvent }
  | { v: 1; kind: 'pick'; requestId: string; x: number; y: number }
  /**
   * Render one tab at the panel's content box.
   *
   * `deviceScaleFactor` is the panel's `window.devicePixelRatio`: the page keeps
   * its CSS layout size, while captures render at that many device pixels per
   * CSS pixel so a HiDPI screen gets sharp frames instead of an upscaled 1x
   * image. Omitted means 1.
   */
  | { v: 1; kind: 'viewport'; width: number; height: number; deviceScaleFactor?: number }
  | { v: 1; kind: 'pick-mode'; enabled: boolean }
  /**
   * Drop the current attachment and try the configured source once more.
   * The user's Retry: it never switches the browser source.
   */
  | { v: 1; kind: 'reconnect' }
  /**
   * Explicitly switch to the isolated Chromium the viewer launches itself.
   *
   * This is the sanctioned way to stay usable while `realBrowserEnabled` points
   * at an endpoint nobody started: a person clicked it, and the resulting mode
   * is visible in the status row. It is never selected silently. `url` is the
   * page the panel was showing (or the URL a person just typed), loaded once the
   * isolated browser is up so the same page keeps rendering without a second
   * browser window.
   */
  | { v: 1; kind: 'open-isolated'; url?: string }
  /** Forget the explicit source and return to the configured one. */
  | { v: 1; kind: 'use-configured' }
  /**
   * Replace the panel's contribution to the temporary-style set.
   *
   * Keys are opaque `${selector}|${pseudo}|${property}` strings chosen by the
   * panel; the host merges them with the agent tool's keys so the Preview chip
   * and the state route describe the whole document, not just one writer.
   */
  | { v: 1; kind: 'style-preview'; keys: string[] }
  /** Drop every temporary-style key: the page was reloaded or navigated. */
  | { v: 1; kind: 'preview-reset' }
  | { v: 1; kind: 'native-attach'; sessionId?: string }
  | { v: 1; kind: 'native-detach' }
  | { v: 1; kind: 'native-result'; requestId: string; result?: unknown; error?: string }

/** A console entry the host rang in while the tab was open. */
export interface BrowserConsoleEntry {
  /** Console level: log, info, warn, error, debug. */
  level: string
  /** Already-stringified arguments. */
  text: string
  /** Millisecond timestamp. */
  at: number
}

/** A network request the host observed, reduced to what verification needs. */
export interface BrowserNetworkEntry {
  /** Request URL. */
  url: string
  /** HTTP method. */
  method: string
  /** Response status, 0 while pending or on a transport failure. */
  status: number
  /** Response mime type when known. */
  mimeType?: string
  /** CDP failure text when the request failed. */
  failure?: string
  /** Millisecond timestamp of the request. */
  at: number
}

/** One node of the DOM snapshot the tools return. */
export interface BrowserSnapshotNode {
  /** Depth-first index, the handle `webdev_click` accepts as `ref`. */
  ref: number
  /** Lowercase tag name. */
  tag: string
  /** Element id, when set. */
  id?: string
  /** Element classes, when set. */
  classes?: string[]
  /** Accessible role when Chrome reports one. */
  role?: string
  /** Accessible name when Chrome reports one. */
  name?: string
  /** Visible text for leaf nodes, truncated by the host. */
  text?: string
  /** Bounding box in CSS pixels, window-relative. */
  box?: { x: number; y: number; width: number; height: number }
  /** Depth in the walked tree. */
  depth: number
}

/** What `webdev_snapshot` returns to the model. */
export interface BrowserSnapshot {
  /** Tab the snapshot came from. */
  tabId: string
  /** Top-level URL at snapshot time. */
  url: string
  /** Document title. */
  title: string
  /** Walked nodes, bounded by SNAPSHOT_NODE_LIMIT. */
  nodes: BrowserSnapshotNode[]
  /** True when the walk hit the node limit. */
  truncated: boolean
}

/** One element resolved from a panel pick gesture. */
export interface BrowserPickedElement {
  /** Document generation the pick was taken from. */
  pageVersion: number
  /** Unique CSS selector. */
  selector: string
  /** Identity used to rebind after a reload/DOM change. */
  fingerprint: string
  /** Lowercase tag name. */
  tag: string
  /** Element id, when set. */
  id?: string
  /** Element classes, when set. */
  classes?: string[]
  /** Accessible role, when known. */
  role?: string
  /** Accessible name, when known. */
  name?: string
  /** Bounded visible text. */
  text?: string
  /** Bounding box in CSS pixels, window-relative. */
  box?: { x: number; y: number; width: number; height: number }
  /** Best-effort source hint (data-* or framework dev metadata). */
  source?: { file?: string; line?: number; component?: string }
  /** Optional user annotation from the page-side picker. */
  note?: string
}

/** Whether a decoded JSON value is a command this version accepts. */
export function isBrowserViewCommand(value: unknown): value is BrowserViewCommand {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (candidate.v !== BROWSER_VIEW_API_VERSION) return false
  switch (candidate.kind) {
    case 'attach':
      return candidate.sessionId === undefined || typeof candidate.sessionId === 'string'
    case 'select-tab':
      return typeof candidate.tabId === 'string'
    case 'close-tab':
      return typeof candidate.tabId === 'string'
    case 'request-frame':
      return true
    case 'input':
      return isBrowserInputEvent(candidate.event)
    case 'pick':
      return typeof candidate.requestId === 'string'
        && typeof candidate.x === 'number' && Number.isFinite(candidate.x)
        && typeof candidate.y === 'number' && Number.isFinite(candidate.y)
    case 'viewport':
      return typeof candidate.width === 'number' && Number.isFinite(candidate.width) && candidate.width > 0
        && typeof candidate.height === 'number' && Number.isFinite(candidate.height) && candidate.height > 0
        && (candidate.deviceScaleFactor === undefined
          || (typeof candidate.deviceScaleFactor === 'number'
            && Number.isFinite(candidate.deviceScaleFactor)
            && candidate.deviceScaleFactor >= 1
            && candidate.deviceScaleFactor <= 3))
    case 'pick-mode':
      return typeof candidate.enabled === 'boolean'
    case 'reconnect':
      return true
    case 'open-isolated':
      return candidate.url === undefined || typeof candidate.url === 'string'
    case 'use-configured':
      return true
    case 'style-preview':
      return Array.isArray(candidate.keys) && candidate.keys.every(key => typeof key === 'string')
    case 'preview-reset':
      return true
    case 'native-attach':
      return candidate.sessionId === undefined || typeof candidate.sessionId === 'string'
    case 'native-detach':
      return true
    case 'native-result':
      return typeof candidate.requestId === 'string'
        && (candidate.error === undefined || typeof candidate.error === 'string')
    default:
      return false
  }
}

/**
 * Validate one panel input event.
 * @param value - candidate event.
 * @returns whether the host can dispatch it.
 */
export function isBrowserInputEvent(value: unknown): value is BrowserInputEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  switch (event.type) {
    case 'mouse':
      return (event.action === 'move' || event.action === 'down' || event.action === 'up')
        && typeof event.x === 'number' && Number.isFinite(event.x)
        && typeof event.y === 'number' && Number.isFinite(event.y)
        && (event.button === undefined || event.button === 'left' || event.button === 'middle' || event.button === 'right' || event.button === 'none')
        && (event.buttons === undefined || typeof event.buttons === 'number')
        && (event.clickCount === undefined || typeof event.clickCount === 'number')
        && (event.modifiers === undefined || typeof event.modifiers === 'number')
    case 'wheel':
      return typeof event.x === 'number' && Number.isFinite(event.x)
        && typeof event.y === 'number' && Number.isFinite(event.y)
        && typeof event.deltaX === 'number' && Number.isFinite(event.deltaX)
        && typeof event.deltaY === 'number' && Number.isFinite(event.deltaY)
        && (event.modifiers === undefined || typeof event.modifiers === 'number')
    case 'key':
      return (event.action === 'down' || event.action === 'up')
        && typeof event.key === 'string' && event.key.length > 0
        && (event.code === undefined || typeof event.code === 'string')
        && (event.modifiers === undefined || typeof event.modifiers === 'number')
    case 'text':
      return typeof event.text === 'string'
    default:
      return false
  }
}

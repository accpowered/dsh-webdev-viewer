// Modified for dsh-webdev-viewer from @linxin666/dsh-client-ui-browser-view 0.4.19 (Apache-2.0). See NOTICE.
/**
 * The host-side browser service: one lazy Chrome, one tab per agent session,
 * and the fan-out that keeps every attached panel in sync.
 *
 * Lifecycle. Chrome is not started when the plugin mounts — a plugin that
 * launches a browser the moment the GUI loads spends a process on a feature
 * nobody has opened. The first tool call or socket attach starts it, and a
 * failed start is remembered as a panel message instead of being retried in a
 * loop on every keystroke.
 *
 * Binding. `sessionId -> tabId` is the reason two agents never fight over one
 * page: a tool call from session A reuses A's tab, creates one on first use, and
 * leaves B's tab alone. Tab ids stay explicit arguments too, so a caller can
 * address any open tab on purpose.
 *
 * Broadcast. Paths, once a socket is attached, are push-only: frames, state
 * changes, and action traces go to every attached panel. The service never
 * lets one dead socket break the fan-out — a throwing send drops that sink.
 *
 * @module dsh-webdev-viewer/host/service
 */

import { CdpClient } from '../core/cdp.ts'
import type { CdpConnectOptions, CdpTransport } from '../core/cdp.ts'
import { ChromeProcess, resolveChromePath } from '../core/chrome.ts'
import { TabManager, type ScreencastFrame } from '../core/tabs.ts'
import { buildSnapshot, type SnapshotResult } from '../core/snapshot.ts'
import { planScreenshot, type PageOffset, type ScreenshotPlan, type ScreenshotRequest } from '../core/screenshot.ts'
import { imageSizeOf, type ImageSize } from '../core/image-size.ts'
import type { EvalOutcome, EvalRequest } from '../core/eval.ts'
import type { MeasureReport } from '../core/measure.ts'
import { dispatchInput } from '../core/input.ts'
import { pickElement } from '../core/pick.ts'
import { DOCUMENT_TEXT_EXPRESSION, isAuthChallengeText, isLoopbackTarget } from './auth.ts'
import {
  classifyBrowserFailure,
  fetchCdpVersion,
  parseCdpEndpoint,
  probeCdpEndpoint,
  realBrowserUnavailable,
  remediationFor,
} from './cdp-endpoint.ts'
import type { CdpEndpoint } from './cdp-endpoint.ts'
import {
  clickElement,
  navigateTo,
  pressKey,
  scrollBy,
  typeText,
  type ActionOutcome,
  type ElementTarget,
} from '../core/actions.ts'
import {
  DEFAULT_JPEG_QUALITY,
  DEFAULT_VIEWPORT,
  ISOLATED_BROWSER_UNAVAILABLE_CODE,
  PANEL_NOT_MOUNTED_CODE,
  REAL_BROWSER_DISCONNECTED_CODE,
  SNAPSHOT_NODE_LIMIT,
  parsePreviewKey,
  previewKey,
  type AutoFallbackMode,
  type BrowserActionTrace,
  type BrowserAutoFallback,
  type BrowserConsoleEntry,
  type BrowserFailure,
  type BrowserFailureReason,
  type BrowserNetworkEntry,
  type BrowserPanelState,
  type BrowserPickedElement,
  type BrowserPreviewState,
  type BrowserSnapshot,
  type BrowserTabView,
  type BrowserViewCommand,
  type BrowserViewEvent,
  type PreviewElement,
} from '../core/protocol.ts'

/** Stable short fingerprint for a page-side pick. */
function fingerprintOf(selector: string, text: string): string {
  const value = `${selector}|${text}`
  let hash = 5381
  for (let index = 0; index < value.length; index++) hash = ((hash << 5) + hash) ^ value.charCodeAt(index)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** One attached panel socket as the service sees it. */
export interface BrowserViewSink {
  /** Deliver one event; a throw means the sink is gone. */
  send(event: BrowserViewEvent): void
  /** Close the underlying transport. */
  close(): void
}

/** What the route layer needs from the service; tests stub this instead. */
export interface BrowserViewBackend {
  /** The state the status route reports; safe to call before a browser exists. */
  state(): BrowserPanelState
  /**
   * Register one panel socket.
   * @param sink - the socket adapter.
   * @returns the detach function, called when the socket closes.
   */
  attach(sink: BrowserViewSink): () => void
  /**
   * Run one validated panel command.
   * @param sink - the socket that sent it.
   * @param command - an already validated command.
   */
  handleCommand(sink: BrowserViewSink, command: BrowserViewCommand): Promise<void>
}

export type BrowserMode = 'isolated' | 'cdp'

/** Current browser source, resolved live when a session starts. */
export interface BrowserConnectionConfig {
  mode: BrowserMode
  cdpEndpoint?: string
}

/** Options shared by the isolated and external session factories. */
export interface OpenSessionOptions extends BrowserConnectionConfig {
  jpegQuality: number
  viewport: { width: number; height: number }
  onFrame: (frame: ScreencastFrame) => void
  onTabsChanged: () => void
  onPagePick?: (tabId: string, payload: string) => void
}

/** One running browser plus the tab manager over it. */
export interface BrowserSession {
  /** Explicit ownership/lifecycle mode; never inferred from process fields. */
  mode: BrowserMode
  /** Protocol transport the tabs and the actions share. */
  transport: CdpTransport
  /** Tabs of this browser. */
  tabs: TabManager
  /** The Chrome process; absent when a test supplied its own session. */
  chrome?: ChromeProcess
  /** Stop everything this session owns. */
  dispose(): Promise<void>
}

/** Construction options. */
export interface BrowserViewServiceOptions {
  /** JPEG quality for frames and screenshots. @default DEFAULT_JPEG_QUALITY */
  jpegQuality?: number
  /** Viewport pinned on every tab. @default DEFAULT_VIEWPORT */
  viewport?: { width: number; height: number }
  /** Clock for action traces. @default Date.now */
  now?: () => number
  /**
   * Mints the process launch-token URL for one clean URL, or returns
   * undefined when the host mounts no such seam. Resolved per navigation by
   * the loader from `ctx.get('connection')`; absent here means no auth top-up.
   */
  authenticatedUrl?: (url: string) => string | undefined
  /** Live browser source; called for state and every new connection. */
  resolveConfig?: () => BrowserConnectionConfig
  /**
   * Idle window in days for the tab sweep, read per sweep so a settings edit
   * applies on the next one. Zero or less disables the sweep. @default () => 0
   */
  idleCloseDays?: () => number
  /** How often the idle sweep runs; zero disables it. @default IDLE_SWEEP_INTERVAL_MS */
  sweepIntervalMs?: number
  /**
   * How often an attached panel checks that its real browser still answers;
   * zero disables the watch. The production loader enables it: a browser closed
   * mid-session must become a visible disconnect. @default 0
   */
  livenessIntervalMs?: number
  /**
   * One discovery probe for the liveness watch. Injected by tests so the watch
   * is exercised without a browser. @default a bounded `/json/version` GET
   */
  livenessProbe?: (endpoint: CdpEndpoint) => Promise<boolean>
  /**
   * Whether an isolated Chromium could be launched on this host, reported to
   * the panel so it only offers that action when it can work.
   * @default a one-time probe of the installed browser binaries
   */
  chromeAvailable?: () => boolean
  /**
   * What to do when the configured real browser cannot be reached: `never`
   * reports the classified failure, `isolated` pre-declares the explicit
   * downgrade so an unattended session keeps working.
   *
   * `isolated` still produces a *visible* switch: the state carries
   * `autoFallback { from, reason, at, endpoint }`, the panel names it next to the
   * mode label, and the one-click way back to the configured browser stays.
   * Only the reasons that mean "nobody is listening" qualify
   * ({@link AUTO_FALLBACK_REASONS}).
   * @default () => 'never'
   */
  fallbackOnUnavailable?: () => AutoFallbackMode
  /** Browser factory, replaced by tests. */
  openSession?: (options: OpenSessionOptions) => Promise<BrowserSession>
}

/**
 * Classified reasons that may trigger the pre-declared downgrade.
 *
 * These three mean the configured browser is not there to talk to. A failure the
 * host could not classify is not one of them: guessing would turn an unknown
 * bug into a silent source change.
 */
export const AUTO_FALLBACK_REASONS: ReadonlySet<BrowserFailureReason> = new Set<BrowserFailureReason>([
  'econnrefused',
  'not_cdp',
  'timeout',
])

/** Start the default isolated Chrome and wrap it in a session. */
async function openIsolatedSession(options: OpenSessionOptions): Promise<BrowserSession> {
  let chrome: ChromeProcess
  try {
    chrome = await ChromeProcess.launch({ viewport: options.viewport })
  } catch (error) {
    // A refused launch (crashpad/ACL, a locked profile, no binary) is the one
    // place the browser's own explanation exists, so it is classified here and
    // carried into both the tool error and the panel's lastError.
    throw new IsolatedBrowserUnavailableError(classifyBrowserFailure(error), error)
  }
  let cdp: CdpClient
  let unbindExit: (() => void) | undefined
  try {
    cdp = await CdpClient.connect(chrome.info.webSocketDebuggerUrl)
    unbindExit = chrome.onExit(() => { cdp.close() })
  } catch (error) {
    unbindExit?.()
    await chrome.dispose()
    throw error
  }
  const tabs = new TabManager({
    transport: cdp,
    jpegQuality: options.jpegQuality,
    viewport: options.viewport,
    onFrame: options.onFrame,
    onTabsChanged: options.onTabsChanged,
    onPagePick: options.onPagePick,
  })
  return {
    mode: 'isolated',
    transport: cdp,
    tabs,
    chrome,
    async dispose() {
      unbindExit?.()
      await tabs.dispose()
      cdp.close()
      await chrome.dispose()
    },
  }
}

/**
 * Handshake deadline for an external browser. Its debugger port is already
 * listening, so an endpoint that does not complete the upgrade within this
 * window is wedged; the per-command budget is a separate setting and is left at
 * `CDP_COMMAND_TIMEOUT_MS`, exactly as in the isolated mode.
 */
export const REAL_BROWSER_HANDSHAKE_TIMEOUT_MS = 5_000

/**
 * How often an attached panel checks that its real browser is still there.
 *
 * The panel is the product: a browser closed behind it must turn into a
 * visible disconnect with a Reconnect control, not a frozen frame. One second
 * is short enough to notice within the two seconds the contract promises and
 * cheap enough that the `/json/version` GET is noise.
 */
export const LIVENESS_INTERVAL_MS = 1_000

/** Deadline for one liveness discovery probe. */
export const LIVENESS_PROBE_TIMEOUT_MS = 750

/**
 * Pause before a failed liveness probe is believed.
 *
 * A browser under load can miss one 750 ms discovery GET without being gone;
 * one short recheck keeps a busy page from being torn down, and the pair still
 * settles well inside the two-second detection budget.
 */
export const LIVENESS_RECHECK_DELAY_MS = 250

/** One day in milliseconds: the unit the idle-close window is configured in. */
const DAY_MS = 24 * 60 * 60 * 1000

/** Sleep for `ms`; used by the liveness recheck and kept unref'd by its timer. */
function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => {
    const timer = setTimeout(resolve, ms)
    const unref = (timer as unknown as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(timer)
  })
}

/**
 * Sentence a desktop tool call gets when no panel owns the desktop guest.
 *
 * The code prefix is what an agent branches on; the sentence says what to do.
 * It is thrown immediately — the old path sent the request to a socket that was
 * already gone and waited thirty seconds for an answer (#B1-a).
 */
const PANEL_NOT_MOUNTED_MESSAGE =
  `${PANEL_NOT_MOUNTED_CODE}: no mounted WebDev Viewer panel owns the desktop view. `
  + 'Open the WebDev Viewer tab in the right sidebar (or switch it back to the desktop browser) and retry.'

/**
 * The classified-failure shape a thrown error may carry.
 *
 * A failed source is reported twice: as the thrown tool error (prose plus a
 * JSON line the model can branch on) and as `state.lastError` (short sentence,
 * reason, remediation, detail) for the panel and the route. Both carriers share
 * these fields, so the service does not need to know which class produced them.
 */
interface ClassifiedSourceFailure extends Error {
  readonly code: string
  readonly reason: BrowserFailureReason
  readonly remediation: string
  readonly panelMessage: string
  readonly endpoint?: string
}

/**
 * Narrow an error to the classified shape.
 * @param error - whatever a session factory threw.
 * @returns the fields, or undefined when the error was not classified.
 */
function asClassifiedFailure(error: unknown): ClassifiedSourceFailure | undefined {
  if (!(error instanceof Error)) return undefined
  const candidate = error as Partial<ClassifiedSourceFailure>
  if (typeof candidate.code !== 'string' || candidate.code === '') return undefined
  if (typeof candidate.reason !== 'string') return undefined
  if (typeof candidate.remediation !== 'string' || typeof candidate.panelMessage !== 'string') return undefined
  return candidate as ClassifiedSourceFailure
}

/**
 * A failed launch of the isolated browser the viewer owns.
 *
 * The message carries the browser's own explanation (crashpad, a locked
 * profile, a missing binary) and the machine-readable fields, so a tool call
 * can tell "not installed" from "the OS denied the process" without parsing
 * prose.
 */
class IsolatedBrowserUnavailableError extends Error {
  readonly code = ISOLATED_BROWSER_UNAVAILABLE_CODE
  readonly reason: BrowserFailureReason
  readonly remediation: string
  readonly panelMessage: string

  /**
   * @param reason - classified launch cause.
   * @param cause - what `ChromeProcess.launch` threw.
   */
  constructor(reason: BrowserFailureReason, cause: unknown) {
    const remediation = remediationFor(reason)
    const raw = cause instanceof Error ? cause.message : String(cause)
    super(
      `${ISOLATED_BROWSER_UNAVAILABLE_CODE}: could not start the isolated browser (${reason}). `
        + `${raw} ${remediation} `
        + JSON.stringify({ code: ISOLATED_BROWSER_UNAVAILABLE_CODE, reason, remediation }),
      { cause },
    )
    this.name = 'IsolatedBrowserUnavailableError'
    this.reason = reason
    this.remediation = remediation
    this.panelMessage = `The isolated browser could not start (${reason}).`
  }
}

/**
 * How often the service looks for tabs that went idle.
 *
 * Ten minutes is a compromise between two costs that both land on the host:
 * a shorter period wakes the process for nothing on a window measured in days,
 * and a longer one leaves a page running well past its window.
 */
export const IDLE_SWEEP_INTERVAL_MS = 10 * 60 * 1000

/**
 * Seams the external session factory resolves when it connects. The defaults
 * are the production transport; a test injects one to observe what a
 * real-browser attach asks for without starting a browser.
 */
export interface ExternalSessionSeams {
  /** Open the DevTools transport. @default CdpClient.connect */
  connect?: (url: string, timeouts: CdpConnectOptions) => Promise<CdpTransport>
}

/** Connect to an existing real browser without owning its process or tabs. */
export async function openExternalSession(
  options: OpenSessionOptions,
  seams: ExternalSessionSeams = {},
): Promise<BrowserSession> {
  const endpoint = parseCdpEndpoint(options.cdpEndpoint ?? '')
  const connect = seams.connect ?? CdpClient.connect
  let cdp: CdpTransport | undefined
  let tabs: TabManager | undefined
  try {
    const version = await fetchCdpVersion(endpoint)
    cdp = await connect(version.webSocketDebuggerUrl, { handshakeTimeoutMs: REAL_BROWSER_HANDSHAKE_TIMEOUT_MS })
    tabs = new TabManager({
      transport: cdp,
      jpegQuality: options.jpegQuality,
      viewport: options.viewport,
      pinViewport: false,
      discoverTargets: true,
      onFrame: options.onFrame,
      onTabsChanged: options.onTabsChanged,
      onPagePick: options.onPagePick,
    })
    await tabs.discoverExistingTabs()
    const attachedTabs = tabs
    return {
      mode: 'cdp',
      transport: cdp,
      tabs: attachedTabs,
      async dispose() {
        await attachedTabs.dispose()
        cdp?.close()
      },
    }
  } catch (error) {
    if (tabs !== undefined) await tabs.dispose().catch(() => undefined)
    cdp?.close()
    throw realBrowserUnavailable(endpoint, error)
  }
}

/** Resolve a factory that honors the selected mode without fallback. */
function openConfiguredSession(options: OpenSessionOptions): Promise<BrowserSession> {
  return options.mode === 'cdp' ? openExternalSession(options) : openIsolatedSession(options)
}

/** Which element layer one native style operation targets. */
export interface NativeStyleTargetOptions {
  /** Follow the picked element's parent instead of itself. @default 'self' */
  relation?: 'self' | 'parent'
  /** Target a pseudo-element of the resolved element. */
  pseudo?: '::before' | '::after'
}

/**
 * The plugin's single browser service.
 */
export class BrowserViewService implements BrowserViewBackend {
  private readonly jpegQuality: number
  private readonly viewport: { width: number; height: number }
  private readonly now: () => number
  private readonly openSession: NonNullable<BrowserViewServiceOptions['openSession']>
  private readonly configuredConfig: () => BrowserConnectionConfig
  private readonly resolveConfig: () => BrowserConnectionConfig
  private readonly authenticatedUrl: BrowserViewServiceOptions['authenticatedUrl']
  private manualEndpoint: string | undefined
  /**
   * The isolated browser a person explicitly asked for while the configured
   * source is the real one. This is the recorded "Open in isolated Chromium"
   * choice: it makes the status row's mode honest instead of silently switching
   * carriers, and {@link useConfigured} is the way back.
   */
  private manualMode: 'isolated' | undefined
  private readonly idleCloseDays: () => number
  private readonly sweepIntervalMs: number
  private idleTimer: ReturnType<typeof setInterval> | undefined
  private readonly livenessIntervalMs: number
  private readonly livenessProbe: (endpoint: CdpEndpoint) => Promise<boolean>
  private readonly chromeAvailable: () => boolean
  /** Profile's pre-declared response when the real browser is not reachable. */
  private readonly fallbackOnUnavailable: () => AutoFallbackMode
  /**
   * The last automatic downgrade, kept until the carrier really changes again:
   * the panel and the route read it, so a viewer that is in the isolated
   * browser because its real one was missing always says so.
   */
  private lastFallback: BrowserAutoFallback | undefined
  private livenessTimer: ReturnType<typeof setInterval> | undefined
  /** One in-flight liveness check, so a slow probe never stacks up. */
  private probing = false
  private readonly sinks = new Set<BrowserViewSink>()
  private readonly bindings = new Map<string, string>()
  /**
   * Tabs whose one auth top-up for the current navigation is already spent.
   * This is what stops a retry that did not clear the challenge from
   * navigating again; it is reset when the navigation ends.
   */
  private readonly authTopUpSpent = new Set<string>()
  /** Panel socket currently owning the Desktop native guest. */
  private nativeSink: BrowserViewSink | undefined
  /** Session that attached the native guest, when known. */
  private nativeSessionId: string | undefined
  /** Temporary style keys written by the agent tool. */
  private readonly agentPreviewKeys = new Set<string>()
  /** Temporary style keys the panel's own style inspector reported. */
  private readonly panelPreviewKeys = new Set<string>()
  /** One in-flight Host -> native-guest request per panel. */
  private readonly nativePending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()
  /** Last native snapshot's ref -> selector map. */
  private readonly nativeRefs = new Map<number, string>()
  private session: BrowserSession | undefined
  /**
   * The tab the attached panels watch. Kept beside the tab manager instead of
   * read from it because "the page the panel shows" and "the page most recently
   * created" are different facts: a panel that follows the agent must NOT move
   * to a tab an explicit selection pinned it to, while the tab manager still
   * has to know about every tab that exists.
   */
  private displayedTabId: string | null = null
  /**
   * Whether a person chose the watched tab in the panel. Until that happens the
   * panels follow whatever the agent drives; afterwards they never steal it.
   */
  private selectionPinned = false
  private opening: Promise<BrowserSession> | undefined
  private openingTab: Promise<BrowserTabView> | undefined
  /** Classified last browser-source failure; what a blank tab is explained by. */
  private lastFailure: BrowserFailure | undefined
  /** Consecutive failed starts since the last live session. */
  private failedAttempts = 0
  private generation = 0
  private disposed = false

  /**
   * @param options - quality, viewport, clock, and the browser factory seam.
   */
  constructor(options: BrowserViewServiceOptions = {}) {
    this.jpegQuality = options.jpegQuality ?? DEFAULT_JPEG_QUALITY
    this.viewport = options.viewport ?? { width: DEFAULT_VIEWPORT.width, height: DEFAULT_VIEWPORT.height }
    this.now = options.now ?? Date.now
    this.openSession = options.openSession ?? openConfiguredSession
    this.configuredConfig = options.resolveConfig ?? (() => ({ mode: 'isolated' }))
    this.resolveConfig = () => {
      // An explicit attach wins, then a person's explicit isolated choice, and
      // only then the profile configuration: no source is ever picked silently.
      if (this.manualEndpoint !== undefined) return { mode: 'cdp', cdpEndpoint: this.manualEndpoint }
      if (this.manualMode !== undefined) return { mode: this.manualMode }
      return this.configuredConfig()
    }
    this.authenticatedUrl = options.authenticatedUrl
    this.idleCloseDays = options.idleCloseDays ?? (() => 0)
    this.sweepIntervalMs = options.sweepIntervalMs ?? IDLE_SWEEP_INTERVAL_MS
    if (this.sweepIntervalMs > 0) {
      const timer: ReturnType<typeof setInterval> = setInterval(() => {
        void this.sweepIdle().catch(() => undefined)
      }, this.sweepIntervalMs)
      // A pending timer holds a Node process open. The sweep is housekeeping:
      // it must never be the reason the host cannot exit.
      const unref = (timer as unknown as { unref?: () => void }).unref
      if (typeof unref === 'function') unref.call(timer)
      this.idleTimer = timer
    }
    this.livenessIntervalMs = options.livenessIntervalMs ?? 0
    this.livenessProbe = options.livenessProbe
      ?? (endpoint => probeCdpEndpoint(endpoint, { timeoutMs: LIVENESS_PROBE_TIMEOUT_MS }))
    this.chromeAvailable = options.chromeAvailable ?? (() => resolveChromePath() !== undefined)
    this.fallbackOnUnavailable = options.fallbackOnUnavailable ?? (() => 'never')
    if (this.livenessIntervalMs > 0) {
      const timer: ReturnType<typeof setInterval> = setInterval(() => {
        void this.checkLiveness().catch(() => undefined)
      }, this.livenessIntervalMs)
      const unref = (timer as unknown as { unref?: () => void }).unref
      if (typeof unref === 'function') unref.call(timer)
      this.livenessTimer = timer
    }
  }

  /** Whether a browser is currently running with an open transport. */
  get running(): boolean {
    return this.session !== undefined && !this.session.transport.closed
  }

  /** The current panel-facing state; safe to call before anything started. */
  state(): BrowserPanelState {
    const config = this.resolveConfig()
    const configured = this.configuredConfig()
    const live = this.session !== undefined && !this.session.transport.closed ? this.session : undefined
    const state: BrowserPanelState = {
      tabs: live?.tabs.list() ?? [],
      activeTabId: live === undefined ? null : this.displayedOrDefault(),
      running: live !== undefined,
      mode: config.mode,
    }
    if (config.mode === 'cdp' && config.cdpEndpoint !== undefined) {
      state.cdpEndpoint = this.endpointLabel(config.cdpEndpoint)
      // Only a host that can really launch the isolated browser may offer it.
      state.isolatedAvailable = this.chromeAvailable()
    }
    // A person overrode a configured real browser with the isolated one: the
    // panel needs the way back to be discoverable in its zero state.
    if (configured.mode === 'cdp' && config.mode !== 'cdp') state.realBrowserConfigured = true
    if (this.lastFailure !== undefined) {
      state.lastError = this.lastFailure
      // Kept for older panels: the same sentence the classified field carries.
      state.message = this.lastFailure.message
    }
    if (this.failedAttempts > 0) state.attempts = this.failedAttempts
    if (this.lastFallback !== undefined) state.autoFallback = { ...this.lastFallback }
    const preview = this.previewState()
    if (preview !== undefined) state.preview = preview
    return state
  }

  /**
   * Aggregate the temporary-override keys into the element list the panel
   * shows and highlights.
   * @returns the preview state, or undefined when no override is active.
   */
  private previewState(): BrowserPreviewState | undefined {
    const merged = new Set<string>([...this.agentPreviewKeys, ...this.panelPreviewKeys])
    if (merged.size === 0) return undefined
    const elements = new Map<string, PreviewElement>()
    for (const key of merged) {
      const parsed = parsePreviewKey(key)
      if (parsed === undefined) continue
      const id = `${parsed.relation}\u0000${parsed.selector}`
      if (!elements.has(id)) elements.set(id, { selector: parsed.selector, relation: parsed.relation })
    }
    if (elements.size === 0) return undefined
    return { active: true, count: elements.size, elements: [...elements.values()] }
  }

  /** Drop every temporary-style key and tell the panels the document is clean. */
  private clearPreview(): void {
    if (this.agentPreviewKeys.size === 0 && this.panelPreviewKeys.size === 0) return
    this.agentPreviewKeys.clear()
    this.panelPreviewKeys.clear()
    if (!this.disposed) this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * The normalized loopback origin for display, or the raw string when it does
   * not parse. Never throws: the panel must be able to render a bad endpoint.
   * @param raw - configured endpoint.
   * @returns the origin, or the input.
   */
  private endpointLabel(raw: string): string {
    try {
      return parseCdpEndpoint(raw).baseUrl
    } catch {
      return raw
    }
  }

  /**
   * Register one panel socket and start the stream it wants.
   * @param sink - socket adapter.
   * @returns the detach function.
   */
  attach(sink: BrowserViewSink): () => void {
    this.sinks.add(sink)
    // The hello frame is the panel's first paint: it carries the current tabs
    // so a reconnecting panel does not have to ask.
    sink.send({ v: 1, kind: 'hello', state: this.state() })
    void this.startStreaming().catch(() => undefined)
    return () => {
      this.sinks.delete(sink)
      // A socket that goes away takes the native guest with it. Leaving the
      // dead sink registered is what made every later webdev_desktop_* call
      // wait for an answer that could never arrive (#B1-a): fail it now, with
      // the reason, and let the next mounted panel claim the guest.
      if (this.nativeSink === sink) this.rejectNativeRequests(PANEL_NOT_MOUNTED_MESSAGE)
      if (this.sinks.size === 0) void this.stopStreaming()
    }
  }

  /**
   * Run one validated panel command.
   * @param sink - the sending socket.
   * @param command - validated command.
   */
  async handleCommand(sink: BrowserViewSink, command: BrowserViewCommand): Promise<void> {
    if (this.disposed) return
    try {
      switch (command.kind) {
        case 'attach': {
          // Attaching is observation, never operation: a panel that arrived
          // must not create a tab of its own, or the user ends up watching a
          // blank page instead of the one the agent is driving.
          this.followPanelSession(command.sessionId)
          sink.send({ v: 1, kind: 'hello', state: this.state() })
          await this.startStreaming()
          return
        }
        case 'select-tab': {
          const tabs = await this.requireTabs()
          // A person picked this tab in the panel: from here on the panels stop
          // following the agent until the choice no longer exists.
          tabs.selectTab(command.tabId)
          this.selectionPinned = true
          this.showTab(command.tabId)
          await this.startStreaming()
          return
        }
        case 'request-frame': {
          const tabs = await this.requireTabs()
          const tabId = this.displayedOrDefault()
          if (tabId === null) return
          this.displayedTabId = tabId
          await tabs.refreshFrame(tabId)
          return
        }
        case 'close-tab': {
          const tabs = await this.requireTabs()
          if (tabs.tab(command.tabId).origin === 'adopted') {
            throw new Error('an adopted real-browser tab can only be closed in the browser or by webdev_close with an explicit tab_id')
          }
          await this.closeTab(command.tabId)
          return
        }
        case 'input': {
          const tabId = this.displayedOrDefault()
          if (tabId === null) throw new Error('no page is being watched; open a page first')
          await dispatchInput(this.scope(), tabId, command.event)
          return
        }
        case 'pick': {
          const tabId = this.displayedOrDefault()
          if (tabId === null) throw new Error('no page is being watched; open a page first')
          try {
            const element = await pickElement(this.scope(), tabId, command.x, command.y)
            sink.send({ v: 1, kind: 'pick-result', requestId: command.requestId, element })
          } catch (error) {
            // A pick failure is local to one gesture: answer the requesting
            // panel instead of failing the whole socket with a global error.
            sink.send({
              v: 1,
              kind: 'pick-result',
              requestId: command.requestId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          return
        }
        case 'viewport': {
          const tabId = this.displayedOrDefault()
          if (tabId === null) return
          const tabs = await this.requireTabs()
          await tabs.setViewport(tabId, command.width, command.height, command.deviceScaleFactor ?? 1)
          return
        }
        case 'pick-mode': {
          const tabId = this.displayedOrDefault()
          if (tabId === null) throw new Error('no page is being watched; open a page first')
          const tabs = await this.requireTabs()
          await tabs.installPagePicker(tabId)
          await tabs.setPagePickerEnabled(tabId, command.enabled)
          sink.send({ v: 1, kind: 'pick-mode', enabled: command.enabled })
          return
        }
        case 'reconnect': {
          // The user's Retry: same source, one fresh attempt. Never a mode change.
          await this.reconnect()
          return
        }
        case 'open-isolated': {
          // Explicit, user-initiated source switch; the state push carries the
          // new mode, so no fallback ever happens behind the user's back. The
          // URL the panel was showing travels with the click so the page keeps
          // rendering here instead of in a second browser window.
          await this.openIsolated(command.url)
          return
        }
        case 'use-configured': {
          await this.useConfigured()
          return
        }
        case 'style-preview': {
          this.panelPreviewKeys.clear()
          for (const key of command.keys) this.panelPreviewKeys.add(key)
          this.broadcast({ v: 1, kind: 'state', state: this.state() })
          return
        }
        case 'preview-reset': {
          this.clearPreview()
          return
        }
        case 'native-attach': {
          if (this.nativeSink !== sink) this.rejectNativeRequests('another panel took the native guest')
          this.nativeSink = sink
          this.nativeSessionId = command.sessionId
          return
        }
        case 'native-detach': {
          if (this.nativeSink !== sink) return
          this.nativeSink = undefined
          this.nativeSessionId = undefined
          this.rejectNativeRequests('the native view was detached')
          return
        }
        case 'native-result': {
          const pending = this.nativePending.get(command.requestId)
          if (pending === undefined) return
          this.nativePending.delete(command.requestId)
          clearTimeout(pending.timer)
          if (command.error !== undefined) pending.reject(new Error(command.error))
          else pending.resolve(command.result)
          return
        }
        default: {
          const unreachable: never = command
          void unreachable
        }
      }
    } catch (error) {
      this.fail('command-failed', error)
    }
  }

  /**
   * Turn one page-side picker payload into a panel pick event.
   *
   * The page computes the selector and box in its own document; the host adds
   * the document generation and a fingerprint, then broadcasts the pick to every
   * attached panel. A malformed payload is dropped rather than failing the
   * panel that enabled picking.
   * @param tabId - tab the binding belonged to.
   * @param payload - JSON string produced by the page picker.
   */
  private handlePagePick(tabId: string, payload: string): void {
    if (this.disposed || this.session === undefined) return
    let data: Record<string, unknown>
    try {
      const parsed = JSON.parse(payload) as unknown
      if (typeof parsed !== 'object' || parsed === null) return
      data = parsed as Record<string, unknown>
    } catch {
      return
    }
    const selector = typeof data.selector === 'string' && data.selector.length > 0 ? data.selector : ''
    if (selector === '') return
    const tag = typeof data.tag === 'string' && data.tag.length > 0 ? data.tag.toLowerCase() : 'element'
    const text = typeof data.text === 'string' ? data.text.slice(0, 600) : undefined
    const id = typeof data.id === 'string' && data.id.length > 0 ? data.id : undefined
    const role = typeof data.role === 'string' && data.role.length > 0 ? data.role : undefined
    const classes = Array.isArray(data.classes)
      ? data.classes.filter((value): value is string => typeof value === 'string').slice(0, 8)
      : undefined
    const note = typeof data.note === 'string' && data.note.length > 0 ? data.note.slice(0, 500) : undefined
    let box: BrowserPickedElement['box']
    if (typeof data.rect === 'object' && data.rect !== null) {
      const rect = data.rect as Record<string, unknown>
      if (typeof rect.x === 'number' && typeof rect.y === 'number'
        && typeof rect.w === 'number' && typeof rect.h === 'number') {
        box = { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
      }
    }
    let pageVersion: number
    try {
      pageVersion = this.session.tabs.versionOf(tabId)
    } catch {
      return
    }
    const element: BrowserPickedElement = {
      pageVersion,
      selector,
      fingerprint: fingerprintOf(selector, text ?? ''),
      tag,
      ...id === undefined ? {} : { id },
      ...classes === undefined || classes.length === 0 ? {} : { classes },
      ...role === undefined ? {} : { role },
      ...text === undefined ? {} : { text },
      ...box === undefined ? {} : { box },
      ...note === undefined ? {} : { note },
    }
    this.broadcast({
      v: 1,
      kind: 'pick-result',
      requestId: `page-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      element,
    })
  }

  /**
   * Whether a panel is currently attached as the native Desktop guest.
   */
  nativeActive(): boolean {
    return this.nativeSink !== undefined
  }

  /**
   * Ask the attached native guest to run one operation and correlate the reply.
   * @param op - native operation.
   * @param args - operation arguments.
   * @param timeoutMs - deadline before the tool reports a broken bridge.
   */
  private async nativeRequest(op: string, args: unknown, timeoutMs = 30_000): Promise<unknown> {
    const sink = this.nativeSink
    if (sink === undefined) {
      // Immediate, explicit failure. Sending it anyway is what used to wait the
      // whole deadline for a panel that was never there (#B1-a).
      throw new Error(PANEL_NOT_MOUNTED_MESSAGE)
    }
    const requestId = `native-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.nativePending.delete(requestId)
        reject(new Error(`the native view did not answer ${op} within ${Math.round(timeoutMs / 1000)}s`))
      }, timeoutMs)
      this.nativePending.set(requestId, { resolve, reject, timer })
      try {
        sink.send({ v: 1, kind: 'native-request', requestId, op, ...args === undefined ? {} : { args } })
      } catch (error) {
        this.nativePending.delete(requestId)
        clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  /** Reject every in-flight native request and forget the sink. */
  private rejectNativeRequests(message: string): void {
    for (const [requestId, pending] of this.nativePending) {
      clearTimeout(pending.timer)
      pending.reject(new Error(message))
      this.nativePending.delete(requestId)
    }
    this.nativeSink = undefined
    this.nativeSessionId = undefined
    // The guest this preview belonged to is gone; the temporary overrides went
    // with its document, so the Preview chip must not outlive it.
    this.agentPreviewKeys.clear()
    this.panelPreviewKeys.clear()
    if (!this.disposed) this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * Snapshot the native guest and rebuild the ref map used by native clicks.
   * @param limit - maximum nodes.
   */
  async nativeSnapshot(limit = SNAPSHOT_NODE_LIMIT): Promise<BrowserSnapshot> {
    const raw = await this.nativeRequest('snapshot', { limit })
    if (typeof raw !== 'object' || raw === null) throw new Error('the native page did not return a snapshot')
    const payload = raw as Record<string, unknown>
    const source = Array.isArray(payload.nodes) ? payload.nodes : []
    const nodes: BrowserSnapshot['nodes'] = []
    this.nativeRefs.clear()
    for (const value of source) {
      if (typeof value !== 'object' || value === null) continue
      const node = value as Record<string, unknown>
      if (typeof node.tag !== 'string' || typeof node.selector !== 'string') continue
      const ref = nodes.length
      const box = typeof node.box === 'object' && node.box !== null ? node.box as Record<string, unknown> : undefined
      const built: BrowserSnapshot['nodes'][number] = {
        ref,
        tag: node.tag,
        depth: typeof node.depth === 'number' ? node.depth : 0,
        ...typeof node.id === 'string' ? { id: node.id } : {},
        ...Array.isArray(node.classes) ? { classes: node.classes.filter((item): item is string => typeof item === 'string') } : {},
        ...typeof node.role === 'string' ? { role: node.role } : {},
        ...typeof node.name === 'string' ? { name: node.name } : {},
        ...typeof node.text === 'string' ? { text: node.text } : {},
        ...box !== undefined && typeof box.x === 'number' && typeof box.y === 'number'
          && typeof box.width === 'number' && typeof box.height === 'number'
          ? { box: { x: box.x, y: box.y, width: box.width, height: box.height } }
          : {},
      }
      nodes.push(built)
      this.nativeRefs.set(ref, node.selector)
    }
    return {
      tabId: 'desktop',
      url: typeof payload.url === 'string' ? payload.url : '',
      title: typeof payload.title === 'string' ? payload.title : '',
      nodes,
      truncated: payload.truncated === true,
    }
  }

  /** Navigate the native guest and report its settled URL/title. */
  async nativeNavigate(url: string): Promise<{ url: string; title: string }> {
    const raw = await this.nativeRequest('navigate', { url })
    if (typeof raw !== 'object' || raw === null) return { url, title: '' }
    const payload = raw as Record<string, unknown>
    return {
      url: typeof payload.url === 'string' ? payload.url : url,
      title: typeof payload.title === 'string' ? payload.title : '',
    }
  }

  /** Resolve a ref/selector/point for a native click. */
  private nativeSelectorOf(target: { ref?: number; selector?: string }): string | undefined {
    if (target.selector !== undefined && target.selector !== '') return target.selector
    if (target.ref === undefined) return undefined
    const selector = this.nativeRefs.get(target.ref)
    if (selector === undefined) throw new Error(`native ref ${target.ref} is unknown; call webdev_native_snapshot again`)
    return selector
  }

  /** Click in the native guest. */
  async nativeClick(target: { ref?: number; selector?: string; x?: number; y?: number }): Promise<string> {
    const selector = this.nativeSelectorOf(target)
    if (selector === undefined && (target.x === undefined || target.y === undefined)) {
      throw new Error('native click needs a ref from webdev_native_snapshot, a selector, or x/y')
    }
    const raw = await this.nativeRequest('click', {
      ...selector === undefined ? {} : { selector },
      ...target.x === undefined ? {} : { x: target.x },
      ...target.y === undefined ? {} : { y: target.y },
    })
    const payload = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {}
    const tag = typeof payload.tag === 'string' ? payload.tag : 'element'
    const name = typeof payload.name === 'string' && payload.name.length > 0 ? ` "${payload.name}"` : ''
    return `clicked ${tag}${name} in the native view`
  }

  /** Insert text into the native guest's focused field. */
  async nativeType(target: { ref?: number; selector?: string; x?: number; y?: number }, text: string): Promise<string> {
    const selector = this.nativeSelectorOf(target)
    await this.nativeRequest('type', {
      ...selector === undefined ? {} : { selector },
      ...target.x === undefined ? {} : { x: target.x },
      ...target.y === undefined ? {} : { y: target.y },
      text,
    })
    return `typed ${text.length} character(s) in the native view`
  }

  /** Press one key in the native guest. */
  async nativePress(key: string): Promise<string> {
    await this.nativeRequest('press', { key })
    return `pressed ${key} in the native view`
  }

  /** Scroll the native guest. */
  async nativeScroll(x: number, y: number, deltaX: number, deltaY: number): Promise<string> {
    await this.nativeRequest('scroll', { x, y, deltaX, deltaY })
    return `scrolled the native view`
  }

  /** Capture the native guest as a PNG or JPEG data payload. */
  async nativeScreenshot(format: 'png' | 'jpeg' = 'png'): Promise<{
    data: string
    mediaType: 'image/png' | 'image/jpeg'
    width: number
    height: number
    url: string
    title: string
  }> {
    const raw = await this.nativeRequest('screenshot', { format }, 45_000)
    if (typeof raw !== 'object' || raw === null) throw new Error('the desktop page did not return a screenshot')
    const payload = raw as Record<string, unknown>
    if (typeof payload.data !== 'string' || payload.data.length === 0) throw new Error('the screenshot was empty')
    return {
      data: payload.data,
      // capturePage's data URL is PNG; the desktop guest has no JPEG encoder in
      // the renderer, so keep the bytes and the declared type in agreement.
      mediaType: 'image/png',
      width: typeof payload.width === 'number' ? payload.width : 0,
      height: typeof payload.height === 'number' ? payload.height : 0,
      url: typeof payload.url === 'string' ? payload.url : '',
      title: typeof payload.title === 'string' ? payload.title : '',
    }
  }

  /** Recent console entries from the native guest. */
  async nativeConsole(limit = 100): Promise<BrowserConsoleEntry[]> {
    const raw = await this.nativeRequest('console', { limit })
    if (!Array.isArray(raw)) return []
    return raw.filter((entry): entry is BrowserConsoleEntry => {
      return typeof entry === 'object' && entry !== null
        && typeof (entry as Record<string, unknown>).level === 'string'
        && typeof (entry as Record<string, unknown>).text === 'string'
        && typeof (entry as Record<string, unknown>).at === 'number'
    }).slice(-limit)
  }

  /**
   * Read style values for one element layer in the native guest.
   *
   * The panel answers with the authored inline value when the element has one,
   * otherwise with the computed value — the same value its style panel shows.
   * @param selector - CSS selector of the element.
   * @param properties - CSS properties to read, in order.
   * @param options - follow the parent element and/or read a pseudo-element.
   * @returns property to value, as the page reported it.
   */
  async nativeStyle(
    selector: string,
    properties: readonly string[],
    options: NativeStyleTargetOptions = {},
  ): Promise<Record<string, string>> {
    const raw = await this.nativeRequest('style-get', {
      selector,
      properties: [...properties],
      ...options,
    })
    if (typeof raw !== 'object' || raw === null) throw new Error('the desktop page did not return style values')
    const values: Record<string, string> = {}
    for (const [property, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'string') values[property] = value
    }
    return values
  }

  /**
   * Apply one temporary style in the native guest.
   *
   * Inline styles cover the element itself; a pseudo-element override is
   * written as a marked stylesheet rule by the panel. Both are runtime-only:
   * the live page changes, no source file is touched, and a reload or
   * navigation discards it.
   * @param selector - CSS selector of the element.
   * @param property - CSS property.
   * @param value - CSS value.
   * @param options - follow the parent element and/or target a pseudo-element.
   */
  async nativeStyleSet(
    selector: string,
    property: string,
    value: string,
    options: NativeStyleTargetOptions = {},
  ): Promise<void> {
    await this.nativeRequest('style-set', { selector, property, value, ...options })
    this.agentPreviewKeys.add(previewKey(options.relation ?? 'self', selector, options.pseudo ?? '', property))
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * Drop one temporary style again in the native guest.
   *
   * Removing the inline property reveals whatever the page's own stylesheet
   * says, which is what the panel's Reset does; a pseudo-element rule is
   * removed from the marked stylesheet.
   * @param selector - CSS selector of the element.
   * @param property - CSS property.
   * @param options - follow the parent element and/or target a pseudo-element.
   */
  async nativeStyleReset(
    selector: string,
    property: string,
    options: NativeStyleTargetOptions = {},
  ): Promise<void> {
    await this.nativeRequest('style-reset', { selector, property, ...options })
    this.agentPreviewKeys.delete(previewKey(options.relation ?? 'self', selector, options.pseudo ?? '', property))
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * Add one temporary-style line to every panel's action trace.
   *
   * The footer is where a person reads what just happened; a style preview is
   * an action even though it is not a tool call on a tab. The `preview` tone is
   * what makes the row render in the same blue as the document-state dot.
   * @param summary - one line, e.g. `#est_cn::after · border-radius: 24px → 0`.
   */
  noteStylePreview(summary: string): void {
    const trace: BrowserActionTrace = { tool: 'style', summary, at: this.now(), tone: 'preview' }
    this.broadcast({ v: 1, kind: 'action', trace })
  }

  /**
   * Resource timing from the native guest. The webview tag exposes no status
   * codes or pending requests; this is a loaded-resource list, not a network log.
   */
  async nativeNetwork(limit = 100): Promise<Array<{
    url: string
    initiatorType: string
    duration: number
    transferSize: number
  }>> {
    const raw = await this.nativeRequest('network', { limit })
    if (!Array.isArray(raw)) return []
    return raw.filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .filter((entry) => typeof entry.url === 'string')
      .map((entry) => ({
        url: entry.url as string,
        initiatorType: typeof entry.initiatorType === 'string' ? entry.initiatorType : 'other',
        duration: typeof entry.duration === 'number' ? entry.duration : 0,
        transferSize: typeof entry.transferSize === 'number' ? entry.transferSize : 0,
      }))
      .slice(-limit)
  }

  /**
   * Close one tab, drop every binding that pointed at it, and let the panels
   * fall back when the tab they were watching is the one that went away.
   *
   * Bindings are forgotten before the target goes, so a later tool call cannot
   * resurrect a tab somebody deliberately closed.
   * @param tabId - tab to close.
   */
  async closeTab(tabId: string): Promise<void> {
    const tabs = await this.requireTabs()
    const wasDisplayed = tabId === this.displayedTabId
    for (const [sessionId, boundTab] of [...this.bindings]) {
      if (boundTab === tabId) this.bindings.delete(sessionId)
    }
    await tabs.closeTab(tabId)
    if (wasDisplayed) {
      // The pinned tab is gone, so there is nothing left to hold: fall back to
      // whatever remains and resume following.
      this.selectionPinned = false
      this.displayedTabId = null
      this.showTab(tabs.list().at(-1)?.id ?? null)
    }
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * Close the tabs one agent session opened, and nothing else.
   *
   * Ownership is read off the tab record rather than the binding map: a session
   * may have driven somebody else's tab through an explicit `tabId`, and that
   * must not make the tab its own to destroy. A caller that names a tab it does
   * not own is refused with the reason instead of being quietly ignored, because
   * a cleanup that reports success while closing nothing is worse than an error.
   *
   * A session with no tab of its own, or a host with no browser running yet,
   * closes nothing and succeeds: cleanup is the one call that must be safe to
   * make unconditionally.
   * @param sessionId - calling agent session; absent means no ownership basis.
   * @param tabId - one tab to close; omitted closes every tab this session owns.
   * @returns ids of the tabs actually closed, in close order.
   */
  async closeOwnTabs(sessionId: string | undefined, tabId?: string): Promise<string[]> {
    if (sessionId === undefined) {
      throw new Error('webdev_close needs the calling session: with no session there is no tab this call may close')
    }
    if (this.session === undefined || this.session.transport.closed) {
      // Omitted tab_id stays a no-launch cleanup. An explicit real-browser id is
      // an operation, so it must connect and discover before it can close.
      if (tabId === undefined || tabId === '' || this.resolveConfig().mode !== 'cdp') return []
      await this.requireSession()
    }
    const session = this.session
    if (session === undefined) return []
    const tabs = session.tabs
    if (tabId !== undefined && tabId !== '') {
      const found = tabs.list().find(tab => tab.id === tabId)
      if (found === undefined) throw new Error(`unknown tab "${tabId}"; call webdev_tabs to see the open tabs`)
      if (session.mode !== 'cdp' && found.sessionId !== sessionId) {
        throw new Error(`tab "${tabId}" was not opened by this session, so it is not this session's to close`)
      }
      await this.closeTab(found.id)
      return [found.id]
    }
    const owned = tabs.list().filter(tab => tab.sessionId === sessionId)
    const closed: string[] = []
    for (const tab of owned) {
      await this.closeTab(tab.id)
      closed.push(tab.id)
    }
    return closed
  }

  /**
   * Close the tabs no browser tool has touched for the configured idle window.
   *
   * Scope is what the real-browser contract allows: only tabs DSH created are
   * candidates, and a page adopted from the person's own browser is never closed
   * by a timer — that contract keeps adopted pages closable only through an
   * explicit `tab_id`. The window is read per sweep, so a settings edit applies
   * to the next one, and a host with no browser running closes nothing and
   * starts none: cleanup must never cost a process.
   * @returns ids of the tabs actually closed, in close order.
   */
  async sweepIdle(): Promise<string[]> {
    if (this.disposed) return []
    const days = this.idleCloseDays()
    if (!(days > 0)) return []
    const session = this.session
    if (session === undefined || session.transport.closed) return []
    const closed: string[] = []
    for (const tabId of session.tabs.idleCandidates(days * DAY_MS)) {
      // Nothing to do for a target that closed itself between the scan and the
      // close: the sweep already has the outcome it wanted.
      if (!session.tabs.has(tabId)) continue
      await this.closeTab(tabId).catch(() => undefined)
      if (!session.tabs.has(tabId)) closed.push(tabId)
    }
    return closed
  }

  /**
   * Resolve the tab a tool call from `sessionId` should act on.
   *
   * The order is a safety property, not a preference. An agent that lands on
   * the tab the panel happens to be showing destroys whatever the user was
   * looking at, so the watched tab is only ever a last resort:
   *
   * 1. the tab the caller named,
   * 2. the tab this session created or last worked in,
   * 3. the watched tab, but only while no other session owns it,
   * 4. otherwise a tab of its own.
   *
   * Step 3 exists for the case where the user opened a page nobody is driving
   * (they navigated or selected it themselves); step 3's ownership guard is
   * what keeps a bystander session from taking over a page another session
   * owns — the exact way the watched page used to be lost.
   * @param sessionId - calling agent session, when the host provides one.
   * @param tabId - explicit tab from the tool arguments.
   * @returns the tab view.
   */
  async tabFor(sessionId: string | undefined, tabId?: string): Promise<BrowserTabView> {
    return await this.runWithSession(async () => await this.doTabFor(sessionId, tabId))
  }

  private async doTabFor(sessionId: string | undefined, tabId?: string): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    const tab = await this.resolveTabFor(tabs, sessionId, tabId)
    // Every tool call that resolves a tab counts as activity. That is the whole
    // activity signal the idle sweep has, and it is what keeps a page somebody
    // is driving from ageing out mid-task.
    tabs.touch(tab.id)
    return tab
  }

  /**
   * Apply {@link tabFor}'s resolution order against an already open manager.
   * @param tabs - the live tab manager.
   * @param sessionId - calling agent session, when the host provides one.
   * @param tabId - explicit tab from the tool arguments.
   * @returns the tab the call should act on.
   */
  private async resolveTabFor(
    tabs: TabManager,
    sessionId: string | undefined,
    tabId?: string,
  ): Promise<BrowserTabView> {
    if (tabId !== undefined && tabId !== '') {
      const found = tabs.list().find(tab => tab.id === tabId)
      if (found === undefined) throw new Error(`unknown tab "${tabId}"; call webdev_tabs to see the open tabs`)
      if (sessionId !== undefined) this.bindings.set(sessionId, found.id)
      this.focusFollowed(found.id)
      return found
    }
    if (sessionId !== undefined) {
      const bound = this.bindings.get(sessionId)
      if (bound !== undefined) {
        const found = tabs.list().find(tab => tab.id === bound)
        if (found !== undefined) {
          this.focusFollowed(found.id)
          return found
        }
        this.bindings.delete(sessionId)
      }
    }
    const watching = this.displayedOrDefault()
    if (watching !== null) {
      const found = tabs.list().find(tab => tab.id === watching)
      // Safety invariant, not a default-value preference: one tool navigation
      // must never drive the page the user is watching. A page another session
      // owns is therefore not this session's to drive — falling through to a
      // tab of its own is what holds that invariant, and this guard is what
      // makes it a property rather than an accident of ordering.
      if (found !== undefined && !this.ownedByOtherSession(found.id, sessionId)) {
        if (sessionId !== undefined) this.bindings.set(sessionId, found.id)
        this.focusFollowed(found.id)
        return found
      }
    }
    return await this.ensureTab(sessionId)
  }

  /**
   * Whether a tab is bound to some other session.
   * @param tabId - the tab being considered.
   * @param sessionId - the asking session, which does not count as other.
   * @returns true when another session already drives this tab.
   */
  private ownedByOtherSession(tabId: string, sessionId: string | undefined): boolean {
    for (const [owner, bound] of this.bindings) {
      if (bound === tabId && owner !== sessionId) return true
    }
    return false
  }

  /**
   * Get (or lazily create) the tab bound to one session.
   * @param sessionId - calling agent session.
   * @returns the tab view.
   */
  async ensureTab(sessionId?: string): Promise<BrowserTabView> {
    return await this.runWithSession(async () => await this.doEnsureTab(sessionId))
  }

  private async doEnsureTab(sessionId?: string): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    if (sessionId !== undefined) {
      const bound = this.bindings.get(sessionId)
      if (bound !== undefined) {
        const found = tabs.list().find(tab => tab.id === bound)
        if (found !== undefined) return found
        this.bindings.delete(sessionId)
      }
    }
    // Two concurrent tool calls from a fresh session must share one tab, not
    // race two `Target.createTarget` calls into existence.
    this.openingTab ??= this.createBoundTab(sessionId).finally(() => { this.openingTab = undefined })
    return await this.openingTab
  }

  /** Create a tab, bind it, and make it the one the panel watches. */
  private async createBoundTab(sessionId: string | undefined): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    const created = await this.openTab(sessionId)
    // An unopened page still needs its first frame, or the panel shows an empty
    // viewer until something happens to move the compositor.
    await tabs.refreshFrame(created.id).catch(() => undefined)
    return created
  }

  /**
   * Open one additional tab for a session, deliberately without the
   * first-use deduplication {@link ensureTab} applies: asking for a new tab is
   * what the caller wants, so two calls must produce two tabs.
   * @param sessionId - calling agent session.
   * @returns the new tab view, now the session's bound tab and the panel's active one.
   */
  private async openTab(sessionId: string | undefined): Promise<BrowserTabView> {
    const tabs = await this.requireTabs()
    const created = await tabs.createTab({ url: 'about:blank', sessionId })
    if (sessionId !== undefined) {
      this.bindings.set(sessionId, created.id)
      tabs.bindSession(created.id, sessionId)
    }
    // A freshly opened tab is what the agent is about to work on, so a
    // following panel moves to it; a pinned panel keeps its own choice.
    this.focusFollowed(created.id)
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    return created
  }

  /**
   * Navigate a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param url - destination.
   * @param tabId - explicit tab, when the caller named one.
   * @param options - `newTab` opens an additional tab instead of reusing one.
   * @returns the action outcome plus the resulting tab view.
   */
  async navigate(
    sessionId: string | undefined,
    url: string,
    tabId?: string,
    options: { newTab?: boolean } = {},
  ): Promise<{ outcome: ActionOutcome; tab: BrowserTabView }> {
    return await this.runWithSession(async () => {
      // An explicit request for a new tab wins over a tab id: the caller is
      // describing where the page should open, not which existing tab to reuse.
      const tab = options.newTab === true
        ? await this.openTab(sessionId)
        : await this.doTabFor(sessionId, tabId)
      try {
        const outcome = await navigateTo(this.scope(), tab.id, url)
        await this.topUpAuthTicket(tab.id, url)
        return { outcome: this.trace('navigate', outcome), tab: this.refreshTab(tab.id) }
      } finally {
        // Every navigation gets its own single retry: a later one may be a
        // different page, and a rotated or expired cookie needs the same top-up.
        this.authTopUpSpent.delete(tab.id)
      }
    })
  }

  /**
   * Give a loopback navigation that landed on DSH's own authentication page
   * one launch-token retry.
   *
   * The token rides the URL, and DSH answers the site root with a 303 to the
   * clean address plus the `dsh-auth-<authority>` cookie, so the retried
   * request is served normally. This is an enhancement, never a dependency: a
   * host that mounts no connection service, a seam that throws, and a page
   * that is still the challenge afterwards all end here without an error and
   * leave the navigation result exactly as it is.
   * @param tabId - tab the navigation ran in.
   * @param url - the URL the caller asked for.
   */
  private async topUpAuthTicket(tabId: string, url: string): Promise<void> {
    let ticket = await this.authTicketUrl(tabId, url)
    while (ticket !== undefined) {
      this.authTopUpSpent.add(tabId)
      await navigateTo(this.scope(), tabId, ticket)
      ticket = await this.authTicketUrl(tabId, url)
    }
  }

  /**
   * The ticketed URL for this navigation, or undefined when no retry applies.
   * @param tabId - tab the navigation ran in.
   * @param url - the URL the caller asked for.
   * @returns the URL to retry with, or undefined.
   */
  private async authTicketUrl(tabId: string, url: string): Promise<string | undefined> {
    if (this.authTopUpSpent.has(tabId)) return undefined
    const mint = this.authenticatedUrl
    if (mint === undefined) return undefined
    if (!isLoopbackTarget(url)) return undefined
    if (!(await this.documentShowsAuthChallenge(tabId))) return undefined
    try {
      const ticket = mint(url)
      return typeof ticket === 'string' && ticket !== '' ? ticket : undefined
    } catch {
      return undefined
    }
  }

  /**
   * Whether the tab's current document is DSH's authentication page. Reading
   * the document is best-effort: a tab that refuses the script, or reports
   * something other than text, simply does not match.
   * @param tabId - tab to read.
   * @returns true when the page body is the challenge.
   */
  private async documentShowsAuthChallenge(tabId: string): Promise<boolean> {
    try {
      const scope = this.scope()
      const result = await scope.transport.send<{ result?: { value?: unknown } }>(
        'Runtime.evaluate',
        { expression: DOCUMENT_TEXT_EXPRESSION, returnByValue: true },
        scope.tabs.sessionOf(tabId),
      )
      const text = result.result?.value
      return typeof text === 'string' && isAuthChallengeText(text)
    } catch {
      return false
    }
  }

  /**
   * Click in a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param target - ref, selector, or coordinates.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async click(sessionId: string | undefined, target: ElementTarget, tabId?: string): Promise<ActionOutcome> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const outcome = await clickElement(this.scope(), tab.id, target)
      return this.trace('click', outcome)
    })
  }

  /**
   * Type into a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param text - text to insert.
   * @param target - optional element to focus first.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async type(sessionId: string | undefined, text: string, target: ElementTarget = {}, tabId?: string): Promise<ActionOutcome> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const outcome = await typeText(this.scope(), tab.id, text, target)
      return this.trace('type', outcome)
    })
  }

  /**
   * Press one key and trace the action.
   * @param sessionId - calling agent session.
   * @param key - key name or single character.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async press(sessionId: string | undefined, key: string, tabId?: string): Promise<ActionOutcome> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const outcome = await pressKey(this.scope(), tab.id, key)
      return this.trace('press', outcome)
    })
  }

  /**
   * Scroll a tab and trace the action.
   * @param sessionId - calling agent session.
   * @param delta - scroll distance.
   * @param tabId - explicit tab.
   * @returns the recorded outcome.
   */
  async scroll(sessionId: string | undefined, delta: { deltaX?: number; deltaY?: number; x?: number; y?: number }, tabId?: string): Promise<ActionOutcome> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const outcome = await scrollBy(this.scope(), tab.id, delta)
      return this.trace('scroll', outcome)
    })
  }

  /**
   * Walk the tab's DOM and remember the ref map for later clicks.
   * @param sessionId - calling agent session.
   * @param tabId - explicit tab.
   * @returns the snapshot the model sees.
   */
  async snapshot(sessionId: string | undefined, tabId?: string): Promise<BrowserSnapshot> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const tabs = this.scope().tabs
      const result: SnapshotResult = await buildSnapshot(this.transport(), tab.id, tabs.sessionOf(tab.id), {
        url: tab.url,
        title: tab.title,
      })
      // Record before returning: the very next call is usually the click that
      // uses one of these refs.
      tabs.setSnapshotRefs(tab.id, result.refs)
      return result.snapshot
    })
  }

  /**
   * Evaluate one expression in the tab.
   *
   * This is the tool behind the "no more guessing from pixels" rule: when the
   * question is `getBoundingClientRect()` or a computed style, the page answers
   * it directly instead of the caller editing a build artifact and reading the
   * console back. The expression runs with the page's own authority, so the tool
   * description says the page may lie and the result is untrusted data.
   * @param sessionId - calling agent session.
   * @param tabId - explicit tab.
   * @param request - expression, promise policy, and deadline.
   * @returns the tab and the normalized value.
   */
  async evaluate(
    sessionId: string | undefined,
    tabId: string | undefined,
    request: EvalRequest,
  ): Promise<{ tabId: string; url: string; title: string; outcome: EvalOutcome }> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const outcome = await this.scope().tabs.evaluate(tab.id, request)
      const current = this.scope().tabs.list().find(candidate => candidate.id === tab.id) ?? tab
      return { tabId: current.id, url: current.url, title: current.title, outcome }
    })
  }

  /**
   * Measure one element, or the page's own boxes when no selector is given.
   *
   * The selector comes from the caller; a `ref` is resolved through the last
   * snapshot's map first, exactly like a click, so measuring the element the
   * model just looked at needs no selector guesswork.
   * @param sessionId - calling agent session.
   * @param tabId - explicit tab.
   * @param target - selector, or a snapshot ref, or neither for page metrics.
   * @returns the tab and the measurement.
   */
  async measure(
    sessionId: string | undefined,
    tabId: string | undefined,
    target: { selector?: string; ref?: number },
  ): Promise<{ tabId: string; url: string; title: string; report: MeasureReport }> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const tabs = this.scope().tabs
      const selector = target.selector !== undefined
        ? target.selector
        : target.ref !== undefined ? tabs.selectorForRef(tab.id, target.ref) : null
      const report = await tabs.measure(tab.id, selector)
      const current = tabs.list().find(candidate => candidate.id === tab.id) ?? tab
      return { tabId: current.id, url: current.url, title: current.title, report }
    })
  }

  /**
   * Capture one image of the tab.
   *
   * The plan decides everything the caller is told about the bytes: the format
   * becomes the media type the attachment service stores, and the scale turns
   * one capture into a cropped render whose encoded size has to be reported
   * rather than guessed from the viewport. Planning before the capture is what
   * makes an impossible request fail here, with the numbers, instead of
   * producing a truncated or silently downscaled image. The viewport it plans
   * against is the tab's own: a pinned tab answers from configuration, and an
   * adopted real-browser tab reports the page's real layout viewport.
   * @param sessionId - calling agent session.
   * @param tabId - explicit tab.
   * @param request - format, clip, and scale; every field is optional.
   * @returns the tab, the base64 payload, and the media type and encoded size the plan produced.
   * @throws when the request cannot be honoured by this viewport or the size limits.
   */
  async screenshot(
    sessionId: string | undefined,
    tabId?: string,
    request: ScreenshotRequest = {},
  ): Promise<{
    tabId: string
    url: string
    title: string
    data: string
    mediaType: ScreenshotPlan['mediaType']
    width: number
    height: number
    scale: number
    viewport: { width: number; height: number }
    pageOffset: PageOffset
    region: ScreenshotPlan['region']
    actual?: ImageSize
    warning?: 'image-size-mismatch'
  }> {
    return await this.runWithSession(async () => {
      const tab = await this.doTabFor(sessionId, tabId)
      const tabs = this.scope().tabs
      // Plan against the size this tab really renders at, not the configured one:
      // a tab adopted from a real browser keeps its window's viewport, so a clip
      // that fits the page would be refused and the reported pixel size would
      // describe an image that was never produced.
      //
      // The page scroll is only read when the capture sends a clip, because that
      // is the only case CDP needs page coordinates for; a plain viewport capture
      // therefore still costs a pinned tab no protocol round-trip.
      const wantsClip = request.clip !== undefined || (request.scale !== undefined && request.scale > 1)
      let viewport = await tabs.viewportOf(tab.id)
      let pageOffset: PageOffset = wantsClip ? (await tabs.metricsOf(tab.id)).pageOffset : { x: 0, y: 0 }
      const capture = async (at: PageOffset): Promise<{ plan: ScreenshotPlan; data: string; actual?: ImageSize }> => {
        const plan = planScreenshot(viewport, request, this.jpegQuality, at)
        const data = await tabs.captureScreenshot(tab.id, plan.params)
        return { plan, data, actual: imageSizeOf(Buffer.from(data, 'base64')) }
      }
      let shot = await capture(pageOffset)
      // One retry when the page moved between reading its metrics and the
      // capture: a resize or a scroll in that window makes the image describe a
      // different rectangle than the plan, and the caller has no way to tell.
      if (shot.actual !== undefined && (shot.actual.width !== shot.plan.width || shot.actual.height !== shot.plan.height)) {
        const fresh = await tabs.metricsOf(tab.id)
        viewport = fresh.viewport
        pageOffset = fresh.pageOffset
        shot = await capture(pageOffset)
      }
      const current = tabs.list().find(candidate => candidate.id === tab.id) ?? tab
      const matched = shot.actual !== undefined
        && shot.actual.width === shot.plan.width
        && shot.actual.height === shot.plan.height
      return {
        tabId: current.id,
        url: current.url,
        title: current.title,
        data: shot.data,
        mediaType: shot.plan.mediaType,
        width: shot.plan.width,
        height: shot.plan.height,
        scale: shot.plan.scale,
        viewport: { ...viewport },
        pageOffset: { ...shot.plan.pageOffset },
        region: { ...shot.plan.region },
        ...shot.actual === undefined ? {} : { actual: shot.actual },
        // The honest failure mode: an image that is not the size the plan asked
        // for is still returned, but the caller is told not to trust its scale.
        ...shot.actual !== undefined && !matched ? { warning: 'image-size-mismatch' as const } : {},
      }
    })
  }

  /**
   * Console entries of one tab, newest last.
   * @param sessionId - calling agent session.
   * @param limit - maximum trailing entries to return.
   * @param tabId - explicit tab.
   * @returns the entries.
   */
  async console(sessionId: string | undefined, limit = 100, tabId?: string): Promise<{ tabId: string; entries: BrowserConsoleEntry[] }> {
    const tab = await this.tabFor(sessionId, tabId)
    const tabs = await this.requireTabs()
    const entries = tabs.consoleEntries(tab.id)
    return { tabId: tab.id, entries: entries.slice(Math.max(0, entries.length - limit)) }
  }

  /**
   * Network entries of one tab, newest last.
   * @param sessionId - calling agent session.
   * @param limit - maximum trailing entries to return.
   * @param tabId - explicit tab.
   * @returns the entries.
   */
  async network(sessionId: string | undefined, limit = 100, tabId?: string): Promise<{ tabId: string; entries: BrowserNetworkEntry[] }> {
    const tab = await this.tabFor(sessionId, tabId)
    const tabs = await this.requireTabs()
    const entries = tabs.networkEntries(tab.id)
    return { tabId: tab.id, entries: entries.slice(Math.max(0, entries.length - limit)) }
  }

  /** Open tabs, for `webdev_tabs`. */
  async listTabs(): Promise<{ tabs: BrowserTabView[]; activeTabId: string | null }> {
    if (this.session === undefined || this.session.transport.closed) {
      // Isolated listing stays a cheap no-launch probe. Drop any dead stale
      // handle so state()/running stop presenting closed tabs as healthy (#2051).
      if (this.resolveConfig().mode !== 'cdp') {
        if (this.session !== undefined && this.session.transport.closed) {
          const stale = this.forgetSession()
          if (stale !== undefined) void stale.dispose().catch(() => undefined)
          this.broadcast({ v: 1, kind: 'state', state: this.state() })
        }
        return { tabs: [], activeTabId: null }
      }
      await this.requireSession()
    }
    const session = this.session
    if (session === undefined) return { tabs: [], activeTabId: null }
    return { tabs: session.tabs.list(), activeTabId: this.displayedOrDefault() }
  }

  /** Push one event to every attached panel, dropping sockets that fail. */
  broadcast(event: BrowserViewEvent): void {
    for (const sink of [...this.sinks]) {
      try {
        sink.send(event)
      } catch {
        this.sinks.delete(sink)
      }
    }
  }

  /** Apply a settings edit: detach the old source and restart an attached panel's stream. */
  async reconfigure(): Promise<void> {
    if (this.disposed) return
    this.generation += 1
    this.opening = undefined
    const session = this.forgetSession()
    this.lastFailure = undefined
    this.failedAttempts = 0
    // An automatic downgrade is not a choice the person made: a settings edit is
    // a fresh start, so the profile's new configuration gets the first attempt
    // instead of being shadowed by a fallback from the previous one.
    if (this.lastFallback !== undefined) {
      this.lastFallback = undefined
      this.manualMode = undefined
      this.manualEndpoint = undefined
    }
    this.agentPreviewKeys.clear()
    this.panelPreviewKeys.clear()
    if (session !== undefined) await session.dispose()
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    if (this.sinks.size > 0) await this.startStreaming().catch(() => undefined)
  }

  /**
   * Retry the configured browser source once, for the panel's Retry control.
   *
   * The mode never changes here: a real-browser configuration that is still
   * unreachable reports the same classified failure with one more attempt,
   * instead of quietly becoming something else. Failures are recorded rather
   * than thrown, because this runs from a panel command whose result is a state
   * push.
   * @returns the state after the attempt.
   */
  async reconnect(): Promise<BrowserPanelState> {
    if (this.disposed) return this.state()
    this.generation += 1
    this.opening = undefined
    const session = this.forgetSession()
    if (session !== undefined) await session.dispose().catch(() => undefined)
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    try {
      await this.requireSession()
      await this.startStreaming().catch(() => undefined)
    } catch {
      // startSession recorded the classified failure and broadcast it.
    }
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    return this.state()
  }

  /**
   * Switch to the isolated Chromium the viewer launches itself.
   *
   * This is the one sanctioned way around "the real browser must be started by
   * hand", and both callers use it: a person clicking "Open in isolated
   * Chromium" in the panel and the agent's `webdev_open_isolated` tool. The
   * switch is explicit in both cases — the mode change is pushed to every
   * panel, and the status row names the carrier — so it is never chosen
   * automatically. When the panel or the tool sends the page it was showing,
   * that page is opened in the new browser, so recovery restores the view
   * instead of handing back an empty panel.
   *
   * Asking for the carrier that is already selected is a request to *use* it,
   * not to replace it: relaunching would close a live browser and every tab it
   * holds for a no-op. That is why the reconfigure is conditional — the agent
   * tool calls this on each recovery attempt, so the idempotent path is the
   * common one.
   * @param url - page to open once the isolated browser is up.
   * @returns the state after the attempt, including a classified launch failure.
   */
  async openIsolated(url?: string): Promise<BrowserPanelState> {
    if (this.disposed) return this.state()
    const switching = this.resolveConfig().mode !== 'isolated'
    this.manualMode = 'isolated'
    this.manualEndpoint = undefined
    if (switching) await this.reconfigure()
    try {
      await this.requireSession()
      await this.startStreaming().catch(() => undefined)
    } catch {
      // startSession recorded the classified launch failure and broadcast it.
    }
    if (url !== undefined && url !== '' && this.session !== undefined) {
      // An unbound tab: the caller asked for this page, not for an agent's tab.
      await this.navigate(undefined, url)
    }
    // A source change needs its own push so every panel repaints the carrier;
    // an unchanged one already broadcast whatever startSession had to say.
    if (switching) this.broadcast({ v: 1, kind: 'state', state: this.state() })
    return this.state()
  }

  /**
   * Forget any explicit source and go back to the configured browser.
   * @returns the state after the switch.
   */
  async useConfigured(): Promise<BrowserPanelState> {
    if (this.disposed) return this.state()
    this.manualMode = undefined
    this.manualEndpoint = undefined
    // Going back is the end of the recorded downgrade: the viewer is asking for
    // the configured source again, so the note that explains the old carrier
    // would only describe a state that no longer exists.
    this.lastFallback = undefined
    await this.reconfigure()
    return this.state()
  }

  /**
   * Notice that the attached real browser went away, and recover when it returns.
   *
   * Only runs while a panel is watching: a host nobody is looking at must not
   * poll a port or reopen a browser. One discovery GET after the fact, with one
   * short recheck, is what keeps a busy browser from being declared dead. When
   * the session is gone the check keeps probing and attaches again as soon as
   * the endpoint answers, so a restarted browser needs no agent turn and no
   * click; until then the panel shows the classified disconnect and Reconnect.
   * @returns once the check settled; never throws.
   */
  async checkLiveness(): Promise<void> {
    if (this.disposed || this.probing || this.sinks.size === 0) return
    const config = this.resolveConfig()
    if (config.mode !== 'cdp' || config.cdpEndpoint === undefined) return
    const endpoint = config.cdpEndpoint
    this.probing = true
    try {
      const session = this.session
      if (session !== undefined && !session.transport.closed) {
        if (await this.endpointAnswers(endpoint)) return
        await sleep(LIVENESS_RECHECK_DELAY_MS)
        if (await this.endpointAnswers(endpoint)) return
        await this.dropDisconnected(session, endpoint)
        return
      }
      if (session !== undefined) {
        // The transport already closed: the browser is gone whatever a probe
        // says, so report it immediately instead of leaving a frozen picture.
        await this.dropDisconnected(session, endpoint)
        return
      }
      // No session: recover from a shown failure only once something answers.
      if (this.lastFailure === undefined) return
      if (!(await this.endpointAnswers(endpoint))) return
      try {
        await this.requireSession()
        await this.startStreaming().catch(() => undefined)
      } catch {
        // startSession recorded the fresh failure; the next tick retries.
      }
    } finally {
      this.probing = false
    }
  }

  /**
   * Whether the configured endpoint's discovery document answers right now.
   * @param raw - configured loopback endpoint.
   * @returns true when the probe saw a usable document.
   */
  private async endpointAnswers(raw: string): Promise<boolean> {
    let endpoint: CdpEndpoint
    try {
      endpoint = parseCdpEndpoint(raw)
    } catch {
      return false
    }
    try {
      return await this.livenessProbe(endpoint)
    } catch {
      return false
    }
  }

  /**
   * Record one real-browser disconnect and drop its session.
   *
   * The failed browser is only detached: its pages belong to the person, so
   * dropping the viewer must never close them.
   * @param session - the session that went away.
   * @param endpoint - the endpoint it was attached to.
   */
  private async dropDisconnected(session: BrowserSession, endpoint: string): Promise<void> {
    if (this.session !== session) return
    const stale = this.forgetSession()
    const message = `The real browser at ${this.endpointLabel(endpoint)} closed or stopped answering; the viewer is disconnected.`
    const failure = this.recordFailure(new Error(message), REAL_BROWSER_DISCONNECTED_CODE, 'cdp', endpoint, 'econnrefused')
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    this.broadcast({ v: 1, kind: 'error', code: 'browser-disconnected', message: failure.message })
    await stale?.dispose().catch(() => undefined)
  }

  /**
   * Switch this service to an existing CDP endpoint, such as the renderer of
   * an Electron app started with `--remote-debugging-port`.
   *
   * This is an attach-only path: the endpoint must be loopback HTTP(S) and is
   * validated with the same parser as the configured real-browser endpoint.
   * The debug port has no authentication; treat everything reachable through
   * it as local code execution. Main-process JavaScript and stdout/stderr are
   * not part of this protocol.
   * @param endpoint - loopback CDP HTTP endpoint, e.g. `http://127.0.0.1:9222`.
   * @returns the panel state after the switch.
   */
  async attachEndpoint(endpoint: string): Promise<BrowserPanelState> {
    const parsed = parseCdpEndpoint(endpoint)
    this.manualEndpoint = parsed.baseUrl
    this.manualMode = undefined
    await this.reconfigure()
    await this.requireSession()
    return this.state()
  }

  /** Forget an explicit attach or isolated choice and return to the configured browser source. */
  async detachEndpoint(): Promise<void> {
    this.manualEndpoint = undefined
    this.manualMode = undefined
    this.lastFallback = undefined
    await this.reconfigure()
    if (this.sinks.size > 0) await this.requireSession()
  }

  /**
   * Tear everything down: stop pushing, stop streaming, close the socket, kill
   * the browser.
   * @returns once every owned resource is released.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    if (this.idleTimer !== undefined) {
      clearInterval(this.idleTimer)
      this.idleTimer = undefined
    }
    if (this.livenessTimer !== undefined) {
      clearInterval(this.livenessTimer)
      this.livenessTimer = undefined
    }
    this.generation += 1
    this.opening = undefined
    // Stop broadcasting first: a panel must not receive a frame from a browser
    // that is already being killed.
    const sinks = [...this.sinks]
    this.sinks.clear()
    for (const sink of sinks) {
      try {
        sink.close()
      } catch {
        // A socket that is already gone needs no second close.
      }
    }
    this.rejectNativeRequests(PANEL_NOT_MOUNTED_MESSAGE)
    const session = this.forgetSession()
    if (session !== undefined) await session.dispose()
  }

  /** The action helpers' collaborator view: one transport, one tab manager. */
  private scope(): { transport: CdpTransport; tabs: TabManager } {
    const session = this.session
    if (session === undefined) throw new Error('the browser is not running')
    return { transport: session.transport, tabs: session.tabs }
  }

  /** The protocol transport of the running session. */
  private transport(): CdpTransport {
    return this.scope().transport
  }

  /** Resolve the live session or start one. */
  private async requireTabs(): Promise<TabManager> {
    return (await this.requireSession()).tabs
  }

  /**
   * Forget everything bound to the current session without disposing it: the
   * per-session tab bindings, the watched tab, the pinned selection and the
   * spent auth tickets all describe a browser that is going away.
   * @returns the session that was dropped, if any.
   */
  private forgetSession(): BrowserSession | undefined {
    const session = this.session
    this.session = undefined
    this.bindings.clear()
    this.authTopUpSpent.clear()
    this.displayedTabId = null
    this.selectionPinned = false
    return session
  }

  /**
   * Resolve the live session, starting the browser on first use.
   *
   * A session whose transport has closed is dead even though its record still
   * exists: the external browser restarted, crashed, or dropped the socket, and
   * every command would reject with that one stale reason for the rest of the
   * host's life. The next call therefore drops it exactly the way a settings
   * change does and opens a replacement, so the caller recovers instead of
   * needing a reconfigure or a restart. The replacement goes through `opening`,
   * so concurrent callers share one session instead of opening two.
   */
  private async requireSession(): Promise<BrowserSession> {
    if (this.disposed) throw new Error('the browser view service is disposed')
    const current = this.session
    if (current !== undefined && !current.transport.closed) return current
    if (this.opening === undefined) this.opening = this.replaceSession(current)
    const opening = this.opening
    try {
      return await opening
    } finally {
      if (this.opening === opening) this.opening = undefined
    }
  }

  /**
   * Drop a closed session and open its replacement.
   *
   * The cleanup is the settings-change cleanup: an external browser is only
   * detached, never closed, and its tabs stay open. A teardown that throws is
   * swallowed because the dead session has nothing left to deliver — its
   * failure must not be the reason no replacement starts.
   * @param stale - the dead session, or undefined for an ordinary first start.
   * @returns the live session.
   */
  private async replaceSession(stale: BrowserSession | undefined): Promise<BrowserSession> {
    if (stale === undefined) return await this.startSession()
    if (this.session === stale) this.forgetSession()
    await stale.dispose().catch(() => undefined)
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    const session = await this.startSession()
    // The panels were watching a tab of the dead session; a live screencast is
    // what makes the recovered browser visible without a settings change.
    if (this.sinks.size > 0) void this.startStreaming().catch(() => undefined)
    return session
  }

  /**
   * Run one operation against a live session; if a reused transport closes
   * mid-command, recycle the dead session and replay once so transient socket
   * drops self-heal in-flight (#2051).
   */
  private async runWithSession<T>(operation: () => Promise<T>): Promise<T> {
    const session = await this.requireSession()
    try {
      return await operation()
    } catch (error) {
      if (!session.transport.closed || this.disposed) throw error
      await this.requireSession()
      return await operation()
    }
  }

  /**
   * Start the browser once (retrying isolated launches once on transient
   * startup errors), recording persistent failures for the panel.
   */
  private async startSession(): Promise<BrowserSession> {
    const generation = this.generation
    const config = this.resolveConfig()
    const attemptOpen = async (): Promise<BrowserSession> => {
      const session = await this.openSession({
        ...config,
        jpegQuality: this.jpegQuality,
        viewport: this.viewport,
        onFrame: frame => { this.broadcast({ v: 1, kind: 'frame', ...frame }) },
        onTabsChanged: () => { this.broadcast({ v: 1, kind: 'state', state: this.state() }) },
        onPagePick: (tabId, payload) => { this.handlePagePick(tabId, payload) },
      })
      if (generation !== this.generation || this.disposed) {
        await session.dispose()
        throw new Error('the browser configuration changed while the session was opening')
      }
      return session
    }
    try {
      let session: BrowserSession
      try {
        session = await attemptOpen()
      } catch (firstError) {
        const message = firstError instanceof Error ? firstError.message : String(firstError)
        const canRetryIsolated =
          config.mode === 'isolated' &&
          generation === this.generation &&
          !this.disposed &&
          !/No Chrome binary found/i.test(message)
        if (!canRetryIsolated) throw firstError
        session = await attemptOpen()
      }
      this.session = session
      this.lastFailure = undefined
      this.failedAttempts = 0
      this.broadcast({ v: 1, kind: 'state', state: this.state() })
      return session
    } catch (error) {
      if (generation === this.generation && !this.disposed) {
        const classified = asClassifiedFailure(error)
        const reason = classified?.reason ?? classifyBrowserFailure(error)
        // A profile that pre-declared the downgrade gets it here, once, and only
        // for a reason that means the configured browser is not there. The
        // switch is recorded before the restart so the state a panel receives
        // names both the failure and the carrier it moved to.
        if (config.mode === 'cdp' && this.fallbackOnUnavailable() === 'isolated' && AUTO_FALLBACK_REASONS.has(reason)) {
          const failed = this.recordFailure(error, 'browser-connect-failed', config.mode, config.cdpEndpoint, reason)
          this.lastFallback = {
            from: 'cdp',
            reason,
            at: failed.at,
            ...failed.endpoint === undefined ? {} : { endpoint: failed.endpoint },
          }
          this.manualMode = 'isolated'
          this.manualEndpoint = undefined
          this.broadcast({ v: 1, kind: 'state', state: this.state() })
          // The recursive call resolves the config again: it now reads the
          // manual isolated choice, so this branch cannot run twice.
          return await this.startSession()
        }
        const failure = this.recordFailure(
          error,
          config.mode === 'cdp' ? 'browser-connect-failed' : ISOLATED_BROWSER_UNAVAILABLE_CODE,
          config.mode,
          config.mode === 'cdp' ? config.cdpEndpoint : undefined,
        )
        // A state push is what makes the failure visible to a panel that is not
        // reading the error event (or was not attached when it fired). The
        // error event stays last so a listener that ends on it still sees it.
        this.broadcast({ v: 1, kind: 'state', state: this.state() })
        this.broadcast({
          v: 1,
          kind: 'error',
          code: config.mode === 'cdp' ? 'browser-connect-failed' : 'browser-launch-failed',
          message: failure.message,
        })
      }
      throw error
    }
  }

  /**
   * Record one classified browser-source failure for the panel and the route.
   *
   * The message is kept verbatim, because it is the sentence the person reads:
   * a spawn failure carries the browser's own crashpad text there. The reason,
   * endpoint and remediation are added only as far as the host really knows
   * them, so nothing is invented for a failure it could not classify.
   * @param error - what the connect or launch path threw.
   * @param fallbackCode - stable code used when the error carries none.
   * @param mode - source the failure belongs to.
   * @param endpoint - endpoint that was tried, when the source was a CDP one.
   * @param reason - classified cause when the caller already knows it.
   * @returns the recorded failure.
   */
  private recordFailure(
    error: unknown,
    fallbackCode: string,
    mode: BrowserMode,
    endpoint?: string,
    reason?: BrowserFailureReason,
  ): BrowserFailure {
    this.failedAttempts += 1
    const classified = asClassifiedFailure(error)
    const raw = error instanceof Error ? error.message : String(error)
    const resolvedReason = reason ?? classified?.reason ?? classifyBrowserFailure(error)
    const failure: BrowserFailure = {
      code: classified?.code ?? fallbackCode,
      // A classified error's message is written for a tool call: it carries the
      // machine-readable JSON, which a panel should not render. The panel and
      // the route get one short sentence, the remediation as its own field, and
      // the genuine underlying text as `detail`.
      message: classified === undefined ? raw : classified.panelMessage,
      at: this.now(),
      mode,
      reason: resolvedReason,
      remediation: classified?.remediation ?? remediationFor(resolvedReason),
    }
    if (classified !== undefined) {
      if (classified.endpoint !== undefined) failure.endpoint = classified.endpoint
      const cause = classified.cause instanceof Error ? classified.cause.message : undefined
      if (cause !== undefined && cause !== '') failure.detail = cause
    } else if (endpoint !== undefined) {
      failure.endpoint = this.endpointLabel(endpoint)
    }
    this.lastFailure = failure
    return failure
  }

  /** Start the screencast for the tab the panel watches. */
  private async startStreaming(): Promise<void> {
    const live = this.session !== undefined && !this.session.transport.closed ? this.session : undefined
    const session = live
      ?? (this.resolveConfig().mode === 'cdp' && this.sinks.size > 0 ? await this.requireSession() : undefined)
    if (session === undefined || this.sinks.size === 0) return
    const tabId = this.displayedOrDefault()
    if (tabId === null) return
    this.displayedTabId = tabId
    await session.tabs.startScreencast(tabId).catch(error => { this.fail('screencast-failed', error) })
  }

  /** Stop streaming when nobody is watching. */
  private async stopStreaming(): Promise<void> {
    const session = this.session
    if (session === undefined) return
    const tabId = this.displayedOrDefault()
    if (tabId === null) return
    await session.tabs.stopScreencast(tabId).catch(() => undefined)
  }

  /**
   * The tab the panels currently watch: an explicit choice while that tab
   * still exists, otherwise the newest tab, so a panel is never left pointing
   * at a tab that no longer exists.
   * @returns the watched tab id, or null when nothing is open.
   */
  private displayedOrDefault(): string | null {
    const tabs = this.session?.tabs.list() ?? []
    if (this.displayedTabId !== null && tabs.some(tab => tab.id === this.displayedTabId)) return this.displayedTabId
    return tabs.at(-1)?.id ?? null
  }

  /**
   * Show one tab to the panels and move the screencast with it.
   * @param tabId - the tab to watch, or null when the last one closed.
   */
  private showTab(tabId: string | null): void {
    if (this.displayedTabId === tabId) {
      // Nothing moved, but the caller may still owe the panels a state frame
      // (a tab's url changed, for instance).
      this.broadcast({ v: 1, kind: 'state', state: this.state() })
      return
    }
    const session = this.session
    const previous = this.displayedTabId
    this.displayedTabId = tabId
    if (session !== undefined && this.sinks.size > 0) {
      // One screencast at a time: the tab nobody watches must stop emitting,
      // or a background page keeps the browser busy for no viewer.
      if (previous !== null) void session.tabs.stopScreencast(previous).catch(() => undefined)
      if (tabId !== null) void session.tabs.startScreencast(tabId).catch(() => undefined)
    }
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
  }

  /**
   * Let the panels follow an agent action unless a person pinned a tab.
   * @param tabId - the tab the agent just used.
   */
  private focusFollowed(tabId: string): void {
    if (this.selectionPinned) return
    this.showTab(tabId)
  }

  /**
   * Show the tab a panel's own session already owns, if it has one.
   *
   * Deliberately creates and binds nothing: an attaching panel observes. A
   * session without a tab keeps following the page the agent is driving.
   * @param sessionId - the session the panel belongs to.
   */
  private followPanelSession(sessionId: string | undefined): void {
    const session = this.session
    if (session === undefined || sessionId === undefined) return
    const bound = this.bindings.get(sessionId)
    if (bound === undefined) return
    const found = session.tabs.list().find(tab => tab.id === bound)
    if (found !== undefined) this.showTab(found.id)
  }

  /** Broadcast one readable action trace and return it as the tool outcome. */
  private trace(tool: string, outcome: ActionOutcome): ActionOutcome {
    const trace: BrowserActionTrace = { tool, summary: outcome.summary, at: this.now() }
    this.broadcast({ v: 1, kind: 'action', trace })
    this.broadcast({ v: 1, kind: 'state', state: this.state() })
    return outcome
  }

  /** Re-read one tab after a navigation changed its url. */
  private refreshTab(tabId: string): BrowserTabView {
    const session = this.session
    if (session === undefined) return { id: tabId, url: '', title: '', loading: false }
    return session.tabs.list().find(tab => tab.id === tabId) ?? { id: tabId, url: '', title: '', loading: false }
  }

  /** Report a transient command failure to the panels without throwing at the caller. */
  private fail(code: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    // Deliberately not recorded as lastFailure: a refused panel command (a
    // tab another session owns, a pick that missed) says nothing about whether
    // the browser source is reachable, and replacing the zero state's reason
    // with it would explain the wrong thing.
    this.broadcast({ v: 1, kind: 'error', code, message })
  }
}

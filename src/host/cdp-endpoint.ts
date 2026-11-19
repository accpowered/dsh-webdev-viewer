// Modified for dsh-webdev-viewer from @linxin666/dsh-client-ui-browser-view 0.4.19 (Apache-2.0). See NOTICE.
/**
 * Loopback-only discovery of an external Chrome DevTools endpoint, plus the
 * classification of why an attach failed.
 *
 * A raw `fetch failed` is useless to both the person reading the panel and the
 * agent reading a tool error: it cannot tell "the user never started a browser"
 * from "something else owns that port" from "the OS refused the browser
 * process". {@link classifyBrowserFailure} turns whatever the connect path threw
 * into the four stable reasons in the wire contract, and
 * {@link realBrowserUnavailable} carries them, the remediation, and a JSON line
 * an agent can branch on.
 *
 * @module dsh-webdev-viewer/host/cdp-endpoint
 */

import type { BrowserFailureReason } from '../core/protocol.ts'
import { REAL_BROWSER_UNAVAILABLE_CODE } from '../core/protocol.ts'
import { isLoopbackHostname } from './loopback.ts'

/** Normalized external CDP HTTP endpoint. */
export interface CdpEndpoint {
  /** Origin with no path, credentials, query, or fragment. */
  baseUrl: string
  /** The discovery document that publishes the browser WebSocket. */
  versionUrl: string
}

/** Browser discovery facts needed to open a CDP connection. */
export interface CdpVersion {
  webSocketDebuggerUrl: string
  browser?: string
}

function assertLoopbackUrl(url: URL, protocols: readonly string[], label: string): void {
  if (!protocols.includes(url.protocol)) throw new Error(`${label} must use ${protocols.join(' or ')}`)
  if (!isLoopbackHostname(url.hostname)) throw new Error(`${label} must name a loopback host (localhost, 127/8, or [::1])`)
  if (url.username !== '' || url.password !== '') throw new Error(`${label} must not contain credentials`)
}

/** Parse and normalize the configured HTTP endpoint, failing closed. */
export function parseCdpEndpoint(raw: string): CdpEndpoint {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('cdpEndpoint must be an absolute HTTP URL such as http://127.0.0.1:9222')
  }
  assertLoopbackUrl(url, ['http:'], 'cdpEndpoint')
  if (url.port === '') throw new Error('cdpEndpoint must include an explicit port')
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    throw new Error('cdpEndpoint must be an origin without a path, query, or fragment')
  }
  return { baseUrl: url.origin, versionUrl: new URL('/json/version', url.origin).toString() }
}

/** Validate the WebSocket published by the local discovery document. */
export function parseCdpWebSocketUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('the CDP discovery document returned an invalid webSocketDebuggerUrl')
  }
  assertLoopbackUrl(url, ['ws:', 'wss:'], 'webSocketDebuggerUrl')
  if (url.port === '') throw new Error('webSocketDebuggerUrl must include an explicit port')
  return url.toString()
}

/** Fetch and validate the external browser's discovery document. */
export async function fetchCdpVersion(
  endpoint: CdpEndpoint,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<CdpVersion> {
  const fetchImpl = options.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, options.timeoutMs ?? 5_000)
  try {
    const response = await fetchImpl(endpoint.versionUrl, { signal: controller.signal, redirect: 'error' })
    if (!response.ok) throw new Error(`discovery returned HTTP ${response.status}`)
    const value = await response.json() as { webSocketDebuggerUrl?: unknown; Browser?: unknown; browser?: unknown }
    if (typeof value.webSocketDebuggerUrl !== 'string' || value.webSocketDebuggerUrl === '') {
      throw new Error('discovery did not return webSocketDebuggerUrl')
    }
    const browser = value.Browser ?? value.browser
    return {
      webSocketDebuggerUrl: parseCdpWebSocketUrl(value.webSocketDebuggerUrl),
      ...(typeof browser === 'string' && browser !== '' ? { browser } : {}),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Gather the `code` values an error and its causes carry.
 *
 * A failed `fetch` hides the interesting part in `cause` (undici puts
 * `ECONNREFUSED` there, sometimes inside an `AggregateError.errors`), and a
 * WebSocket failure may only carry the string. Reading both is what keeps the
 * classification honest instead of message-sniffing everything.
 * @param error - whatever the connect path threw.
 * @returns uppercase error codes, outermost first.
 */
function errorCodesOf(error: unknown): string[] {
  const codes: string[] = []
  const seen = new Set<unknown>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    const candidate = value as { code?: unknown; errors?: unknown; cause?: unknown }
    if (typeof candidate.code === 'string' && candidate.code !== '') codes.push(candidate.code.toUpperCase())
    if (Array.isArray(candidate.errors)) {
      for (const nested of candidate.errors) walk(nested, depth + 1)
    }
    if (candidate.cause !== undefined) walk(candidate.cause, depth + 1)
  }
  walk(error, 0)
  return codes
}

/**
 * The message of an error and every cause below it, lowercased.
 * @param error - whatever the connect path threw.
 * @returns one searchable string.
 */
function errorTextOf(error: unknown): string {
  const parts: string[] = []
  const seen = new Set<unknown>()
  const walk = (value: unknown, depth: number): void => {
    if (depth > 6 || value === null || value === undefined || seen.has(value)) return
    if (typeof value === 'string') {
      parts.push(value)
      return
    }
    if (typeof value !== 'object') {
      parts.push(String(value))
      return
    }
    seen.add(value)
    const candidate = value as { message?: unknown; errors?: unknown; cause?: unknown }
    if (typeof candidate.message === 'string') parts.push(candidate.message)
    if (Array.isArray(candidate.errors)) {
      for (const nested of candidate.errors) walk(nested, depth + 1)
    }
    if (candidate.cause !== undefined) walk(candidate.cause, depth + 1)
  }
  walk(error, 0)
  return parts.join(' | ').toLowerCase()
}

/**
 * Classify a browser failure the way the wire contract reports it.
 *
 * Order matters. An OS refusal is checked before the generic socket text
 * because a denied spawn also reports an error; a closed port is checked from
 * the structured `code` before any message pattern, because `fetch failed`
 * alone names no cause at all.
 * @param error - whatever the connect or launch path threw.
 * @returns one of the stable reasons.
 */
export function classifyBrowserFailure(error: unknown): BrowserFailureReason {
  const codes = errorCodesOf(error)
  const text = errorTextOf(error)
  if (codes.includes('ECONNREFUSED') || codes.includes('ECONNRESET') || codes.includes('EHOSTUNREACH') || codes.includes('ENETUNREACH')) {
    return 'econnrefused'
  }
  if (/no chrome binary found/.test(text) || codes.includes('ENOENT')) return 'not_installed'
  if (/crashpad|access is denied|拒绝访问|openprocess|self-terminating|operation not permitted/.test(text)
    || codes.includes('EACCES') || codes.includes('EPERM')) {
    return 'spawn_denied'
  }
  if (codes.includes('ETIMEDOUT') || /timed? ?out|timeout|within \d+ ?ms|did not open its devtools endpoint|handshake/.test(text)) {
    return 'timeout'
  }
  if (/econnrefused|connection refused|connection reset|socket hang up|fetch failed/.test(text)) return 'econnrefused'
  if (/discovery returned http|did not return websocketdebuggerurl|invalid websocketdebuggerurl|unexpected server response|must use ws|must name a loopback|websocketdebuggerurl must include|connect: /.test(text)) {
    return 'not_cdp'
  }
  return 'unknown'
}

/**
 * The one-line advice that belongs with a reason.
 *
 * Every line names the action the person can take in the panel first, because
 * that is where the failure is shown; the manual browser launch is the second
 * option, not the requirement. "No silent fallback" still holds: the isolated
 * browser only opens when the person clicks it or the agent explicitly calls
 * `webdev_open_isolated`. An ordinary tool call never switches the source.
 * @param reason - classified failure.
 * @returns one sentence, no trailing period required by callers.
 */
export function remediationFor(reason: BrowserFailureReason): string {
  switch (reason) {
    case 'econnrefused':
      return 'Start Chrome/Edge with --remote-debugging-port and a dedicated --user-data-dir, then press Reconnect; or click Open in isolated Chromium in the panel to render the page without starting a separate browser window.'
    case 'not_cdp':
      return 'Another program answers on that port. Point cdpEndpoint at a browser DevTools port, or open the isolated Chromium from the panel.'
    case 'spawn_denied':
      return 'The OS refused the browser process (crashpad or an ACL). Widen the host process permissions and retry, or open the isolated Chromium from the panel.'
    case 'not_installed':
      return 'No Chrome or Edge binary was found. Set CHROME_PATH or install a browser, then press Reconnect.'
    case 'timeout':
      return 'The endpoint accepted a connection but never finished the DevTools handshake. Restart that browser, or open the isolated Chromium from the panel.'
    case 'unknown':
      return 'Press Reconnect, or open the isolated Chromium from the panel if the real browser cannot be reached.'
  }
}

/** A failed real-browser attach, carrying everything a caller can act on. */
export class RealBrowserUnavailableError extends Error {
  /** Stable machine code from the wire contract. */
  readonly code = REAL_BROWSER_UNAVAILABLE_CODE
  /** Classified cause. */
  readonly reason: BrowserFailureReason
  /** Loopback endpoint the attach targeted, normalized. */
  readonly endpoint: string
  /** One-line advice, mirrored from the classification. */
  readonly remediation: string
  /** Sentence for the panel and the state route, without the tool-facing JSON. */
  readonly panelMessage: string

  /**
   * @param endpoint - normalized loopback origin.
   * @param reason - classified cause.
   * @param remediation - advice for the reader.
   * @param options - standard `cause` chaining for the underlying failure.
   */
  constructor(endpoint: string, reason: BrowserFailureReason, remediation: string, options?: ErrorOptions) {
    // The JSON line is deliberate. A tool failure reaches the model as text, so
    // the fields ride the text: `code`, `endpoint`, `reason`, `remediation` and
    // the `nextStep` tool name stay machine-readable without the model parsing
    // prose. No silent fallback is attempted; the sentence says so, and it names
    // the explicit call that does switch the source.
    super(
      `${REAL_BROWSER_UNAVAILABLE_CODE}: could not reach the real browser at ${endpoint} (${reason}). `
        + `${remediation} No isolated-browser fallback was attempted. `
        + 'To switch explicitly, call webdev_open_isolated with the URL you were opening; '
        + 'the panel status row will show the changed carrier. '
        + JSON.stringify({
          code: REAL_BROWSER_UNAVAILABLE_CODE,
          endpoint,
          reason,
          remediation,
          nextStep: 'webdev_open_isolated',
        }),
      options,
    )
    this.name = 'RealBrowserUnavailableError'
    this.reason = reason
    this.endpoint = endpoint
    this.remediation = remediation
    this.panelMessage = `Could not reach the real browser at ${endpoint} (${reason}).`
  }
}

/**
 * Wrap a failed real-browser attach into the classified failure the panel and
 * the tools report.
 * @param endpoint - the endpoint that was tried.
 * @param error - the underlying failure, kept as `cause`.
 * @returns the classified error.
 */
export function realBrowserUnavailable(endpoint: CdpEndpoint, error: unknown): RealBrowserUnavailableError {
  const reason = classifyBrowserFailure(error)
  return new RealBrowserUnavailableError(endpoint.baseUrl, reason, remediationFor(reason), { cause: error })
}

/**
 * Whether the endpoint's discovery document answers right now.
 *
 * Bounded on purpose: this runs every liveness period, so a wedged endpoint
 * must cost one short timeout, not the discovery default.
 * @param endpoint - loopback endpoint to probe.
 * @param options - timeout and fetch seams.
 * @returns true when `/json/version` answers with a usable document.
 */
export async function probeCdpEndpoint(
  endpoint: CdpEndpoint,
  options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<boolean> {
  try {
    await fetchCdpVersion(endpoint, {
      timeoutMs: options.timeoutMs ?? 1_000,
      ...options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl },
    })
    return true
  } catch {
    // Any failure means the endpoint is not usable as a browser right now.
    return false
  }
}

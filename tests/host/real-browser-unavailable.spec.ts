// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * The unavailable-real-browser path (B1): what the panel is told, what a tool
 * call returns, and how a person gets back to a working page without starting a
 * second browser window by hand.
 *
 * Three properties are under test:
 *
 * 1. A connect failure is classified once, in the host, into a stable code,
 *    reason, endpoint and remediation; a tool failure carries them as JSON.
 * 2. A blank panel is always explainable from the state route (lastError,
 *    attempts), and "Open in isolated Chromium" is the only way the source
 *    changes — it is user-initiated and its mode is visible.
 * 3. A real browser closed behind a mounted panel becomes a visible disconnect
 *    within one liveness check, and comes back by itself when the port answers.
 */

import { createServer, type Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { pickFreePort } from '../../src/core/chrome.ts'
import { TabManager } from '../../src/core/tabs.ts'
import type { BrowserViewEvent, BrowserPanelState } from '../../src/core/protocol.ts'
import { remediationFor, RealBrowserUnavailableError } from '../../src/host/cdp-endpoint.ts'
import {
  BrowserViewService,
  openExternalSession,
  type BrowserMode,
  type BrowserSession,
  type BrowserViewSink,
  type OpenSessionOptions,
} from '../../src/host/service.ts'
import { createFakeBrowser } from '../helpers/fake-browser.ts'
import { FakeTransport } from '../helpers/fake-cdp.ts'

/** One page the scripted real browser has open. */
interface PageTarget {
  targetId: string
  type: string
  url: string
  title: string
}

/** The options every session factory in this file receives. */
function sessionOptions(mode: BrowserMode, endpoint?: string): OpenSessionOptions {
  return {
    mode,
    ...endpoint === undefined ? {} : { cdpEndpoint: endpoint },
    jpegQuality: 80,
    viewport: { width: 1280, height: 800 },
    onFrame: () => undefined,
    onTabsChanged: () => undefined,
  }
}

/** A session over a scripted transport; the same shape the production factories return. */
async function scriptedSession(
  options: OpenSessionOptions,
  pages: PageTarget[] = [],
): Promise<BrowserSession> {
  const transport = new FakeTransport()
  let created = 0
  transport.responses.set('Target.createTarget', () => ({ targetId: `tab-${++created}` }))
  transport.responses.set('Target.attachToTarget', (params: Record<string, unknown>) => ({ sessionId: `cdp-${String(params.targetId)}` }))
  transport.responses.set('Target.getTargets', { targetInfos: pages })
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
  transport.responses.set('Page.getLayoutMetrics', { cssLayoutViewport: { clientWidth: 1440, clientHeight: 900 } })
  transport.onSend = call => {
    // A real navigation settles instead of waiting out the manager's grace period.
    if (call.method === 'Page.navigate') {
      if (typeof call.params.url === 'string') {
        transport.emit('Page.frameNavigated', { frame: { url: call.params.url } }, call.sessionId)
      }
      transport.emit('Page.loadEventFired', {}, call.sessionId)
    }
  }
  const real = options.mode === 'cdp'
  const tabs = new TabManager({
    transport,
    jpegQuality: options.jpegQuality,
    viewport: options.viewport,
    pinViewport: !real,
    discoverTargets: real,
    onFrame: options.onFrame,
    onTabsChanged: options.onTabsChanged,
  })
  if (real) await tabs.discoverExistingTabs()
  return {
    mode: options.mode,
    transport,
    tabs,
    async dispose() {
      await tabs.dispose()
      transport.close()
    },
  }
}

/** A sink that records every event it is handed. */
function recordingSink(): { sink: BrowserViewSink; events: BrowserViewEvent[] } {
  const events: BrowserViewEvent[] = []
  return { events, sink: { send: event => { events.push(event) }, close: () => undefined } }
}

/** The last state one panel received. */
function lastStateOf(events: BrowserViewEvent[]): BrowserPanelState | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event !== undefined && (event.kind === 'state' || event.kind === 'hello')) return event.state
  }
  return undefined
}

const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>(resolve => { server.close(() => { resolve() }) })
  }
})

describe('classifying an unreachable real browser', () => {
  it('operator points the viewer at a closed port and the attach reports econnrefused with fields', async () => {
    // Given a loopback port with nothing behind it
    const port = await pickFreePort()
    // When the real-browser factory attaches
    const failure = await openExternalSession(sessionOptions('cdp', `http://127.0.0.1:${port}`)).catch((error: unknown) => error)
    // Then the failure is the stable code, the endpoint, the reason and the remedy, not a raw `fetch failed`
    expect(failure).toMatchObject({
      name: 'RealBrowserUnavailableError',
      code: 'webdev.real_browser_unavailable',
      endpoint: `http://127.0.0.1:${port}`,
      reason: 'econnrefused',
    })
    const message = failure instanceof Error ? failure.message : ''
    expect(message).toContain('No isolated-browser fallback was attempted')
    expect(JSON.parse(message.slice(message.lastIndexOf('{')))).toMatchObject({
      code: 'webdev.real_browser_unavailable',
      endpoint: `http://127.0.0.1:${port}`,
      reason: 'econnrefused',
    })
  })

  it('operator points the viewer at a web server and the attach reports not_cdp', async () => {
    // Given a loopback HTTP server that is not a DevTools endpoint
    const server = createServer((_request, response) => { response.writeHead(404).end('not a devtools endpoint') })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('the fake server got no port')

    // When the real-browser factory attaches
    const failure = await openExternalSession(sessionOptions('cdp', `http://127.0.0.1:${address.port}`)).catch((error: unknown) => error)

    // Then the cause is classified instead of being blamed on a missing browser
    expect(failure).toMatchObject({ reason: 'not_cdp' })
    expect(failure instanceof Error ? failure.message : '').toContain(remediationFor('not_cdp'))
  })
})

describe('the state a blank panel can explain', () => {
  it('operator has no browser behind the endpoint and the state route carries the failure and the attempt count', async () => {
    // Given a service whose real-browser factory always fails the same way
    const service = new BrowserViewService({
      now: () => 1_700_000_000_000,
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      openSession: async () => {
        throw new RealBrowserUnavailableError('http://127.0.0.1:9222', 'econnrefused', remediationFor('econnrefused'))
      },
    })

    // When a tool asks for tabs
    await expect(service.listTabs()).rejects.toThrow(/webdev\.real_browser_unavailable/)

    // Then the state an external reader polls says why the tab is empty
    const state = service.state()
    expect(state).toMatchObject({
      mode: 'cdp',
      cdpEndpoint: 'http://127.0.0.1:9222',
      running: false,
      attempts: 1,
      lastError: {
        code: 'webdev.real_browser_unavailable',
        at: 1_700_000_000_000,
        reason: 'econnrefused',
        mode: 'cdp',
        endpoint: 'http://127.0.0.1:9222',
      },
    })
    expect(state.lastError?.message).toBe('Could not reach the real browser at http://127.0.0.1:9222 (econnrefused).')
    expect(state.lastError?.remediation).toBe(remediationFor('econnrefused'))
  })

  it('operator opens the panel while nothing answers and the panel receives the classified failure in a state push', async () => {
    // Given a cdp-configured service whose factory reports the classified error
    let opens = 0
    const service = new BrowserViewService({
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      openSession: async () => {
        opens += 1
        throw new RealBrowserUnavailableError('http://127.0.0.1:9222', 'econnrefused', remediationFor('econnrefused'))
      },
    })
    const panel = recordingSink()

    // When the panel attaches and the host tries to connect
    service.attach(panel.sink)
    await vi.waitFor(() => {
      expect(lastStateOf(panel.events)?.lastError?.reason).toBe('econnrefused')
    })

    // Then the classified identity reached the panel, not just a prose error event
    expect(opens).toBeGreaterThanOrEqual(1)
    expect(lastStateOf(panel.events)).toMatchObject({
      mode: 'cdp',
      running: false,
      attempts: 1,
      lastError: {
        code: 'webdev.real_browser_unavailable',
        reason: 'econnrefused',
        endpoint: 'http://127.0.0.1:9222',
      },
      isolatedAvailable: expect.any(Boolean),
    })
    expect(panel.events.some(event => event.kind === 'error' && event.code === 'browser-connect-failed')).toBe(true)
  })
})

describe('recovering without an agent turn', () => {
  it('operator presses Retry after the browser starts and the same mode reconnects', async () => {
    // Given a real-browser service that fails once and then works
    let failing = true
    const service = new BrowserViewService({
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      openSession: async options => {
        if (failing) throw new Error('connection refused')
        return await scriptedSession(options, [{ targetId: 'page-a', type: 'page', url: 'https://a.test/', title: 'A' }])
      },
    })
    const panel = recordingSink()
    await expect(service.listTabs()).rejects.toThrow('connection refused')
    failing = false
    service.attach(panel.sink)

    // When the panel sends reconnect
    await service.handleCommand(panel.sink, { v: 1, kind: 'reconnect' })

    // Then the real browser is attached, the failure is gone and the mode did not change
    expect(service.state()).toMatchObject({ mode: 'cdp', running: true, tabs: [{ id: 'page-a' }] })
    expect(service.state().lastError).toBeUndefined()
    expect(service.state().attempts).toBeUndefined()
    expect(lastStateOf(panel.events)?.mode).toBe('cdp')
  })

  it('operator clicks Open in isolated Chromium and the page is restored in the in-panel browser', async () => {
    // Given a configured real browser that cannot be reached
    const opens: BrowserMode[] = []
    const service = new BrowserViewService({
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      openSession: async options => {
        opens.push(options.mode)
        if (options.mode === 'cdp') throw new Error('connection refused')
        return await scriptedSession(options)
      },
    })
    const panel = recordingSink()
    service.attach(panel.sink)
    await vi.waitFor(() => { expect(service.state().attempts).toBe(1) })

    // When a person explicitly opens the isolated Chromium with the page they saw
    await service.handleCommand(panel.sink, { v: 1, kind: 'open-isolated', url: 'https://a.test/restore' })

    // Then the explicit isolated browser serves it, the mode change is on the wire, and the failure is cleared
    const state = service.state()
    expect(opens).toEqual(['cdp', 'isolated'])
    expect(state.mode).toBe('isolated')
    expect(state.realBrowserConfigured).toBe(true)
    expect(state.running).toBe(true)
    expect(state.lastError).toBeUndefined()
    expect(state.tabs.some(tab => tab.url === 'https://a.test/restore')).toBe(true)
    expect(lastStateOf(panel.events)?.mode).toBe('isolated')

    // And the way back to the configured source exists and reports the real failure again
    await service.handleCommand(panel.sink, { v: 1, kind: 'use-configured' })
    expect(service.state()).toMatchObject({
      mode: 'cdp',
      running: false,
      lastError: { code: 'browser-connect-failed', reason: 'econnrefused', endpoint: 'http://127.0.0.1:9222' },
    })
    expect(service.state().realBrowserConfigured).toBeUndefined()
  })
})

describe('liveness', () => {
  it('operator closes the browser and the panel is told it disconnected within one check', async () => {
    // Given an attached panel on a live real browser
    let alive = true
    const service = new BrowserViewService({
      now: () => 99,
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      livenessProbe: async () => alive,
      openSession: async options => await scriptedSession(options, [
        { targetId: 'page-a', type: 'page', url: 'https://a.test/', title: 'A' },
      ]),
    })
    const panel = recordingSink()
    service.attach(panel.sink)
    await vi.waitFor(() => { expect(service.state().running).toBe(true) })

    // When the browser stops answering and one liveness check runs
    alive = false
    await service.checkLiveness()

    // Then the session is detached (not closed), the state says why, and the panel can offer Reconnect
    expect(service.state()).toMatchObject({
      mode: 'cdp',
      running: false,
      tabs: [],
      attempts: 1,
      lastError: {
        code: 'webdev.real_browser_disconnected',
        reason: 'econnrefused',
        at: 99,
        endpoint: 'http://127.0.0.1:9222',
      },
    })
    expect(lastStateOf(panel.events)?.lastError?.code).toBe('webdev.real_browser_disconnected')
    expect(panel.events.some(event => event.kind === 'error' && event.code === 'browser-disconnected')).toBe(true)
  })

  it('operator restarts the browser and the next check attaches again without a click', async () => {
    // Given a panel showing a documented disconnect
    let alive = false
    const service = new BrowserViewService({
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      livenessProbe: async () => alive,
      openSession: async options => {
        if (!alive) throw new RealBrowserUnavailableError('http://127.0.0.1:9222', 'econnrefused', remediationFor('econnrefused'))
        return await scriptedSession(options, [
          { targetId: 'page-a', type: 'page', url: 'https://a.test/', title: 'A' },
        ])
      },
    })
    const panel = recordingSink()
    service.attach(panel.sink)
    await vi.waitFor(() => { expect(service.state().lastError?.code).toBe('webdev.real_browser_unavailable') })

    // When the endpoint answers again and one check runs
    alive = true
    await service.checkLiveness()

    // Then the viewer attached on its own, with no mode change and no leftover failure
    expect(service.state()).toMatchObject({ mode: 'cdp', running: true, tabs: [{ id: 'page-a' }] })
    expect(service.state().lastError).toBeUndefined()
    expect(service.state().attempts).toBeUndefined()
  })

  it('operator misses one probe on a busy browser and the session survives the recheck', async () => {
    // Given a live session whose first probe fails and whose recheck answers
    const answers = [false, true]
    let probes = 0
    const service = new BrowserViewService({
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      livenessProbe: async () => {
        probes += 1
        return answers.shift() ?? true
      },
      openSession: async options => await scriptedSession(options, [
        { targetId: 'page-a', type: 'page', url: 'https://a.test/', title: 'A' },
      ]),
    })
    service.attach(recordingSink().sink)
    await vi.waitFor(() => { expect(service.state().running).toBe(true) })

    // When one liveness check runs
    await service.checkLiveness()

    // Then the browser is still attached after the confirming probe
    expect(probes).toBe(2)
    expect(service.state()).toMatchObject({ running: true })
  })

  it('operator has no panel open and the liveness check never probes a port', async () => {
    // Given a service with no attached panel
    let probes = 0
    const service = new BrowserViewService({
      resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' }),
      livenessProbe: async () => { probes += 1; return true },
      openSession: async options => await scriptedSession(options),
    })

    // When a liveness check runs
    await service.checkLiveness()

    // Then nothing is polled: a host nobody is watching costs no probe
    expect(probes).toBe(0)
  })
})

describe('desktop tools after the panel goes away', () => {
  it('operator reloads the page and webdev_desktop_* fails immediately instead of waiting 30s', async () => {
    // Given a panel that claimed the desktop guest and then disconnected
    const browser = createFakeBrowser()
    const panel = recordingSink()
    const detach = browser.service.attach(panel.sink)
    await browser.service.ensureTab('session-a')
    await browser.service.handleCommand(panel.sink, { v: 1, kind: 'native-attach', sessionId: 'session-a' })
    detach()

    // When a desktop tool runs
    const started = Date.now()
    const error = await browser.service.nativeSnapshot().catch((failure: unknown) => failure)

    // Then it names the missing panel right away, with a stable code
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/webdev\.panel_not_mounted/)
    expect(Date.now() - started).toBeLessThan(1_000)
  })
})

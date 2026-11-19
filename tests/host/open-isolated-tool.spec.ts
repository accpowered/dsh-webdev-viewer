// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * The agent's side of the isolated-browser recovery: `webdev_open_isolated`.
 *
 * B1 made "Open in isolated Chromium" work for a person, but a tool call that
 * failed with `webdev.real_browser_unavailable` left the agent with no way to
 * ask for the same switch, so an unattended run could not recover at all. Five
 * properties are under test here:
 *
 * 1. After a classified real-browser failure, one explicit tool call switches
 *    the source and the very next tool call drives the new browser — self-heal
 *    inside one turn, with no human click.
 * 2. The page the agent names is opened in the browser that was just launched.
 * 3. A second call while the isolated Chromium is already the source keeps the
 *    live browser and its tabs instead of relaunching them.
 * 4. A host with no browser binary fails with
 *    `webdev.isolated_browser_unavailable` / `not_installed` instead of hanging.
 * 5. No ordinary tool ever changes the source (AGENTS.md: the fallback must be
 *    requested explicitly, never chosen by a tool on its own).
 */

import { describe, expect, it } from 'vitest'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { BrowserViewEvent, BrowserPanelState } from '../../src/core/protocol.ts'
import { TabManager } from '../../src/core/tabs.ts'
import { RealBrowserUnavailableError, remediationFor } from '../../src/host/cdp-endpoint.ts'
import {
  BrowserViewService,
  type BrowserMode,
  type BrowserSession,
  type BrowserViewSink,
  type OpenSessionOptions,
} from '../../src/host/service.ts'
import { createBrowserTools } from '../../src/host/tools.ts'
import { FakeTransport } from '../helpers/fake-cdp.ts'

/** The declared canonical-value type, read off the tool contract itself. */
type Json = Parameters<ToolDefinition['output']['render']>[1]

/** A structurally valid result narrowed to the validator's input type. */
function asJson(value: unknown): Json {
  return value as Json
}

/** One execution context carrying an optional calling session. */
function fakeExec(sessionId?: string): ToolRunContext {
  return {
    callId: 'call-1',
    rootCallId: 'call-1',
    token: Symbol('token'),
    name: 'webdev_test',
    arguments: {},
    signal: new AbortController().signal,
    agent: sessionId === undefined ? undefined : { session: { id: sessionId } },
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as unknown as ToolRunContext
}

/**
 * A session over a scripted transport, as the production factories return it.
 *
 * Target ids carry the session index so a test can prove a later call landed in
 * a *new* browser rather than in the one it was already talking to.
 * @param options - the options the service handed the factory.
 * @param index - which session this is, in open order.
 * @returns the session.
 */
function scriptedSession(options: OpenSessionOptions, index: number): BrowserSession {
  const transport = new FakeTransport()
  let created = 0
  transport.responses.set('Target.createTarget', () => ({ targetId: `tab-${index}-${++created}` }))
  transport.responses.set('Target.attachToTarget', (params: Record<string, unknown>) => ({
    sessionId: `cdp-${index}-${String(params.targetId)}`,
  }))
  transport.responses.set('Target.getTargets', { targetInfos: [] })
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
  transport.responses.set('Page.getLayoutMetrics', { cssLayoutViewport: { clientWidth: 1440, clientHeight: 900 } })
  transport.responses.set('Runtime.evaluate', {
    result: { value: { url: 'https://a.test/', title: 'A', nodes: [{ tag: 'body', depth: 0, selector: 'body' }], truncated: false } },
  })
  transport.onSend = call => {
    // A real navigation settles instead of waiting out the manager's grace period.
    if (call.method === 'Page.navigate') {
      if (typeof call.params.url === 'string') {
        transport.emit('Page.frameNavigated', { frame: { url: call.params.url } }, call.sessionId)
      }
      transport.emit('Page.loadEventFired', {}, call.sessionId)
    }
  }
  const tabs = new TabManager({
    transport,
    jpegQuality: options.jpegQuality,
    viewport: options.viewport,
    pinViewport: options.mode !== 'cdp',
    discoverTargets: options.mode === 'cdp',
    onFrame: options.onFrame,
    onTabsChanged: options.onTabsChanged,
    onPagePick: options.onPagePick,
  })
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

/** What one harnessed service exposes to a test. */
interface Harness {
  service: BrowserViewService
  /** The modes the session factory was asked for, in call order. */
  opens: BrowserMode[]
  /** Transports of the isolated sessions that were actually created. */
  isolated: FakeTransport[]
  byName: (name: string) => ToolDefinition
}

/** A sink that records every event it is handed. */
function recordingSink(): { sink: BrowserViewSink; events: BrowserViewEvent[] } {
  const events: BrowserViewEvent[] = []
  return { events, sink: { send: event => { events.push(event) }, close: () => undefined } }
}

/**
 * Build the real service and the real tool surface over the scripted bridge.
 *
 * The configured source is the real browser unless a test says otherwise, and
 * that source always fails the way an unstarted Chrome does. That is the state
 * the issue reproduced: a profile with `realBrowserEnabled: true` and nothing
 * listening on the endpoint.
 * @param options - configured source and an optional isolated launch failure.
 * @returns the service, its recorders, and the tools.
 */
function build(options: { configured?: BrowserMode; failIsolated?: Error } = {}): Harness {
  const opens: BrowserMode[] = []
  const isolated: FakeTransport[] = []
  const configured: BrowserMode = options.configured ?? 'cdp'
  const service = new BrowserViewService({
    now: () => 1_700_000_000_000,
    resolveConfig: () => configured === 'isolated'
      ? { mode: 'isolated' }
      : { mode: 'cdp', cdpEndpoint: 'http://127.0.0.1:9222' },
    openSession: async sessionOptions => {
      opens.push(sessionOptions.mode)
      if (sessionOptions.mode === 'cdp') {
        throw new RealBrowserUnavailableError('http://127.0.0.1:9222', 'econnrefused', remediationFor('econnrefused'))
      }
      if (options.failIsolated !== undefined) throw options.failIsolated
      const session = scriptedSession(sessionOptions, opens.length)
      isolated.push(session.transport as FakeTransport)
      return session
    },
  })
  const tools = createBrowserTools({ service })
  const byName = (name: string): ToolDefinition => {
    const found = tools.find(tool => tool.name === name)
    if (found === undefined) throw new Error(`missing tool ${name}`)
    return found
  }
  return { service, opens, isolated, byName }
}

/** The JSON line a classified tool failure embeds last in its message. */
function embeddedJson(message: string): Record<string, unknown> {
  return JSON.parse(message.slice(message.lastIndexOf('{'))) as Record<string, unknown>
}

describe('recovering from an unreachable real browser through the tool surface', () => {
  it('agent calls webdev_open_isolated after the failure and the next tool call drives the new browser', async () => {
    // Given a configured real browser that nothing is listening on
    const { service, opens, isolated, byName } = build()

    // When the agent tries to open its page
    const failure = await byName('webdev_navigate')
      .execute({ url: 'http://127.0.0.1:5173/' }, fakeExec('session-a'))
      .catch((error: unknown) => error)

    // Then the failure names the explicit next step, both in prose and as a field
    expect(failure).toBeInstanceOf(Error)
    const message = failure instanceof Error ? failure.message : ''
    expect(message).toMatch(/webdev\.real_browser_unavailable/)
    expect(message).toContain('webdev_open_isolated')
    expect(embeddedJson(message)).toMatchObject({
      code: 'webdev.real_browser_unavailable',
      reason: 'econnrefused',
      nextStep: 'webdev_open_isolated',
    })
    expect(service.state().mode).toBe('cdp')

    // When the agent asks for the isolated browser with the page it was opening
    const switched = await byName('webdev_open_isolated')
      .execute({ url: 'http://127.0.0.1:5173/' }, fakeExec('session-a')) as {
        mode: string
        switched: boolean
        url?: string
        tabs: Array<{ id: string; url: string }>
        activeTabId: string | null
      }

    // Then the report says the carrier changed, and the state agrees with it
    expect(switched.mode).toBe('isolated')
    expect(switched.switched).toBe(true)
    expect(switched.url).toBe('http://127.0.0.1:5173/')
    expect(switched.tabs.some(tab => tab.url === 'http://127.0.0.1:5173/')).toBe(true)
    expect(switched.activeTabId).not.toBeNull()
    expect(service.state()).toMatchObject({ mode: 'isolated', running: true, realBrowserConfigured: true })
    expect(opens).toEqual(['cdp', 'isolated'])
    expect(isolated).toHaveLength(1)

    // And the same turn continues on the new browser, with no second attempt at the dead endpoint
    const navigated = await byName('webdev_navigate')
      .execute({ url: 'http://127.0.0.1:5173/next' }, fakeExec('session-a')) as { tabId: string; url: string }
    expect(navigated.url).toBe('http://127.0.0.1:5173/next')
    expect(isolated[0]?.lastCall('Page.navigate')?.params.url).toBe('http://127.0.0.1:5173/next')
    const snapshot = await byName('webdev_snapshot').execute({}, fakeExec('session-a')) as {
      tabId: string
      nodes: Array<{ tag: string }>
    }
    expect(snapshot.tabId).toBe(navigated.tabId)
    expect(snapshot.nodes.map(node => node.tag)).toEqual(['body'])
    expect(opens).toEqual(['cdp', 'isolated'])
  })

  it('agent names a page and the launched browser really opens it', async () => {
    // Given a configured real browser that cannot be reached
    const { isolated, byName } = build()

    // When the agent switches with a URL
    const result = await byName('webdev_open_isolated')
      .execute({ url: 'https://a.test/restore' }, fakeExec()) as { tabs: Array<{ url: string }> }

    // Then the isolated transport was the one that navigated, to exactly that URL
    expect(isolated[0]?.callsOf('Page.navigate').map(call => call.params.url)).toContain('https://a.test/restore')
    expect(isolated[0]?.lastCall('Page.navigate')?.params.url).toBe('https://a.test/restore')
    expect(result.tabs.map(tab => tab.url)).toEqual(['https://a.test/restore'])
  })
})

describe('calling webdev_open_isolated when the isolated browser is already the source', () => {
  it('agent calls it again and the live browser and its tabs are kept', async () => {
    // Given a default isolated profile that already opened a page
    const { service, opens, isolated, byName } = build({ configured: 'isolated' })
    const first = await byName('webdev_navigate')
      .execute({ url: 'https://a.test/' }, fakeExec('session-a')) as { tabId: string }
    const panel = recordingSink()
    service.attach(panel.sink)
    const eventsBefore = panel.events.length

    // When the agent asks for the isolated browser twice
    const once = await byName('webdev_open_isolated').execute({}, fakeExec('session-a')) as {
      switched: boolean
      tabs: Array<{ id: string }>
      activeTabId: string | null
    }
    const twice = await byName('webdev_open_isolated').execute({}, fakeExec('session-a')) as {
      switched: boolean
      tabs: Array<{ id: string }>
    }

    // Then neither call relaunched, replaced a tab, or pushed a redundant state frame
    expect(once.switched).toBe(false)
    expect(twice.switched).toBe(false)
    expect(opens).toEqual(['isolated'])
    expect(isolated).toHaveLength(1)
    expect(twice.tabs.map(tab => tab.id)).toEqual([first.tabId])
    expect(once.activeTabId).toBe(first.tabId)
    expect(panel.events.slice(eventsBefore).filter(event => event.kind === 'state')).toEqual([])
    expect(service.state()).toMatchObject({ mode: 'isolated', running: true })
  })
})

describe('the isolated browser cannot start', () => {
  it('agent calls webdev_open_isolated on a host with no browser binary and the call fails with not_installed', async () => {
    // Given a host whose isolated launch reports a missing binary
    const { service, opens, byName } = build({
      failIsolated: new Error('No Chrome binary found; set CHROME_PATH or install Chrome or Edge'),
    })

    // When the agent asks for the isolated browser
    const started = Date.now()
    const failure = await byName('webdev_open_isolated')
      .execute({ url: 'https://a.test/' }, fakeExec())
      .catch((error: unknown) => error)
    const elapsed = Date.now() - started

    // Then the call fails fast with the classified code and reason in the text
    expect(failure).toBeInstanceOf(Error)
    const message = failure instanceof Error ? failure.message : ''
    expect(message).toMatch(/webdev\.isolated_browser_unavailable/)
    expect(message).toContain('not_installed')
    expect(embeddedJson(message)).toMatchObject({
      code: 'webdev.isolated_browser_unavailable',
      reason: 'not_installed',
    })
    expect(elapsed).toBeLessThan(5_000)
    // A known-missing binary is a permanent failure, so it is not retried
    expect(opens).toEqual(['isolated'])

    // And the failure is the one the panel shows, not a silent success
    const state: BrowserPanelState = service.state()
    expect(state.running).toBe(false)
    expect(state.lastError).toMatchObject({
      code: 'webdev.isolated_browser_unavailable',
      reason: 'not_installed',
      mode: 'isolated',
    })
  })
})

describe('the fallback stays explicit', () => {
  it('agent calls ordinary tools while the real browser is unreachable and the source never changes', async () => {
    // Given a configured real browser that nothing is listening on
    const { service, opens, byName } = build()

    // When ordinary tools run
    await expect(byName('webdev_tabs').execute({}, fakeExec('session-a'))).rejects.toThrow(/webdev\.real_browser_unavailable/)
    await expect(byName('webdev_snapshot').execute({}, fakeExec('session-a'))).rejects.toThrow(/webdev\.real_browser_unavailable/)
    await expect(byName('webdev_screenshot').execute({}, fakeExec('session-a'))).rejects.toThrow(/real_browser_unavailable|attachment service/)

    // Then every attempt stayed on the configured source (AGENTS.md: never silently fall back)
    expect(service.state().mode).toBe('cdp')
    expect(service.state().realBrowserConfigured).toBeUndefined()
    expect(opens.every(mode => mode === 'cdp')).toBe(true)
  })

  it('agent reads the declared parameters and the result validates against its own schema', async () => {
    // Given the webdev_open_isolated tool over a failing real browser
    const { byName } = build()
    const tool = byName('webdev_open_isolated')

    // When its declared surface is read
    // Then the URL is optional, the schema is inside the enforced subset and the description names the recovery it performs
    const parameters = tool.parameters as {
      properties: Record<string, { type?: string }>
      required?: string[]
    }
    expect(parameters.properties.url?.type).toBe('string')
    expect(parameters.required ?? []).toEqual([])
    expect(() => assertSupportedJsonSchema(tool.output.schema)).not.toThrow()
    expect(tool.description).toContain('webdev.real_browser_unavailable')
    expect(tool.description).toContain('webdev.isolated_browser_unavailable')

    const value = await tool.execute({ url: 'https://a.test/' }, fakeExec())
    expect(validateJsonSchemaValue(tool.output.schema, asJson(value))).toEqual([])
  })
})

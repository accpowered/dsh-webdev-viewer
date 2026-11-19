// Modified for dsh-webdev-viewer from @linxin666/dsh-client-ui-browser-view 0.4.19 (Apache-2.0). See NOTICE.
import { describe, expect, it } from 'vitest'
import { Config, effectiveConfig } from '../../src/host/config.ts'
import {
  classifyBrowserFailure,
  fetchCdpVersion,
  parseCdpEndpoint,
  parseCdpWebSocketUrl,
  realBrowserUnavailable,
  remediationFor,
} from '../../src/host/cdp-endpoint.ts'

describe('real-browser configuration', () => {
  it('operator keeps the isolated browser as the default and supplies the local CDP default', () => {
    // Given no webdev profile overrides
    // When the configuration schema resolves its defaults
    // Then real-browser mode is off, the endpoint is loopback, and pages idle out after three days
    expect(effectiveConfig(Config({}))).toEqual({
      realBrowserEnabled: false,
      cdpEndpoint: 'http://127.0.0.1:9222',
      idleCloseDays: 3,
    })
  })

  it('operator edits the idle window and the live reference reports the new value', () => {
    // Given a profile that closes idle pages after seven days
    // When the configuration resolves
    // Then the resolved window is seven, not the schema default
    expect(effectiveConfig(Config({ idleCloseDays: 7 })).idleCloseDays).toBe(7)
  })
})

describe('loopback CDP endpoints', () => {
  it.each([
    'http://127.0.0.1:9222',
    'http://localhost:9222/',
    'http://[::1]:9222',
    'http://127.1.2.3:9222',
  ])('operator accepts loopback endpoint %s', raw => {
    // Given an explicitly configured loopback HTTP origin
    // When the endpoint is parsed
    // Then its discovery document is the local /json/version URL
    expect(parseCdpEndpoint(raw).versionUrl).toContain('/json/version')
  })

  it.each([
    '',
    'localhost:9222',
    'https://127.0.0.1:9222',
    'http://0.0.0.0:9222',
    'http://10.0.0.5:9222',
    'http://example.com:9222',
    'http://127.0.0.1.evil.com:9222',
    'http://user:pw@127.0.0.1:9222',
    'http://127.0.0.1:9222/path',
    'http://127.0.0.1',
  ])('operator rejects invalid or remote endpoint %s', raw => {
    // Given a malformed, credentialed, portless, or non-loopback endpoint
    // When the endpoint is parsed
    // Then validation fails closed
    expect(() => parseCdpEndpoint(raw)).toThrow()
  })

  it('operator rejects a remote WebSocket published by a local discovery response', () => {
    // Given discovery data whose WebSocket authority is not loopback
    // When the browser WebSocket is validated
    // Then it is refused even though discovery itself was local
    expect(() => parseCdpWebSocketUrl('ws://192.168.1.20:9222/devtools/browser/id')).toThrow(/loopback/)
    expect(parseCdpWebSocketUrl('ws://127.0.0.1:9222/devtools/browser/id')).toContain('/devtools/browser/id')
  })

  it('operator validates discovery JSON and returns its loopback WebSocket', async () => {
    // Given a discovery endpoint and scripted valid and hostile responses
    // When each response is read
    // Then the valid browser is returned and the hostile WebSocket is rejected
    const endpoint = parseCdpEndpoint('http://127.0.0.1:9222')
    const version = await fetchCdpVersion(endpoint, {
      fetchImpl: async () => new Response(JSON.stringify({
        Browser: 'Chrome/140.0.0.0',
        webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/id',
      }), { status: 200 }),
    })
    expect(version).toEqual({ browser: 'Chrome/140.0.0.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/id' })
    await expect(fetchCdpVersion(endpoint, {
      fetchImpl: async () => new Response(JSON.stringify({ webSocketDebuggerUrl: 'ws://example.com:9222/devtools/browser/id' }), { status: 200 }),
    })).rejects.toThrow(/loopback/)
  })

  it('operator gets a classified, machine-readable failure instead of a raw fetch error', () => {
    // Given a failed external-browser connection whose cause is a refused port
    // When its operator-facing error is constructed
    // Then it names the stable code, the endpoint, the reason, the remediation and
    // the explicit next step, and the same fields ride the message as JSON for the agent
    const endpoint = parseCdpEndpoint('http://127.0.0.1:9222')
    const refused = Object.assign(new TypeError('fetch failed'), {
      cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9222'), { code: 'ECONNREFUSED' }),
    })
    const failure = realBrowserUnavailable(endpoint, refused)
    expect(failure).toMatchObject({
      name: 'RealBrowserUnavailableError',
      code: 'webdev.real_browser_unavailable',
      endpoint: 'http://127.0.0.1:9222',
      reason: 'econnrefused',
    })
    expect(failure.message).toContain('No isolated-browser fallback was attempted')
    expect(failure.message).toContain('webdev_open_isolated')
    const payload = JSON.parse(failure.message.slice(failure.message.lastIndexOf('{'))) as Record<string, unknown>
    expect(payload).toEqual({
      code: 'webdev.real_browser_unavailable',
      endpoint: 'http://127.0.0.1:9222',
      reason: 'econnrefused',
      remediation: failure.remediation,
      nextStep: 'webdev_open_isolated',
    })
    expect(failure.remediation).toMatch(/Open in isolated Chromium/)
  })

  it('operator reads a stable reason for each failure class the host can tell apart', () => {
    // Given the four failures that actually happen plus a timeout and a stranger
    // When each is classified
    // Then the reason is the one the panel and an agent can branch on
    expect(classifyBrowserFailure(Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9222'), { code: 'ECONNREFUSED' })))
      .toBe('econnrefused')
    expect(classifyBrowserFailure(new Error('discovery returned HTTP 404'))).toBe('not_cdp')
    expect(classifyBrowserFailure(new Error('Chrome exited before its DevTools endpoint came up (exit code 1). The browser process was denied by the OS (crashpad/ACL). Browser output: [ERROR:crashpad_client_win.cc:431] OpenProcess: 拒绝访问。 (0x5)'))).toBe('spawn_denied')
    expect(classifyBrowserFailure(new Error('No Chrome binary found. Set CHROME_PATH to the executable, or install Chrome.'))).toBe('not_installed')
    expect(classifyBrowserFailure(Object.assign(new Error('opening handshake timed out'), { code: 'ETIMEDOUT' }))).toBe('timeout')
    expect(classifyBrowserFailure(new Error('something nobody has seen before'))).toBe('unknown')
  })

  it('operator sees actionable advice for every classified reason', () => {
    // Given each reason the wire contract defines
    // When its remediation is rendered
    // Then it is a non-empty sentence and never claims a silent fallback
    for (const reason of ['econnrefused', 'not_cdp', 'spawn_denied', 'not_installed', 'timeout', 'unknown'] as const) {
      const advice = remediationFor(reason)
      expect(advice.length).toBeGreaterThan(20)
      expect(advice).not.toMatch(/silently|automatically/i)
    }
  })
})

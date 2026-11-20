// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * `fallbackOnUnavailable`: the profile's pre-declared downgrade.
 *
 * The rule this file guards is the whole point of the feature being opt-in: a
 * host must never *silently* change the browser source. What it may do, when the
 * profile says so, is change it and *report* it — `state.autoFallback` names the
 * carrier it left and the classified reason — and only for failures that mean
 * "the configured browser is not there". Everything else keeps failing loudly.
 */

import { describe, expect, it } from 'vitest'
import { TabManager } from '../../src/core/tabs.ts'
import type { BrowserSession, OpenSessionOptions } from '../../src/host/service.ts'
import { BrowserViewService } from '../../src/host/service.ts'
import { RealBrowserUnavailableError, remediationFor } from '../../src/host/cdp-endpoint.ts'
import type { AutoFallbackMode } from '../../src/core/protocol.ts'
import { FakeTransport } from '../helpers/fake-cdp.ts'

/** An endpoint the tests never really connect to. */
const ENDPOINT = 'http://127.0.0.1:9222'

/** A working session over a scripted transport, as the isolated factory returns one. */
function scriptedSession(options: OpenSessionOptions, transport: FakeTransport): BrowserSession {
  const tabs = new TabManager({
    transport,
    jpegQuality: options.jpegQuality,
    viewport: options.viewport,
    pinViewport: options.mode !== 'cdp',
    discoverTargets: options.mode === 'cdp',
    onFrame: options.onFrame,
    onTabsChanged: options.onTabsChanged,
  })
  return {
    mode: options.mode,
    transport,
    tabs,
    async dispose() { transport.close() },
  }
}

/**
 * A service configured for a real browser, whose first CDP attempt fails in a
 * scripted way and whose later attempts succeed.
 * @param fallback - the profile's declared behaviour.
 * @param failure - what the first CDP attempt throws.
 * @returns the service plus the attempt log.
 */
function serviceWithFallback(fallback: AutoFallbackMode, failure: Error | undefined) {
  const transport = new FakeTransport()
  transport.responses.set('Target.createTarget', () => ({ targetId: 'tab-1' }))
  transport.responses.set('Target.attachToTarget', () => ({ sessionId: 'cdp-1' }))
  transport.responses.set('Target.getTargets', { targetInfos: [] })
  transport.responses.set('Page.captureScreenshot', { data: 'JPEG-BYTES' })
  transport.responses.set('Page.getLayoutMetrics', { cssLayoutViewport: { clientWidth: 1440, clientHeight: 900 } })
  const attempts: string[] = []
  const service = new BrowserViewService({
    now: () => 1_700_000_000_000,
    resolveConfig: () => ({ mode: 'cdp', cdpEndpoint: ENDPOINT }),
    fallbackOnUnavailable: () => fallback,
    openSession: async (options): Promise<BrowserSession> => {
      attempts.push(options.mode)
      if (options.mode === 'cdp' && attempts.filter(mode => mode === 'cdp').length === 1 && failure !== undefined) {
        throw failure
      }
      return scriptedSession(options, transport)
    },
  })
  return { service, attempts }
}

/** The canonical classified failure for "nothing is listening". */
function unavailable(reason: 'econnrefused' | 'not_cdp' | 'timeout' = 'econnrefused'): RealBrowserUnavailableError {
  return new RealBrowserUnavailableError(ENDPOINT, reason, remediationFor(reason))
}

describe('fallbackOnUnavailable: isolated', () => {
  it('operator starts a tool while the configured browser is missing and the host downgrades once, visibly', async () => {
    // Given a profile that pre-declared the isolated downgrade
    // And a real browser nothing is listening on
    // When a tool asks for tabs
    // Then it succeeds against the isolated browser, the state names the carrier
    //      it left and the classified reason, and the failed attempt is counted
    const { service, attempts } = serviceWithFallback('isolated', unavailable())

    const result = await service.listTabs()

    expect(attempts).toEqual(['cdp', 'isolated'])
    expect(result.tabs).toEqual([])
    const state = service.state()
    expect(state.mode).toBe('isolated')
    expect(state.running).toBe(true)
    expect(state.autoFallback).toEqual({
      from: 'cdp',
      reason: 'econnrefused',
      at: 1_700_000_000_000,
      endpoint: ENDPOINT,
    })
    // The way back stays available: the configured source is still the real one.
    expect(state.realBrowserConfigured).toBe(true)
    // The running browser is healthy, so nothing claims a blank panel: the
    // explanation lives in autoFallback, not in a stale error card.
    expect(state.lastError).toBeUndefined()
  })

  it('operator returns to the configured browser and the downgrade note is gone', async () => {
    // Given a host that already downgraded
    const { service } = serviceWithFallback('isolated', unavailable())
    await service.listTabs()
    expect(service.state().autoFallback).toBeDefined()

    // When a person asks for the configured source again (the second attempt works)
    const state = await service.useConfigured()

    // Then the viewer is on the real browser and nothing claims a downgrade
    expect(state.mode).toBe('cdp')
    expect(state.autoFallback).toBeUndefined()
    expect(service.state().realBrowserConfigured).toBeFalsy()
  })

  it('operator edits settings after a downgrade and the automatic choice does not survive the edit', async () => {
    // Given a host that downgraded on its own
    const { service } = serviceWithFallback('isolated', unavailable())
    await service.listTabs()
    expect(service.state().mode).toBe('isolated')

    // When a settings edit reconfigures the source
    await service.reconfigure()

    // Then the recorded downgrade is gone, so the profile's configuration is
    // what gets the next attempt instead of a stale automatic choice
    expect(service.state().autoFallback).toBeUndefined()
  })
})

describe('no fallback', () => {
  it('operator runs on the default profile and an unreachable browser still fails loudly', async () => {
    // Given the default configuration
    // When a tool asks for tabs
    // Then the classified failure is thrown and nothing changed the source
    const { service, attempts } = serviceWithFallback('never', unavailable())

    await expect(service.listTabs()).rejects.toThrow(/webdev\.real_browser_unavailable/)
    expect(attempts).toEqual(['cdp'])
    expect(service.state().mode).toBe('cdp')
    expect(service.state().autoFallback).toBeUndefined()
  })

  it('operator has an unclassified failure and the pre-declared downgrade does not guess', async () => {
    // Given a failure the host could not classify
    // When the same tool runs
    // Then no source change happens: an unknown bug is not "the browser is missing"
    const { service, attempts } = serviceWithFallback('isolated', new Error('something odd happened'))

    await expect(service.listTabs()).rejects.toThrow(/something odd happened/)
    expect(attempts).toEqual(['cdp'])
    expect(service.state().mode).toBe('cdp')
    expect(service.state().autoFallback).toBeUndefined()
  })

  it('operator points at something that is not CDP and the downgrade is still reported by reason', async () => {
    // Given a port that answers with something that is not a CDP endpoint
    // When the pre-declared fallback runs
    // Then the switch happens and the reason is carried, not flattened to "unknown"
    const { service } = serviceWithFallback('isolated', unavailable('not_cdp'))

    await service.listTabs()

    expect(service.state().autoFallback?.reason).toBe('not_cdp')
  })
})

// New test for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * The desktop style bridge: the agent-side "change it and let me see" path the
 * panel's style inspector already used. A fake panel answers `native-request`
 * frames, so the assertions cover the host's request/response plumbing without
 * an Electron guest.
 */

import { describe, expect, it } from 'vitest'
import type { BrowserViewEvent } from '../../src/core/protocol.ts'
import { BrowserViewService, type BrowserViewSink } from '../../src/host/service.ts'

/** One native operation the fake panel was asked to run. */
interface NativeRequest {
  op: string
  args?: unknown
}

/**
 * A fake panel that answers native style operations against a tiny style map.
 * @returns the sink, the requests it saw, and the page's current inline styles.
 */
function stylePanel(): {
  service: BrowserViewService
  sink: BrowserViewSink
  requests: NativeRequest[]
  styles: Record<string, string>
} {
  const requests: NativeRequest[] = []
  const styles: Record<string, string> = { 'border-radius': '9999px' }
  const service = new BrowserViewService()
  const sink: BrowserViewSink = {
    send(event: BrowserViewEvent) {
      if (event.kind !== 'native-request') return
      requests.push({ op: event.op, args: event.args })
      let result: unknown
      if (event.op === 'style-get') {
        const args = event.args as { properties?: string[] }
        const values: Record<string, string> = {}
        for (const property of args.properties ?? []) values[property] = styles[property] ?? ''
        result = values
      } else if (event.op === 'style-set') {
        const args = event.args as { property: string; value: string }
        styles[args.property] = args.value
        result = { ok: true }
      } else if (event.op === 'style-reset') {
        const args = event.args as { property: string }
        delete styles[args.property]
        result = { ok: true }
      }
      void service.handleCommand(sink, {
        v: 1,
        kind: 'native-result',
        requestId: event.requestId,
        result,
      })
    },
    close() { /* nothing to release in the fake */ },
  }
  return { service, sink, requests, styles }
}

describe('native style bridge', () => {
  it('operator reads, sets and resets one property on the desktop guest', async () => {
    // Given a mounted desktop panel that answers style operations
    const { service, sink, requests, styles } = stylePanel()
    const detach = service.attach(sink)
    await service.handleCommand(sink, { v: 1, kind: 'native-attach', sessionId: 'session-a' })

    // When the agent reads, changes and resets the radius of the picked element
    const before = await service.nativeStyle('#est_cn', ['border-radius'])
    await service.nativeStyleSet('#est_cn', 'border-radius', '0')
    await service.nativeStyleReset('#est_cn', 'border-radius')

    // Then each operation reached the guest as one native-request and the page saw the change
    expect(before).toEqual({ 'border-radius': '9999px' })
    expect(requests.map(request => request.op)).toEqual(['style-get', 'style-set', 'style-reset'])
    expect(requests[1]?.args).toEqual({ selector: '#est_cn', property: 'border-radius', value: '0' })
    expect(styles['border-radius']).toBeUndefined()
    detach()
  })

  it('operator calls the style bridge with no mounted panel and it fails immediately', async () => {
    // Given a service with no panel owning the desktop guest
    const service = new BrowserViewService()

    // When the style bridge is used
    // Then it names the missing panel instead of waiting for the native deadline
    await expect(service.nativeStyleSet('#est_cn', 'border-radius', '0'))
      .rejects.toThrow(/webdev\.panel_not_mounted/)
  })
})

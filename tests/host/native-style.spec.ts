// New test for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * The desktop style bridge: the agent-side "change it and let me see" path the
 * panel's style inspector already used. A fake panel answers `native-request`
 * frames, so the assertions cover the host's request/response plumbing without
 * an Electron guest.
 */

import { describe, expect, it } from 'vitest'
import type { BrowserViewEvent } from '../../src/core/protocol.ts'
import { previewKey } from '../../src/core/protocol.ts'
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
  events: BrowserViewEvent[]
} {
  const requests: NativeRequest[] = []
  const events: BrowserViewEvent[] = []
  const styles: Record<string, string> = { 'border-radius': '9999px' }
  const service = new BrowserViewService()
  const sink: BrowserViewSink = {
    send(event: BrowserViewEvent) {
      events.push(event)
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
  return { service, sink, requests, styles, events }
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
    const during = service.state().preview
    await service.nativeStyleReset('#est_cn', 'border-radius')

    // Then each operation reached the guest as one native-request and the page saw the change
    expect(before).toEqual({ 'border-radius': '9999px' })
    expect(requests.map(request => request.op)).toEqual(['style-get', 'style-set', 'style-reset'])
    expect(requests[1]?.args).toEqual({ selector: '#est_cn', property: 'border-radius', value: '0' })
    expect(during).toEqual({
      active: true,
      count: 1,
      elements: [{ selector: '#est_cn', relation: 'self' }],
    })
    expect(service.state().preview).toBeUndefined()
    expect(styles['border-radius']).toBeUndefined()
    detach()
  })

  it('operator targets the parent or a pseudo-element and the request carries the layer', async () => {
    // Given a mounted desktop panel
    const { service, sink, requests } = stylePanel()
    const detach = service.attach(sink)
    await service.handleCommand(sink, { v: 1, kind: 'native-attach', sessionId: 'session-a' })

    // When the agent reads a pseudo-element of the parent element
    await service.nativeStyle('#est_cn', ['border-radius'], { relation: 'parent', pseudo: '::before' })

    // Then the layer travels in the native request instead of being guessed by the panel
    expect(requests[0]?.args).toEqual({
      selector: '#est_cn',
      properties: ['border-radius'],
      relation: 'parent',
      pseudo: '::before',
    })
    detach()
  })

  it('operator reports panel style keys and the Preview state counts distinct elements', async () => {
    // Given an agent override already counted
    const { service, sink } = stylePanel()
    const detach = service.attach(sink)
    await service.handleCommand(sink, { v: 1, kind: 'native-attach', sessionId: 'session-a' })
    await service.nativeStyleSet('#est_cn', 'color', 'red')
    expect(service.state().preview).toEqual({
      active: true,
      count: 1,
      elements: [{ selector: '#est_cn', relation: 'self' }],
    })

    // When the panel reports one key on the same element and one on another
    await service.handleCommand(sink, {
      v: 1,
      kind: 'style-preview',
      keys: [
        previewKey('self', '#est_cn', '', 'border-radius'),
        previewKey('self', '#other', '', 'color'),
      ],
    })

    // Then the count is elements, not properties, and the overlay list has both
    expect(service.state().preview).toEqual({
      active: true,
      count: 2,
      elements: [
        { selector: '#est_cn', relation: 'self' },
        { selector: '#other', relation: 'self' },
      ],
    })

    // And a page reload drops every key at once
    await service.handleCommand(sink, { v: 1, kind: 'preview-reset' })
    expect(service.state().preview).toBeUndefined()
    detach()
  })

  it('operator targets a parent or a pseudo-element and the overlay keeps the element relation', async () => {
    // Given a mounted panel
    const { service, sink } = stylePanel()
    const detach = service.attach(sink)
    await service.handleCommand(sink, { v: 1, kind: 'native-attach', sessionId: 'session-a' })

    // When two properties are set on different layers of one element
    await service.nativeStyleSet('#est_cn', 'border-radius', '0', { pseudo: '::after' })
    await service.nativeStyleSet('#est_cn', 'background-color', 'white', { relation: 'parent' })

    // Then the element count stays one per target and pseudo does not split it
    expect(service.state().preview).toEqual({
      active: true,
      count: 2,
      elements: [
        { selector: '#est_cn', relation: 'self' },
        { selector: '#est_cn', relation: 'parent' },
      ],
    })
    detach()
  })

  it('operator detaches the panel and the temporary-style state goes with the guest', async () => {
    // Given an active preview
    const { service, sink } = stylePanel()
    const detach = service.attach(sink)
    await service.handleCommand(sink, { v: 1, kind: 'native-attach', sessionId: 'session-a' })
    await service.nativeStyleSet('#est_cn', 'border-radius', '0')
    expect(service.state().preview?.active).toBe(true)

    // When the panel detaches its native guest
    await service.handleCommand(sink, { v: 1, kind: 'native-detach' })

    // Then the Preview chip cannot outlive the document it described
    expect(service.state().preview).toBeUndefined()
    detach()
  })

  it('operator gets a preview-toned action line for a style adjustment', async () => {
    // Given a mounted desktop panel
    const { service, sink, events } = stylePanel()
    const detach = service.attach(sink)
    await service.handleCommand(sink, { v: 1, kind: 'native-attach', sessionId: 'session-a' })

    // When a style adjustment is noted
    service.noteStylePreview('#est_cn · border-radius: 24px → 0')

    // Then the footer receives a normal action trace marked as a preview
    expect(events.some(event => event.kind === 'action'
      && event.trace.tool === 'style'
      && event.trace.tone === 'preview'
      && event.trace.summary.includes('border-radius'))).toBe(true)
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

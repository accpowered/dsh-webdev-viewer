// New test for dsh-webdev-viewer (Apache-2.0). See NOTICE.
// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { BROWSER_VIEW_API_VERSION, isBrowserInputEvent, isBrowserViewCommand } from '../../src/core/protocol.ts'

describe('panel protocol additions', () => {
  it('accepts input and pick commands on the current version', () => {
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'input',
      event: { type: 'mouse', action: 'down', x: 12, y: 34 },
    })).toBe(true)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'pick',
      requestId: 'r1',
      x: 10,
      y: 20,
    })).toBe(true)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'viewport',
      width: 390,
      height: 800,
    })).toBe(true)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'viewport',
      width: 1363,
      height: 963,
      deviceScaleFactor: 1.5,
    })).toBe(true)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'reconnect',
    })).toBe(true)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'open-isolated',
      url: 'https://cn.bing.com/',
    })).toBe(true)
    expect(isBrowserViewCommand({ v: BROWSER_VIEW_API_VERSION, kind: 'use-configured' })).toBe(true)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'pick-mode',
      enabled: true,
    })).toBe(true)
  })

  it('rejects malformed or foreign-version commands', () => {
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION + 1,
      kind: 'input',
      event: { type: 'mouse', action: 'down', x: 1, y: 2 },
    })).toBe(false)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'pick',
      requestId: 'r1',
      x: Number.NaN,
      y: 20,
    })).toBe(false)
    expect(isBrowserViewCommand({ v: BROWSER_VIEW_API_VERSION, kind: 'input' })).toBe(false)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'pick-mode',
      enabled: 'yes',
    })).toBe(false)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'viewport',
      width: 0,
      height: 800,
    })).toBe(false)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'viewport',
      width: 800,
      height: 600,
      deviceScaleFactor: 4,
    })).toBe(false)
    expect(isBrowserViewCommand({
      v: BROWSER_VIEW_API_VERSION,
      kind: 'viewport',
      width: 800,
      height: 600,
      deviceScaleFactor: Number.NaN,
    })).toBe(false)
  })

  it('validates the input event variants', () => {
    expect(isBrowserInputEvent({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 40 })).toBe(true)
    expect(isBrowserInputEvent({ type: 'key', action: 'down', key: 'Enter' })).toBe(true)
    expect(isBrowserInputEvent({ type: 'text', text: 'hello' })).toBe(true)
    expect(isBrowserInputEvent({ type: 'key', action: 'down' })).toBe(false)
    expect(isBrowserInputEvent({ type: 'mouse', action: 'down', x: '1', y: 2 })).toBe(false)
  })
})

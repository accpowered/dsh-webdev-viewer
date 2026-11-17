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
  })

  it('validates the input event variants', () => {
    expect(isBrowserInputEvent({ type: 'wheel', x: 1, y: 2, deltaX: 0, deltaY: 40 })).toBe(true)
    expect(isBrowserInputEvent({ type: 'key', action: 'down', key: 'Enter' })).toBe(true)
    expect(isBrowserInputEvent({ type: 'text', text: 'hello' })).toBe(true)
    expect(isBrowserInputEvent({ type: 'key', action: 'down' })).toBe(false)
    expect(isBrowserInputEvent({ type: 'mouse', action: 'down', x: '1', y: 2 })).toBe(false)
  })
})

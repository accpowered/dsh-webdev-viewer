// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * The two DOM-truth tools, driven through the real service over a scripted
 * transport: `webdev_eval` hands the page's answer back as a value, and
 * `webdev_measure` measures the element a snapshot ref points at.
 *
 * These are the tools that replaced "write a script into the page's build output
 * and read the console": their whole value is that the number comes from the
 * layout engine and arrives as a structured value, so both are checked through
 * the tool contract (execute → validate → render), not just at the service seam.
 */

import { describe, expect, it } from 'vitest'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { createBrowserTools, type DurableImageRef } from '../../src/host/tools.ts'
import { createFakeBrowser } from '../helpers/fake-browser.ts'

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

/** Build the tools over one fake browser. */
function build(options: Parameters<typeof createFakeBrowser>[0] = {}) {
  const browser = createFakeBrowser(options)
  const saveImage = async (input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg'; name?: string }): Promise<DurableImageRef> => ({
    attachmentId: 'att-1',
    mediaType: input.mediaType,
    bytes: input.data.byteLength,
    width: 10,
    height: 10,
  })
  const tools = createBrowserTools({ service: browser.service, saveImage })
  const byName = (name: string): ToolDefinition => {
    const tool = tools.find(candidate => candidate.name === name)
    if (tool === undefined) throw new Error(`no tool named ${name}`)
    return tool
  }
  return { browser, byName }
}

/** A measure report as the page would compute it. */
const REPORT = {
  url: 'https://a.test/',
  title: 'A',
  viewport: { width: 1343, height: 939, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  document: { scrollWidth: 1343, clientWidth: 1343, overflowX: 0, scrollHeight: 939, clientHeight: 939, overflowY: 0 },
  matches: 1,
  element: {
    selector: 'div#card',
    tag: 'div',
    id: 'card',
    classes: ['card'],
    rect: { x: 120, y: 200, width: 400, height: 240 },
    documentRect: { x: 120, y: 200, width: 400, height: 240 },
    visible: true,
    text: 'hello',
    styles: { display: 'block', 'overflow-x': 'hidden' },
    scroll: { scrollWidth: 420, clientWidth: 400, scrollHeight: 240, clientHeight: 240, overflowX: 'hidden', overflowY: 'visible' },
    clippedBy: [{
      selector: 'main#app',
      rect: { x: 0, y: 0, width: 380, height: 900 },
      overflowX: 'visible',
      overflowY: 'auto',
      clipsRight: 140,
      clipsBottom: 0,
    }],
  },
}

describe('webdev_eval', () => {
  it('operator evaluates an expression and the page value comes back validating', async () => {
    // Given a page that answers one expression with a JSON object
    // When webdev_eval runs that expression
    // Then the value is the page's object, the result validates, and the mean
    //     is a real value rather than text pretending to be JSON
    const { byName } = build({
      evaluate: expression => expression === '({w: innerWidth})' ? { result: { type: 'object', value: { w: 1343 } } } : undefined,
    })
    const tool = byName('webdev_eval')
    const value = await tool.execute({ expression: '({w: innerWidth})' }, fakeExec('session-a')) as Record<string, unknown>

    expect(value).toMatchObject({ type: 'object', value: { w: 1343 }, tabId: 'tab-1' })
    expect(validateJsonSchemaValue(tool.output.schema, asJson(value))).toEqual([])
  })

  it('operator evaluates an expression that throws and the call reports the page text', async () => {
    // Given a page that throws
    // When webdev_eval runs
    // Then the call rejects with the eval code and the thrown description
    const { byName } = build({
      evaluate: () => ({ exceptionDetails: { text: 'Uncaught', exception: { description: 'TypeError: bad' } } }),
    })
    const tool = byName('webdev_eval')
    await expect(tool.execute({ expression: 'throw new TypeError("bad")' }, fakeExec('session-a')))
      .rejects.toThrow(/webdev\.eval_failed: Uncaught: TypeError: bad/)
  })

  it('operator evaluates a node and the value is marked unserializable', async () => {
    // Given a page whose expression returns a DOM node
    // When webdev_eval runs
    // Then the result carries the description and the flag, and still validates
    const { byName } = build({
      evaluate: () => ({ result: { type: 'object', description: 'div#app' } }),
    })
    const tool = byName('webdev_eval')
    const value = await tool.execute({ expression: 'document.querySelector("#app")' }, fakeExec('session-a')) as Record<string, unknown>

    expect(value).toMatchObject({ type: 'object', unserializable: true, description: 'div#app' })
    expect(value).not.toHaveProperty('value')
    expect(validateJsonSchemaValue(tool.output.schema, asJson(value))).toEqual([])
  })
})

describe('webdev_measure', () => {
  it('operator measures a selector and the report arrives with its clipping ancestor', async () => {
    // Given a page that answers with a measurement
    // When webdev_measure runs with a selector
    // Then the tool returns the page boxes, the computed styles and what clips it
    const { byName } = build({ evaluate: () => ({ result: { type: 'object', value: REPORT } }) })
    const tool = byName('webdev_measure')
    const value = await tool.execute({ selector: 'div#card' }, fakeExec('session-a')) as Record<string, unknown>

    expect(value).toMatchObject({ tabId: 'tab-1', matches: 1 })
    const element = value.element as Record<string, unknown>
    expect(element.rect).toEqual({ x: 120, y: 200, width: 400, height: 240 })
    expect(element.clippedBy).toEqual([expect.objectContaining({ selector: 'main#app', clipsRight: 140 })])
    expect(validateJsonSchemaValue(tool.output.schema, asJson(value))).toEqual([])
  })

  it('operator measures a snapshot ref and the expression is built from that observation selector', async () => {
    // Given a snapshot whose ref 1 is the heading
    // When webdev_measure is called with that ref
    // Then the selector from that snapshot is what the page is asked to measure
    const seen: string[] = []
    const { byName } = build({
      evaluate: (expression) => {
        if (expression.includes('document.querySelectorAll')) {
          seen.push(expression)
          return { result: { type: 'object', value: REPORT } }
        }
        return expression.includes('nodes')
          ? { result: { value: { url: 'https://a.test/', title: 'A', nodes: [{ tag: 'body', depth: 0, selector: 'body' }, { tag: 'h1', depth: 1, selector: 'body > h1' }], truncated: false } } }
          : undefined
      },
    })
    await byName('webdev_snapshot').execute({}, fakeExec('session-a'))
    const tool = byName('webdev_measure')
    const value = await tool.execute({ ref: 1 }, fakeExec('session-a')) as Record<string, unknown>

    expect(seen).toHaveLength(1)
    expect(seen[0]).toContain('const SELECTOR = "body > h1";')
    expect(value.tabId).toBe('tab-1')
    expect(validateJsonSchemaValue(tool.output.schema, asJson(value))).toEqual([])
  })

  it('operator measures the page with no target and the document overflow is reported', async () => {
    // Given a page wider than its viewport
    // When webdev_measure runs with neither selector nor ref
    // Then the report carries the document overflow and no element
    const { byName } = build({
      evaluate: () => ({
        result: {
          type: 'object',
          value: {
            ...REPORT,
            document: { scrollWidth: 1435, clientWidth: 1343, overflowX: 92, scrollHeight: 939, clientHeight: 939, overflowY: 0 },
            matches: undefined,
            element: undefined,
          },
        },
      }),
    })
    const tool = byName('webdev_measure')
    const value = await tool.execute({}, fakeExec('session-a')) as Record<string, unknown>

    expect(value).toMatchObject({ tabId: 'tab-1' })
    expect(value.document).toMatchObject({ overflowX: 92 })
    expect(value).not.toHaveProperty('element')
    expect(validateJsonSchemaValue(tool.output.schema, asJson(value))).toEqual([])
  })
})

// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * `webdev_eval`'s pure parts: what the request becomes, and how a page's answer
 * is turned into something a model can read.
 *
 * The interesting cases are the ones a naive tool gets wrong: a DOM node that
 * has no JSON form, a `null` that must stay distinguishable from an absent
 * value, a value too large to ship, and an exception that must be an error
 * rather than a success with an error-shaped body.
 */

import { describe, expect, it } from 'vitest'
import {
  EVAL_DEFAULT_TIMEOUT_MS,
  EVAL_MAX_TIMEOUT_MS,
  EVAL_MAX_VALUE_CHARS,
  buildEvalParams,
  evalTimeoutOf,
  readEvalOutcome,
} from '../../src/core/eval.ts'

describe('request', () => {
  it('operator evaluates an expression and the parameters ask for a by-value awaitable result', () => {
    // Given an expression and no knobs
    // When the CDP parameters are built
    // Then it is evaluated by value, promises are awaited by default, and no gesture is synthesized
    expect(buildEvalParams({ expression: 'document.title' })).toEqual({
      expression: 'document.title',
      returnByValue: true,
      awaitPromise: true,
      userGesture: false,
      generatePreview: false,
    })
  })

  it('operator turns promise awaiting off and the parameters say so', () => {
    // Given a caller that wants the promise object itself
    // When the parameters are built
    // Then awaitPromise is false
    expect(buildEvalParams({ expression: 'fetch("/")', awaitPromise: false }).awaitPromise).toBe(false)
  })

  it('operator asks for a deadline outside the promised range and it is clamped', () => {
    // Given a zero, a negative and an oversized deadline
    // When each is resolved
    // Then the default, the minimum and the maximum come back instead of a hang
    expect(evalTimeoutOf({ expression: '1' })).toBe(EVAL_DEFAULT_TIMEOUT_MS)
    expect(evalTimeoutOf({ expression: '1', timeoutMs: -5 })).toBe(1)
    expect(evalTimeoutOf({ expression: '1', timeoutMs: 10_000_000 })).toBe(EVAL_MAX_TIMEOUT_MS)
    expect(evalTimeoutOf({ expression: '1', timeoutMs: Number.NaN })).toBe(EVAL_DEFAULT_TIMEOUT_MS)
  })
})

describe('outcome', () => {
  it('operator evaluates a plain value and it comes back unchanged', () => {
    // Given a page that answered with an object
    // When the payload is read
    // Then the value is the page's own JSON and no flag is set
    const outcome = readEvalOutcome({ result: { type: 'object', value: { width: 1343, ok: true } } })
    expect(outcome).toEqual({ type: 'object', value: { width: 1343, ok: true } })
  })

  it('operator evaluates null and it stays distinguishable from no value', () => {
    // Given a page that answered null
    // When the payload is read
    // Then isNull marks it and no value is invented
    expect(readEvalOutcome({ result: { type: 'object', subtype: 'null' } })).toEqual({ type: 'object', isNull: true })
  })

  it('operator evaluates a DOM node and the answer is its description, not a fake object', () => {
    // Given a page whose value has no JSON form
    // When the payload is read
    // Then it is marked unserializable and carries CDP's description
    const outcome = readEvalOutcome({ result: { type: 'object', description: 'div#app' } })
    expect(outcome).toEqual({ type: 'object', unserializable: true, description: 'div#app' })
  })

  it('operator evaluates a very long value and it is cut with its real length', () => {
    // Given a page that returned more characters than the cap allows
    // When the payload is read
    // Then the value is truncated, the flag says so, and chars keeps the true size
    const text = 'x'.repeat(EVAL_MAX_VALUE_CHARS + 100)
    const outcome = readEvalOutcome({ result: { type: 'string', value: text } })
    expect(outcome.truncated).toBe(true)
    expect(outcome.chars).toBeGreaterThan(EVAL_MAX_VALUE_CHARS)
    expect(String(outcome.value).length).toBeLessThan(text.length)
    expect(String(outcome.value)).toContain('truncated')
  })

  it('operator evaluates an expression that throws and the call fails with the page text', () => {
    // Given a page that threw while evaluating
    // When the payload is read
    // Then the error carries the code and the page's own message
    expect(() => readEvalOutcome({
      exceptionDetails: {
        text: 'Uncaught',
        lineNumber: 0,
        columnNumber: 12,
        exception: { description: 'TypeError: x is not a function' },
      },
    })).toThrow(/webdev\.eval_failed: Uncaught: TypeError: x is not a function \(line 0:12\)/)
  })

  it('operator evaluates without any result and the call fails instead of returning undefined', () => {
    // Given a payload with no result at all
    // When it is read
    // Then the read throws rather than reporting an empty success
    expect(() => readEvalOutcome({})).toThrow(/returned no value/)
  })
})

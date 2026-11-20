// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * `webdev_measure`'s in-page expression, tested without a page.
 *
 * The expression is a string this package hands to `Runtime.evaluate`, so the
 * things worth proving are the ones a string builder can get wrong: a caller's
 * selector must arrive as a value (never as code), the report shape must stay
 * the one the tool's output schema declares, and a page that threw must not be
 * read as a measurement.
 */

import { describe, expect, it } from 'vitest'
import { buildMeasureExpression, readMeasureReport } from '../../src/core/measure.ts'

describe('expression', () => {
  it('operator measures a selector and the selector is embedded as a JSON string literal', () => {
    // Given a selector that contains quotes and a template delimiter
    // When the expression is built
    // Then it appears quoted and escaped, so the page evaluates a value, not code
    const expression = buildMeasureExpression('a[title="x`y"]')
    expect(expression).toContain('const SELECTOR = "a[title=\\"x`y\\"]";')
    expect(expression).toContain('document.querySelectorAll(SELECTOR)')
  })

  it('operator measures the page and the expression asks about no element', () => {
    // Given no selector
    // When the expression is built
    // Then SELECTOR is null and the early return keeps the page-level report
    const expression = buildMeasureExpression(null)
    expect(expression).toContain('const SELECTOR = null;')
    expect(expression).toContain('if (SELECTOR === null) return report;')
    // The report every call carries, element or not.
    expect(expression).toContain('overflowX: Math.max(0, doc.scrollWidth - doc.clientWidth)')
    expect(expression).toContain('viewport: {')
  })

  it('operator measures an element and the expression reports its clipping ancestors', () => {
    // Given a selector
    // When the expression is built
    // Then the walk records the ancestors whose overflow cuts the element
    const expression = buildMeasureExpression('#card')
    expect(expression).toContain('clippedBy')
    expect(expression).toContain('clipsRight')
    expect(expression).toContain('clipsBottom')
    expect(expression).toContain("getPropertyValue('overflow-x')")
  })
})

describe('report', () => {
  it('operator measures an element and the report is returned as-is', () => {
    // Given a page that answered with a measurement
    // When it is read
    // Then the object is the report
    const report = {
      url: 'https://a.test/',
      title: 'A',
      viewport: { width: 1343, height: 939, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      document: { scrollWidth: 1343, clientWidth: 1343, overflowX: 0, scrollHeight: 939, clientHeight: 939, overflowY: 0 },
      matches: 1,
    }
    expect(readMeasureReport({ result: { type: 'object', value: report } })).toEqual(report)
  })

  it('operator measures a page that threw and the call fails with the page text', () => {
    // Given a page that threw while measuring
    // When it is read
    // Then the read fails with the measure code and the thrown description
    expect(() => readMeasureReport({
      exceptionDetails: { text: 'Uncaught', exception: { description: 'Error: too deep' } },
    })).toThrow(/webdev\.measure_failed: Uncaught: Error: too deep/)
  })

  it('operator measures a page that navigated mid-call and gets an explanation, not undefined', () => {
    // Given a payload with no value
    // When it is read
    // Then the read fails with the navigating explanation
    expect(() => readMeasureReport({})).toThrow(/did not return a measurement/)
  })
})

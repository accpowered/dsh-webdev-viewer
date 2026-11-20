/**
 * DOM-truth measurement for the agent: one `Runtime.evaluate` that reports the
 * page's real boxes and the style values that decide them.
 *
 * Why this exists. A screenshot is evidence about pixels, not about layout: a
 * frame that was captured while the viewport was being re-pinned, or that the
 * panel is showing letterboxed, can make a 1343 px page look like an overflowing
 * 1251 px one. Every "the panel is clipped / the card overflows" conclusion in
 * the field had to be re-checked in the page with `getBoundingClientRect()`
 * before it could be trusted, and the only way to run that check was to edit the
 * page's own build output and read the numbers back through the console. This
 * module makes that check a tool call: the numbers the browser's layout engine
 * actually produced, in the same CSS coordinate space `webdev_screenshot`'s clip
 * and `webdev_snapshot`'s boxes use.
 *
 * The walk runs in the page (one evaluate), not over the DOM protocol, for the
 * same reason the snapshot does: `DOM.getDocument` ships the whole tree, and
 * this only needs one element and its ancestor chain.
 *
 * @module dsh-webdev-viewer/core/measure
 */

import type { RawEvalPayload } from './eval.ts'

/** A rectangle in CSS pixels, rounded to two decimals. */
export interface MeasureRect {
  /** Left edge, viewport-relative. */
  x: number
  /** Top edge, viewport-relative. */
  y: number
  /** Width. */
  width: number
  /** Height. */
  height: number
}

/** One ancestor whose `overflow` really cuts the measured element. */
export interface MeasureClippingAncestor {
  /** Selector that resolves back to the ancestor. */
  selector: string
  /** Ancestor box, viewport-relative. */
  rect: MeasureRect
  /** Computed `overflow-x`. */
  overflowX: string
  /** Computed `overflow-y`. */
  overflowY: string
  /** Pixels of the element's right edge hidden past this ancestor's right edge. */
  clipsRight: number
  /** Pixels of the element's bottom edge hidden past this ancestor's bottom edge. */
  clipsBottom: number
}

/** The element the caller asked about. */
export interface MeasureElement {
  /** Selector this element was reached with. */
  selector: string
  /** Lowercase tag name. */
  tag: string
  /** Element id, when set. */
  id?: string
  /** Class list, when non-empty. */
  classes?: string[]
  /** Border box, viewport-relative — the same space a screenshot clip uses. */
  rect: MeasureRect
  /** Border box in document coordinates (rect offset by the page scroll). */
  documentRect: MeasureRect
  /** Whether the element draws anything at all. */
  visible: boolean
  /** Visible text, trimmed and truncated, for orientation. */
  text?: string
  /** Computed values of the properties that decide layout, in kebab case. */
  styles: Record<string, string>
  /** The element's own scroll box, which is where its content can be cut. */
  scroll: {
    /** Content width. */
    scrollWidth: number
    /** Visible width. */
    clientWidth: number
    /** Content height. */
    scrollHeight: number
    /** Visible height. */
    clientHeight: number
    /** Computed `overflow-x`. */
    overflowX: string
    /** Computed `overflow-y`. */
    overflowY: string
  }
  /** Ancestors that really clip it, nearest first. */
  clippedBy: MeasureClippingAncestor[]
}

/** What one measurement reports. */
export interface MeasureReport {
  /** Document url at measurement time. */
  url: string
  /** Document title at measurement time. */
  title: string
  /** Viewport in CSS pixels plus its scroll position. */
  viewport: {
    /** Layout viewport width. */
    width: number
    /** Layout viewport height. */
    height: number
    /** Page device pixel ratio (the viewer pins CSS to 1, so DPR 1 is normal). */
    devicePixelRatio: number
    /** Horizontal page scroll. */
    scrollX: number
    /** Vertical page scroll. */
    scrollY: number
  }
  /** Document box, which is what an "overflow" report is really about. */
  document: {
    /** Document scroll width. */
    scrollWidth: number
    /** Document client width. */
    clientWidth: number
    /** `scrollWidth - clientWidth`, clamped at zero: the horizontal overflow. */
    overflowX: number
    /** Document scroll height. */
    scrollHeight: number
    /** Document client height. */
    clientHeight: number
    /** `scrollHeight - clientHeight`, clamped at zero: the vertical overflow. */
    overflowY: number
  }
  /** How many elements the selector matched. */
  matches?: number
  /** Why the selector could not be used, instead of a silent zero-match. */
  selectorError?: string
  /** The first match, absent when the selector matched nothing. */
  element?: MeasureElement
}

/** Properties reported for the measured element. */
export const MEASURE_STYLE_PROPERTIES = [
  'display',
  'position',
  'box-sizing',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'padding',
  'margin',
  'gap',
  'flex-direction',
  'flex-wrap',
  'justify-content',
  'align-items',
  'overflow-x',
  'overflow-y',
  'white-space',
  'text-overflow',
  'z-index',
  'opacity',
  'visibility',
  'font-size',
  'line-height',
] as const

/**
 * Build the in-page measurement expression.
 *
 * The selector is embedded as a JSON string literal: it comes from the caller,
 * and the page must see it as a value, never as code.
 * @param selector - CSS selector to measure, or null to report page metrics only.
 * @returns a self-invoking expression returning {@link MeasureReport}.
 */
export function buildMeasureExpression(selector: string | null): string {
  const styleKeys = MEASURE_STYLE_PROPERTIES.map(key => JSON.stringify(key)).join(', ')
  return `(() => {
  const SELECTOR = ${selector === null ? 'null' : JSON.stringify(selector)};
  const STYLE_KEYS = [${styleKeys}];
  const round = (value) => Math.round(value * 100) / 100;
  const rectOf = (rect) => ({
    x: round(rect.left), y: round(rect.top), width: round(rect.width), height: round(rect.height),
  });
  const scrollOf = () => {
    const viewport = window.visualViewport;
    if (viewport) return { x: round(viewport.pageLeft), y: round(viewport.pageTop) };
    const scroller = document.scrollingElement || document.documentElement;
    return { x: round(scroller.scrollLeft), y: round(scroller.scrollTop) };
  };
  const selectorOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id) {
        parts.unshift(node.tagName.toLowerCase() + '#' + CSS.escape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.prototype.filter.call(parent.children, (child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ');
  };
  const clip = (value, max) => {
    const text = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '...' : text;
  };
  const scroll = scrollOf();
  const doc = document.documentElement;
  const report = {
    url: location.href,
    title: document.title,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollX: scroll.x,
      scrollY: scroll.y,
    },
    document: {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowX: Math.max(0, doc.scrollWidth - doc.clientWidth),
      scrollHeight: doc.scrollHeight,
      clientHeight: doc.clientHeight,
      overflowY: Math.max(0, doc.scrollHeight - doc.clientHeight),
    },
  };
  if (SELECTOR === null) return report;
  let matches = [];
  try {
    matches = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
  } catch (error) {
    return Object.assign(report, { matches: 0, selectorError: String(error && error.message || error) });
  }
  report.matches = matches.length;
  const el = matches[0];
  if (!el) return report;
  const style = window.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const box = rectOf(rect);
  const styles = {};
  for (const key of STYLE_KEYS) styles[key] = style.getPropertyValue(key);
  const element = {
    selector: selectorOf(el),
    tag: el.tagName.toLowerCase(),
    rect: box,
    documentRect: { x: round(rect.left + scroll.x), y: round(rect.top + scroll.y), width: box.width, height: box.height },
    visible: rect.width > 0 && rect.height > 0 && style.display !== 'none'
      && style.visibility !== 'hidden' && Number(style.opacity) > 0,
    styles: styles,
    scroll: {
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      overflowX: style.getPropertyValue('overflow-x'),
      overflowY: style.getPropertyValue('overflow-y'),
    },
    clippedBy: [],
  };
  if (el.id) element.id = el.id;
  const classes = (el.getAttribute('class') || '').split(/\\s+/).filter(Boolean).slice(0, 8);
  if (classes.length > 0) element.classes = classes;
  const ownText = clip(el.textContent, 120);
  if (ownText) element.text = ownText;
  // Which ancestor really cuts it: an overflow other than visible whose box ends
  // before the element does. This is the answer to "why is my card clipped".
  let ancestor = el.parentElement;
  let hops = 0;
  while (ancestor && ancestor !== doc && hops < 40 && element.clippedBy.length < 6) {
    hops += 1;
    const ancestorStyle = window.getComputedStyle(ancestor);
    const overflowX = ancestorStyle.getPropertyValue('overflow-x');
    const overflowY = ancestorStyle.getPropertyValue('overflow-y');
    if (overflowX !== 'visible' || overflowY !== 'visible') {
      const ancestorRect = ancestor.getBoundingClientRect();
      const clipsRight = round(Math.max(0, rect.right - ancestorRect.right));
      const clipsBottom = round(Math.max(0, rect.bottom - ancestorRect.bottom));
      if (clipsRight > 0 || clipsBottom > 0) {
        element.clippedBy.push({
          selector: selectorOf(ancestor),
          rect: rectOf(ancestorRect),
          overflowX: overflowX,
          overflowY: overflowY,
          clipsRight: clipsRight,
          clipsBottom: clipsBottom,
        });
      }
    }
    ancestor = ancestor.parentElement;
  }
  report.element = element;
  return report;
})()`
}

/**
 * Read the value one measurement returned.
 *
 * The in-page code already produced plain JSON, so this only rejects the shapes
 * that mean the evaluate itself did not work (an exception, a non-object, a
 * page that navigated mid-call) instead of handing the caller an undefined.
 * @param payload - raw `Runtime.evaluate` result.
 * @returns the report.
 * @throws when the page threw or did not answer with a measurement.
 */
export function readMeasureReport(payload: unknown): MeasureReport {
  const raw = payload as RawEvalPayload | undefined
  if (raw?.exceptionDetails !== undefined) {
    const described = raw.exceptionDetails.exception?.description
    throw new Error(`webdev.measure_failed: ${raw.exceptionDetails.text ?? 'the page threw while measuring'}${described === undefined ? '' : `: ${described}`}`)
  }
  const result = raw?.result?.value
  if (typeof result !== 'object' || result === null) {
    throw new Error('the page did not return a measurement; it may still be navigating')
  }
  return result as MeasureReport
}

// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Resolve the element under a panel pick gesture.
 *
 * The panel coordinates are viewport CSS pixels. `document.elementFromPoint`
 * returns the topmost element in the page's main document; the expression then
 * computes a unique selector, a fingerprint for stale rebinding, the visible
 * box, and best-effort source hints. Shadow DOM and cross-origin iframes are
 * intentionally reported as the host/iframe element rather than guessed.
 *
 * @module dsh-webdev-viewer/core/pick
 */
import type { CdpTransport } from './cdp.ts'
import type { BrowserPickedElement } from './protocol.ts'
import type { TabManager } from './tabs.ts'

/** The collaborators one pick needs. */
export interface PickScope {
  /** Protocol transport shared with the tab manager. */
  transport: CdpTransport
  /** Tab bookkeeping and session lookup. */
  tabs: TabManager
}

/**
 * Build the in-page expression.
 * @param x - viewport x in CSS pixels.
 * @param y - viewport y in CSS pixels.
 * @returns a self-invoking expression returning JSON.
 */
function pickExpression(x: number, y: number): string {
  return `(() => {
  const RX = ${Math.max(0, Math.floor(x))};
  const RY = ${Math.max(0, Math.floor(y))};
  const clip = (value, max) => {
    const text = String(value == null ? '' : value).replace(/\\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max) + '...' : text;
  };
  const selectorOf = (el) => {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.documentElement) {
      if (node.id) { parts.unshift(node.tagName.toLowerCase() + '#' + CSS.escape(node.id)); break; }
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
  const hash = (text) => {
    let value = 5381;
    for (let i = 0; i < text.length; i++) value = ((value << 5) + value) ^ text.charCodeAt(i);
    return (value >>> 0).toString(16).padStart(8, '0');
  };
  const ROLES = {
    a: 'link', button: 'button', img: 'img', input: 'textbox', textarea: 'textbox',
    select: 'combobox', option: 'option', nav: 'navigation', main: 'main',
    header: 'banner', footer: 'contentinfo', aside: 'complementary', section: 'region',
    form: 'form', ul: 'list', ol: 'list', li: 'listitem', table: 'table', tr: 'row',
    td: 'cell', th: 'columnheader', h1: 'heading', h2: 'heading', h3: 'heading',
    h4: 'heading', h5: 'heading', h6: 'heading', p: 'paragraph', label: 'label',
    dialog: 'dialog',
  };
  const el = document.elementFromPoint(RX, RY);
  if (!el) return JSON.stringify({ error: 'no element at that point' });
  const tag = el.tagName.toLowerCase();
  const id = el.id || undefined;
  const classes = Array.from(el.classList || []).slice(0, 8);
  const role = el.getAttribute('role') || ROLES[tag] || undefined;
  const name = clip(
    el.getAttribute('aria-label')
      || el.getAttribute('aria-labelledby') && (document.getElementById(el.getAttribute('aria-labelledby'))?.textContent || '')
      || el.getAttribute('alt')
      || el.getAttribute('title')
      || el.getAttribute('placeholder')
      || el.innerText
      || el.value
      || '',
    120,
  ) || undefined;
  const text = clip(el.innerText || el.value || '', 200) || undefined;
  const rect = el.getBoundingClientRect();
  const box = { x: Math.round(rect.left), y: Math.round(rect.top), width: Math.round(rect.width), height: Math.round(rect.height) };
  const selector = selectorOf(el);
  const fingerprint = hash([tag, id || '', classes.join('.'), text || '', selector].join('|'));
  let source;
  const sourceAttr = el.getAttribute('data-source');
  if (sourceAttr) {
    const match = /^(.*?)(?::(\\d+))?$/.exec(sourceAttr);
    if (match) source = { file: match[1], line: match[2] ? Number(match[2]) : undefined };
  }
  if (!source) {
    const component = el.getAttribute('data-component') || el.getAttribute('data-testid') || undefined;
    if (component) source = { component };
  }
  if (!source) {
    try {
      const key = Object.keys(el).find((name) => name.startsWith('__reactFiber$'));
      let fiber = key ? el[key] : undefined;
      for (let depth = 0; fiber && depth < 12; depth++, fiber = fiber.return) {
        const debug = fiber._debugSource;
        if (debug && debug.fileName) {
          source = { file: String(debug.fileName), line: Number(debug.lineNumber) || undefined };
          break;
        }
      }
    } catch {
      // Framework internals are best-effort; a failed probe must not fail the pick.
    }
  }
  return JSON.stringify({
    element: {
      pageVersion: 0,
      selector,
      fingerprint,
      tag,
      ...id === undefined ? {} : { id },
      ...classes.length === 0 ? {} : { classes },
      ...role === undefined ? {} : { role },
      ...name === undefined ? {} : { name },
      ...text === undefined ? {} : { text },
      box,
      ...source === undefined ? {} : { source },
    },
  });
})()`
}

/**
 * Resolve the element under one viewport point.
 * @param scope - transport and tab manager.
 * @param tabId - target tab.
 * @param x - viewport x in CSS pixels.
 * @param y - viewport y in CSS pixels.
 * @returns the picked element, stamped with the tab's document version.
 * @throws when no element is at the point or the page rejects the evaluation.
 */
export async function pickElement(scope: PickScope, tabId: string, x: number, y: number): Promise<BrowserPickedElement> {
  const sessionId = scope.tabs.sessionOf(tabId)
  const result = await scope.transport.send<{ result?: { value?: unknown } }>('Runtime.evaluate', {
    expression: pickExpression(x, y),
    returnByValue: true,
    awaitPromise: false,
  }, sessionId)
  const raw = result.result?.value
  if (typeof raw !== 'string') throw new Error('the page did not return a picked element')
  const parsed = JSON.parse(raw) as { element?: BrowserPickedElement; error?: string }
  if (parsed.error !== undefined) throw new Error(parsed.error)
  if (parsed.element === undefined) throw new Error('the page returned no picked element')
  return { ...parsed.element, pageVersion: scope.tabs.versionOf(tabId) }
}

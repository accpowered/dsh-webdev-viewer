// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Page-side element picker.
 *
 * Adapted from the MIT-licensed element-marking implementation in
 * `dsh-web-preview-panel` 0.2.4 (selector, hover/active outline, payload
 * shape). The difference is transport: this copy runs in a real page and sends
 * the picked element through a CDP binding, so a click in the actual browser
 * window (not only in the DSH panel) becomes a development pick.
 *
 * The source is shipped as a function whose text is evaluated in the page. It
 * must stay self-contained: no imports, no outer variables, no TypeScript-only
 * runtime constructs.
 *
 * @module dsh-webdev-viewer/core/page-picker
 */

/** CDP binding the page calls with one JSON payload. */
export const PAGE_PICKER_BINDING = '__dshWebdevPick'

/** Console prefix used when the page has no CDP binding (native webview). */
export const PAGE_PICKER_CONSOLE_PREFIX = '__DSH_WEBDEV_PICK__'

/**
 * Script evaluated in the page to install (or re-enable) the picker.
 * @returns a self-invoking expression.
 */
export const PAGE_PICKER_SCRIPT = `(${installPagePicker.toString()})()`

/**
 * Install the picker in the page.
 *
 * Kept as a function so TypeScript checks it and the runtime can ship its
 * compiled source. Do not reference module scope from here.
 */
function installPagePicker(): void {
  const w = window as unknown as {
    __dshWebdevPicker?: { setEnabled(value: boolean): void }
    __dshWebdevPick?: (payload: string) => void
  }
  if (w.__dshWebdevPicker !== undefined) {
    w.__dshWebdevPicker.setEnabled(true)
    return
  }

  const INTERNAL = ['dsh-wvp-hover', 'dsh-wvp-active']
  let enabled = false
  let active: Element | null = null
  let hover: Element | null = null

  const style = document.createElement('style')
  style.id = 'dsh-webdev-picker-style'
  style.textContent = [
    'html.dsh-wvp-picking, html.dsh-wvp-picking body { cursor: crosshair !important; }',
    '.dsh-wvp-hover { outline: 2px dashed #ff9800 !important; outline-offset: 2px !important; }',
    '.dsh-wvp-active { outline: 2px solid #4f8cff !important; outline-offset: 2px !important; background: rgba(79,140,255,.12) !important; }',
  ].join('\n')
  document.head.appendChild(style)

  const esc = (value: string): string => String(value).replace(/([^a-zA-Z0-9_\-\u00a0-\uffff])/g, (char) => `\\${char}`)

  const classesOf = (node: Element): string[] => {
    if (node.classList.length === 0) return []
    return Array.from(node.classList).filter((name) => INTERNAL.indexOf(name) === -1)
  }

  const selectorOf = (element: Element): string => {
    const parts: string[] = []
    let node: Element | null = element
    while (node !== null && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      let part = node.tagName.toLowerCase()
      if (node.id) {
        parts.unshift(`#${esc(node.id)}`)
        break
      }
      const classes = classesOf(node)
      if (classes.length > 0) part += classes.slice(0, 3).map((name) => `.${esc(name)}`).join('')
      const parent: Element | null = node.parentElement
      if (parent !== null) {
        const same = Array.from(parent.children).filter((child: Element) => child.tagName === node?.tagName)
        if (same.length > 1) part += `:nth-child(${Array.from(parent.children).indexOf(node) + 1})`
      }
      parts.unshift(part)
      node = parent
    }
    return parts.join(' > ')
  }

  const stripInternal = (root: Element): Element => {
    const walk = (node: Element): void => {
      for (const name of INTERNAL) node.classList.remove(name)
      if (node.classList.length === 0) node.removeAttribute('class')
      for (const child of Array.from(node.children)) walk(child)
    }
    walk(root)
    return root
  }

  const clearHover = (): void => {
    if (hover !== null) hover.classList.remove('dsh-wvp-hover')
    hover = null
  }

  const clearActive = (): void => {
    if (active !== null) active.classList.remove('dsh-wvp-active')
    active = null
  }

  // Persistent numbered boxes live in a closed shadow root under <html>, not
  // <body>, so the agent's DOM snapshot never sees our own overlays. The host is
  // pointer-events:none; only pixels are added.
  let markerHost: HTMLElement | null = null
  let markerRoot: HTMLElement | null = null
  const markers: Array<{ element: Element; box: HTMLElement }> = []

  const positionMarkers = (): void => {
    for (const marker of markers) {
      const rect = marker.element.getBoundingClientRect()
      marker.box.style.left = `${Math.round(rect.left)}px`
      marker.box.style.top = `${Math.round(rect.top)}px`
      marker.box.style.width = `${Math.round(rect.width)}px`
      marker.box.style.height = `${Math.round(rect.height)}px`
    }
  }

  const ensureMarkers = (): HTMLElement => {
    if (markerRoot !== null) return markerRoot
    const host = document.createElement('div')
    host.setAttribute('data-dsh-webdev-markers', '')
    host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647'
    const shadow = host.attachShadow({ mode: 'closed' })
    const root = document.createElement('div')
    root.style.cssText = 'position:absolute;inset:0'
    shadow.append(root)
    document.documentElement.append(host)
    markerHost = host
    markerRoot = root
    return root
  }

  const addMarker = (element: Element): void => {
    const root = ensureMarkers()
    const box = document.createElement('div')
    box.style.cssText = 'position:absolute;box-sizing:border-box;border:2px solid #4f8cff;border-radius:2px;background:rgba(79,140,255,.10)'
    const label = document.createElement('span')
    label.textContent = String(markers.length + 1)
    label.style.cssText = 'position:absolute;left:-1px;top:-18px;min-width:16px;height:16px;padding:0 4px;background:#4f8cff;color:#fff;font:11px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border-radius:8px;text-align:center;box-sizing:border-box'
    box.append(label)
    root.append(box)
    markers.push({ element, box })
    positionMarkers()
  }

  const clearMarkers = (): void => {
    markers.length = 0
    markerHost?.remove()
    markerHost = null
    markerRoot = null
  }

  const onOver = (event: Event): void => {
    if (!enabled) return
    const target = event.target
    if (!(target instanceof Element)) return
    const element = target.closest('body *')
    if (element === null || element === document.body) return
    if (element === hover) return
    clearHover()
    hover = element
    element.classList.add('dsh-wvp-hover')
  }

  const onOut = (): void => {
    if (enabled) clearHover()
  }

  const onClick = (event: MouseEvent): void => {
    if (!enabled) return
    const target = event.target
    if (!(target instanceof Element)) return
    const element = target.closest('body *')
    if (element === null || element === document.body) return
    event.preventDefault()
    event.stopPropagation()
    clearHover()
    clearActive()
    active = element
    element.classList.add('dsh-wvp-active')
    addMarker(element)
    const rect = element.getBoundingClientRect()
    const clone = stripInternal(element.cloneNode(true) as Element)
    const payload = {
      selector: selectorOf(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || undefined,
      classes: Array.from(element.classList).filter((name) => INTERNAL.indexOf(name) === -1).slice(0, 8),
      role: element.getAttribute('role') || undefined,
      text: String((element as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 600),
      html: (clone.outerHTML || '').slice(0, 3000),
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
      url: location.href,
    }
    const binding = w.__dshWebdevPick
    if (typeof binding === 'function') binding(JSON.stringify(payload))
    else console.log('__DSH_WEBDEV_PICK__' + JSON.stringify(payload))
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      enabled = false
      clearHover()
      clearActive()
      clearMarkers()
      document.documentElement.classList.remove('dsh-wvp-picking')
    }
  }

  document.addEventListener('mouseover', onOver, true)
  document.addEventListener('mouseout', onOut, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('keydown', onKey, true)
  document.addEventListener('scroll', positionMarkers, true)
  window.addEventListener('resize', positionMarkers)

  w.__dshWebdevPicker = {
    setEnabled(value: boolean): void {
      enabled = value
      document.documentElement.classList.toggle('dsh-wvp-picking', value)
      if (!value) {
        clearHover()
        clearActive()
        clearMarkers()
      }
    },
  }
}

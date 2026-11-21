// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * What a person typed into the panel's address bar.
 *
 * The desktop guest is an Electron `<webview>`: its embedder refuses a `file:`
 * navigation (`ERR_FAILED`), so a local page can only be shown there when the
 * host serves it from the private preview server. That decision needs the
 * caller to know "this is a local file and here is its path", which is what
 * this module answers — pure string work, so both halves compile it and the
 * browser bundle keeps no Node builtin.
 *
 * The three answers are deliberately narrow:
 *
 * - `web`: a URL with a scheme, passed to the browser as typed.
 * - `file`: an absolute local path, which only the host may serve.
 * - `text`: neither, so the caller keeps its previous behaviour (the guest
 *   reports its own failure) instead of guessing.
 *
 * @module dsh-webdev-viewer/core/local-path
 */

/** One parsed address-bar value. */
export type LocalTarget =
  /** A URL the browser can load itself. */
  | { readonly kind: 'web'; readonly url: string }
  /** An absolute local path plus the `file:` URL to show for it. */
  | { readonly kind: 'file'; readonly path: string; readonly displayUrl: string }
  /** Neither a URL nor an absolute path: the caller decides what to do. */
  | { readonly kind: 'text'; readonly value: string }

/** `C:\x` or `C:/x`. */
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/u

/** `\\server\share\x`. */
const UNC_ABSOLUTE = /^\\\\[^\\/]+[\\/][^\\/]+/u

/** `//server/share/x`, the forward-slash spelling of a UNC path. */
const UNC_FORWARD = /^\/\/[^/]+\/[^/]+/u

/** A `file:` URL, case-insensitively. */
const FILE_URL = /^file:/iu

/** Any other absolute URL: `https:`, `data:`, `about:`, `dsh-app:`. */
const ANY_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u

/** A drive letter at the front of a `file:` URL pathname. */
const URL_DRIVE = /^\/([a-zA-Z]:)[\\/]/u

/**
 * Strip what a paste adds around a path.
 * @param input - raw address-bar text.
 * @returns the value without quotes, padding, or a `\\?\` prefix.
 */
export function stripPathInput(input: string): string {
  let value = input.trim()
  if (value.length >= 2) {
    const first = value[0]
    const last = value[value.length - 1]
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) value = value.slice(1, -1).trim()
  }
  // The Windows long-path prefix is not part of the path itself.
  if (value.startsWith('\\\\?\\')) value = value.slice(4)
  return value
}

/**
 * The `file:` URL for one absolute path, for display only.
 *
 * Kept independent of `node:url` so the panel can render it: the client bundle
 * has no Node builtins, and this value never travels back to the host.
 * @param path - absolute Windows, UNC, or POSIX path.
 * @returns the `file:` URL with every segment percent-encoded.
 */
export function fileUrlOfPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  if (normalized.startsWith('//')) {
    const [host = '', ...rest] = normalized.slice(2).split('/')
    return `file://${host}/${rest.map(encodeURIComponent).join('/')}`
  }
  const drive = URL_DRIVE.exec(normalized) ?? /^([a-zA-Z]:)\//u.exec(normalized)
  if (drive !== null) {
    const rest = normalized.slice(drive[0].length).split('/').filter(segment => segment.length > 0)
    return `file:///${drive[1]}/${rest.map(encodeURIComponent).join('/')}`
  }
  const segments = normalized.split('/').filter(segment => segment.length > 0)
  return `file:///${segments.map(encodeURIComponent).join('/')}`
}

/**
 * Read a `file:` URL back into an absolute path.
 * @param value - `file:` URL as typed or pasted.
 * @returns the path, or undefined when the URL cannot name one.
 */
export function pathOfFileUrl(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'file:') return undefined
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return undefined
  }
  if (pathname === '') return undefined
  if (url.host !== '' && url.host !== 'localhost') {
    // `file://server/share/x` is a UNC path, not a drive path.
    return `\\\\${url.host}${pathname.replace(/\//g, '\\')}`
  }
  // `file://` and `file:///` name a directory root, not a page to show.
  if (pathname === '/') return undefined
  const drive = URL_DRIVE.exec(pathname)
  if (drive !== null) return `${drive[1]}\\${pathname.slice(drive[0].length).replace(/\//g, '\\')}`
  return pathname
}

/**
 * Parse one address-bar value.
 * @param input - raw text the person typed or pasted.
 * @returns what the caller should do with it.
 */
export function parseLocalTarget(input: string): LocalTarget {
  const value = stripPathInput(input)
  if (value === '') return { kind: 'text', value: '' }
  if (FILE_URL.test(value)) {
    const path = pathOfFileUrl(value)
    if (path !== undefined) return { kind: 'file', path, displayUrl: fileUrlOfPath(path) }
    return { kind: 'text', value }
  }
  if (WINDOWS_ABSOLUTE.test(value) || UNC_ABSOLUTE.test(value)) {
    return { kind: 'file', path: value, displayUrl: fileUrlOfPath(value) }
  }
  // A POSIX absolute path is a file; `//host/share` is the UNC spelling, and
  // `//` alone has no meaning the viewer should invent.
  if (value.startsWith('/') && !value.startsWith('//')) {
    return { kind: 'file', path: value, displayUrl: fileUrlOfPath(value) }
  }
  if (UNC_FORWARD.test(value)) return { kind: 'file', path: value.replace(/\//g, '\\'), displayUrl: fileUrlOfPath(value) }
  if (ANY_SCHEME.test(value)) {
    try {
      return { kind: 'web', url: new URL(value).href }
    } catch {
      return { kind: 'text', value }
    }
  }
  return { kind: 'text', value }
}

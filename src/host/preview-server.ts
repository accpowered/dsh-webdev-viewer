// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Per-preview static HTTP server.
 *
 * One server serves one workspace root on its own loopback port. The first
 * navigation carries a one-time token; it is exchanged for a unique HttpOnly
 * cookie and a 303 to the requested entry document. Every later request needs
 * that cookie, including assets, because workspace bytes are not public. The
 * server injects a small live-reload script into HTML and watches the root.
 *
 * Containment is deliberately paranoid: this process can read the whole disk,
 * and the page it serves is untrusted code. The path is decoded once, rejected
 * on structural hazards, resolved lexically under the root, checked with
 * lstat/realpath, and rejected again if the canonical target leaves the root.
 * Symlinks and junctions are not served.
 *
 * @module dsh-webdev-viewer/host/preview-server
 */
import { createReadStream, promises as fs, watch, type FSWatcher } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { extname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path'

/** One running preview. */
export interface PreviewHandle {
  /** Opaque id; also the cookie suffix. */
  readonly id: string
  /** URL that sets the cookie and redirects to the entry. */
  readonly url: string
  /** Absolute, real path of the served root. */
  readonly root: string
  /** Bound loopback port. */
  readonly port: number
  /** Stop the server, watcher, and live-reload clients. */
  close(): Promise<void>
}

/** Options for one preview. */
export interface PreviewOptions {
  /** Workspace directory to serve. */
  readonly root: string
  /** URL path of the entry document; defaults to `/`. */
  readonly entry?: string
}

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.wasm': 'application/wasm',
}

/** Path segments that are never part of a preview. */
const IGNORED_SEGMENTS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'out', 'coverage', 'target', 'vendor', '.cache'])

/** Win32 device names must not resolve to a device even under a root. */
const DEVICE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Bootstrap path; the only unauthenticated route. */
const BOOTSTRAP_PATH = '/__dsh_webdev_bootstrap'

/** Live-reload event stream. */
const EVENTS_PATH = '/__dsh_webdev_events'

/** Bounded HTML read for injection. */
const HTML_INJECT_LIMIT = 4 * 1024 * 1024

/** Debounce for watcher bursts. */
const RELOAD_DEBOUNCE_MS = 200

/** Poll interval when recursive fs.watch is unavailable. */
const POLL_INTERVAL_MS = 1000

/**
 * Decode and structure-check one request path.
 * @param pathname - URL pathname, percent-encoded once.
 * @returns path segments, or undefined for a structurally unsafe path.
 */
export function parsePreviewSegments(pathname: string): string[] | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined
  const segments: string[] = []
  for (const raw of decoded.split('/')) {
    if (raw === '' || raw === '.') continue
    // Windows treats a trailing dot/space as an alias and a colon as an
    // alternate data stream or drive separator; neither belongs in a URL path.
    if (raw === '..' || raw.includes(':') || /[. ]$/.test(raw) || DEVICE_NAME.test(raw)) return undefined
    if (IGNORED_SEGMENTS.has(raw)) return undefined
    segments.push(raw)
  }
  return segments
}

/**
 * Whether `child` is inside `parent` (canonical paths, case-insensitive on win32).
 * @param parent - canonical root.
 * @param child - canonical candidate.
 * @returns true when the candidate is the root or below it.
 */
export function isInside(parent: string, child: string): boolean {
  const root = resolve(parent)
  const target = resolve(child)
  const caseFold = process.platform === 'win32' ? (value: string): string => value.toLowerCase() : (value: string): string => value
  if (caseFold(target) === caseFold(root)) return true
  const prefix = root.endsWith(sep) ? root : root + sep
  return caseFold(target).startsWith(caseFold(prefix))
}

/**
 * Refuse preview roots that must never be served.
 * @param root - candidate root.
 * @throws when the root is a drive/filesystem root or the user's home directory.
 */
export function assertPreviewRoot(root: string): void {
  const canonical = resolve(root)
  if (parse(canonical).root === canonical) throw new Error('refusing to preview a filesystem root')
  if (canonical === resolve(homedir())) throw new Error('refusing to preview the home directory itself')
}

/**
 * Resolve one request path to a regular file under the root.
 * @param root - canonical root.
 * @param pathname - URL pathname.
 * @returns the canonical file path, or undefined when the request must not be served.
 */
export async function resolvePreviewFile(root: string, pathname: string): Promise<string | undefined> {
  const segments = parsePreviewSegments(pathname)
  if (segments === undefined) return undefined
  const lexical = resolve(root, ...segments)
  if (!isInside(root, lexical)) return undefined
  let stat
  try {
    stat = await fs.lstat(lexical)
  } catch {
    return undefined
  }
  // A symlink or junction is an escape hatch even when its target looks inside:
  // the link can be swapped after the check. Preview files are static; refuse.
  if (stat.isSymbolicLink()) return undefined
  try {
    const canonical = await fs.realpath(lexical)
    if (!isInside(root, canonical)) return undefined
    const final = await fs.stat(canonical)
    if (final.isDirectory()) {
      const index = join(canonical, 'index.html')
      const indexStat = await fs.stat(index)
      if (!indexStat.isFile()) return undefined
      return index
    }
    return final.isFile() ? canonical : undefined
  } catch {
    return undefined
  }
}

/** Inject the live-reload script before `</body>` when possible. */
function injectLiveReload(html: string): string {
  const script = `<script>(()=>{const s=new EventSource('${EVENTS_PATH}');s.onmessage=(e)=>{if(e.data==='reload')location.reload()}})();</script>`
  const index = html.toLowerCase().lastIndexOf('</body>')
  return index < 0 ? `${html}${script}` : `${html.slice(0, index)}${script}${html.slice(index)}`
}

/** Read one cookie value from a Cookie header. */
function cookieValue(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return undefined
}

/** Bounded recursive file snapshot for the poll fallback. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORED_SEGMENTS.has(entry.name)) continue
      const absolute = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(absolute)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(absolute)
          snapshot.set(absolute, `${stat.mtimeMs}:${stat.size}`)
        } catch {
          // A file removed mid-walk is not a preview failure.
        }
      }
    }
  }
  await walk(root)
  return snapshot
}

/**
 * Start one preview server.
 * @param options - root and optional entry.
 * @returns the running handle.
 */
export async function startPreview(options: PreviewOptions): Promise<PreviewHandle> {
  const root = await fs.realpath(options.root)
  assertPreviewRoot(root)
  const stat = await fs.stat(root)
  if (!stat.isDirectory()) throw new Error('the preview root is not a directory')
  const entry = options.entry !== undefined && options.entry.startsWith('/') ? options.entry : '/'
  const id = randomBytes(9).toString('base64url')
  const token = randomBytes(24).toString('base64url')
  const cookieName = `dsh-webdev-preview-${id}`
  const clients = new Set<ServerResponse>()
  let closed = false
  let debounce: NodeJS.Timeout | undefined
  let watcher: FSWatcher | undefined
  let poller: NodeJS.Timeout | undefined
  let lastSnapshot: Map<string, string> | undefined

  const notify = (): void => {
    if (closed || clients.size === 0) return
    if (debounce !== undefined) clearTimeout(debounce)
    debounce = setTimeout(() => {
      debounce = undefined
      for (const client of clients) {
        try {
          client.write('data: reload\n\n')
        } catch {
          clients.delete(client)
        }
      }
    }, RELOAD_DEBOUNCE_MS)
  }

  const startWatch = (): void => {
    try {
      watcher = watch(root, { recursive: true }, (_event, filename) => {
        if (filename !== null && IGNORED_SEGMENTS.has(String(filename).split(/[\\/]/)[0] ?? '')) return
        notify()
      })
      watcher.on('error', () => { /* poll fallback is armed below */ })
      return
    } catch {
      watcher = undefined
    }
    // Linux and any platform without recursive fs.watch: compare metadata.
    void snapshotTree(root).then((initial) => {
      lastSnapshot = initial
      poller = setInterval(() => {
        void snapshotTree(root).then((current) => {
          if (lastSnapshot !== undefined && [...current].some(([file, stamp]) => lastSnapshot?.get(file) !== stamp)) notify()
          lastSnapshot = current
        })
      }, POLL_INTERVAL_MS)
    })
  }

  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('preview failed')
    })
  })

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === BOOTSTRAP_PATH) {
      if (url.searchParams.get('token') !== token) {
        response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('invalid preview token')
        return
      }
      const destination = url.searchParams.get('entry')?.startsWith('/') === true ? url.searchParams.get('entry') as string : entry
      response.writeHead(303, {
        location: destination,
        'set-cookie': `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/`,
        'cache-control': 'no-store',
        'referrer-policy': 'no-referrer',
      })
      response.end()
      return
    }
    if (cookieValue(request.headers.cookie, cookieName) !== token) {
      response.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('preview cookie required')
      return
    }
    if (url.pathname === EVENTS_PATH) {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      })
      response.flushHeaders()
      response.write(': connected\n\n')
      clients.add(response)
      request.on('close', () => { clients.delete(response) })
      return
    }
    const file = await resolvePreviewFile(root, url.pathname === '/' ? `/${entry.replace(/^\/+/, '')}` : url.pathname)
    if (file === undefined) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
      response.end('not found')
      return
    }
    const mediaType = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'
    const headers = {
      'content-type': mediaType,
      'cache-control': 'no-store',
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    } as const
    if (request.method === 'HEAD') {
      response.writeHead(200, headers)
      response.end()
      return
    }
    if (mediaType.startsWith('text/html')) {
      const size = (await fs.stat(file)).size
      if (size <= HTML_INJECT_LIMIT) {
        const html = injectLiveReload(await fs.readFile(file, 'utf8'))
        response.writeHead(200, { ...headers, 'content-length': Buffer.byteLength(html) })
        response.end(html)
        return
      }
    }
    const stream = createReadStream(file)
    stream.on('error', () => { response.destroy() })
    response.writeHead(200, headers)
    stream.pipe(response)
  }

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => { resolveListen() })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
    throw new Error('the preview server did not bind a port')
  }
  startWatch()
  const url = `http://127.0.0.1:${address.port}${BOOTSTRAP_PATH}?token=${encodeURIComponent(token)}&entry=${encodeURIComponent(entry)}`
  return {
    id,
    url,
    root,
    port: address.port,
    async close(): Promise<void> {
      if (closed) return
      closed = true
      if (debounce !== undefined) clearTimeout(debounce)
      if (poller !== undefined) clearInterval(poller)
      watcher?.close()
      for (const client of clients) {
        try { client.end() } catch { /* already gone */ }
      }
      clients.clear()
      await new Promise<void>((resolveClose) => { server.close(() => { resolveClose() }) })
    },
  }
}

/** Type-only server alias for tests that construct a server-like stub. */
export type PreviewServer = Server

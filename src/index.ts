// Modified for dsh-webdev-viewer from @linxin666/dsh-client-ui-browser-view 0.4.19 (Apache-2.0). See NOTICE.
/**
 * Host loader entry for the webdev plugin — runs in the DSH host process.
 *
 * Mounts three surfaces and nothing else:
 *
 * - the status route and the panel WebSocket under /api/dsh-webdev-viewer,
 * - the twenty-four `webdev_*` agent tools,
 * - one lazily started Chromium that both share (src/host/service.ts).
 *
 * No system-prompt announcement: the repository requires an `announceToAgent`
 * switch (default off) before a plugin injects anything into every agent's
 * prompt, and this version ships no announcement at all, so there is no switch
 * to add yet. The tools describe themselves.
 *
 * Shutdown order matters: the service stops broadcasting and closes the panel
 * sockets first, then stops the screencast, then kills Chrome. A panel that
 * received a frame from an already-dying browser would show a frozen image and
 * no reason for it.
 *
 * @module dsh-webdev-viewer
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import { BrowserViewService, LIVENESS_INTERVAL_MS } from './host/service.ts'
import { resolveChromePath } from './core/chrome.ts'
import { makeRoutes } from './host/routes.ts'
import { createBrowserTools, type DurableImageRef } from './host/tools.ts'
import { createWorkspaceTools } from './host/workspace-tools.ts'
import { createDesktopTools } from './host/native-tools.ts'
import { WebdevWorkspace, type WorkspaceSubprocess } from './host/workspace.ts'
import { effectiveConfig, type Config as RuntimeConfig } from './host/config.ts'

export { Config } from './host/config.ts'
export type { ConfigInput, ResolvedConfig } from './host/config.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** Volatile settings committed without remounting this plugin row. */
    'loader/volatile-update'(paths: readonly (readonly string[])[]): void
  }
}

/** Stable cordis plugin name. */
export const name = 'webdev'

/** Services required before the routes and the tools can mount. */
export const inject = ['webServer', 'tools', 'subprocess']

/**
 * The attachment service as this package uses it. Typed structurally: the
 * attachment SDK package is not a dependency of this one, and the shape needed
 * here is one method.
 */
interface AttachmentStoreLike {
  saveImage(input: { data: Uint8Array; mediaType: string; name?: string }): Promise<DurableImageRef>
}

/**
 * The connection service as this package uses it. Typed structurally for the
 * same reason as the attachment store: the connection SDK package is not a
 * dependency of this one, and the shape needed here is the legacy
 * launch-token URL helper on hosts prior to peer-based auth providers.
 */
interface ConnectionLike {
  authenticatedUrl?(baseUrl: string): string
}

interface EntryUrlCandidate {
  readonly url?: string
  readonly open?: boolean
}

/** Minimal Cordis context surface needed to resolve an authenticated DSH URL. */
export interface AuthenticatedUrlContext {
  get?(name: string): unknown
  readonly webServer?: unknown
  emit?(subject: unknown, event: string, baseUrl: string, entries: EntryUrlCandidate[]): unknown
}

function readWebServer(ctx: AuthenticatedUrlContext): unknown {
  if (ctx.webServer !== undefined) return ctx.webServer
  if (typeof ctx.get !== 'function') return undefined
  try {
    return ctx.get('webServer')
  } catch {
    return undefined
  }
}

/**
 * Resolve the host's authenticated entry URL for `url` across SDK cohorts:
 * legacy hosts expose `connection.authenticatedUrl(url)`, while peer-auth
 * hosts collect entry URLs via `ctx.emit(webServer, 'webserver/entry-url', url, entries)`.
 */
export function resolveAuthenticatedUrl(ctx: AuthenticatedUrlContext, url: string): string | undefined {
  let connection: ConnectionLike | undefined
  if (typeof ctx.get === 'function') {
    try {
      connection = ctx.get('connection') as ConnectionLike | undefined
    } catch {
      connection = undefined
    }
  }
  if (connection !== undefined && typeof connection.authenticatedUrl === 'function') {
    try {
      return connection.authenticatedUrl(url)
    } catch {
      return undefined
    }
  }
  const webServer = readWebServer(ctx)
  if (webServer === undefined || typeof ctx.emit !== 'function') return undefined
  const entries: EntryUrlCandidate[] = []
  try {
    ctx.emit(webServer, 'webserver/entry-url', url, entries)
  } catch {
    return undefined
  }
  const preferred = entries.find((entry) => entry.open === true && typeof entry.url === 'string' && entry.url.length > 0)
  if (preferred?.url !== undefined) return preferred.url
  const fallback = entries.find((entry) => typeof entry.url === 'string' && entry.url.length > 0)
  return fallback?.url
}

/**
 * Mount the routes, the tools, and the browser lifetime.
 * @param ctx - host plugin context carrying webServer and tools.
 */
export function apply(ctx: Context, config?: RuntimeConfig): void {
  const service = new BrowserViewService({
    resolveConfig: () => {
      const value = effectiveConfig(config)
      return value.realBrowserEnabled
        ? { mode: 'cdp', cdpEndpoint: value.cdpEndpoint }
        : { mode: 'isolated' }
    },
    // Read per sweep, so a settings edit applies without a remount and without
    // reconnecting the browser: a threshold change is not a source change.
    idleCloseDays: () => effectiveConfig(config).idleCloseDays,
    // A browser closed behind an attached panel must become a visible
    // disconnect with Reconnect, not a frozen frame. Enabled here rather than
    // by default so unit tests never poll a real port.
    livenessIntervalMs: LIVENESS_INTERVAL_MS,
    // The panel only offers "Open in isolated Chromium" when this host can
    // really launch one; a missing binary is reported as not_installed instead.
    chromeAvailable: () => resolveChromePath() !== undefined,
    // Resolved per navigation, not at mount: the connection service owns the
    // process launch token, may mount after this plugin, and answers with a
    // URL that is only good for this process. A host that mounts none simply
    // keeps showing the authentication page.
    authenticatedUrl: (url: string) => resolveAuthenticatedUrl(ctx, url),
  })

  // Resolved per call, not at mount: the screenshot tool must see the
  // attachment service whenever the host happens to mount it.
  const saveImage = async (input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg'; name?: string }): Promise<DurableImageRef> => {
    const attachments = ctx.get('attachments') as AttachmentStoreLike | undefined
    if (attachments === undefined || typeof attachments.saveImage !== 'function') {
      throw new Error('webdev_screenshot needs the host attachment service to store the image; this host mounts none')
    }
    return await attachments.saveImage(input)
  }

  const { routes, upgrade } = makeRoutes({ backend: service })
  const workspace = new WebdevWorkspace({
    getRoot: () => {
      try {
        const policy = ctx.get('sandboxPolicy') as { workspaceRoot?: unknown } | undefined
        return typeof policy?.workspaceRoot === 'string' ? policy.workspaceRoot : undefined
      } catch {
        return undefined
      }
    },
    subprocess: (() => {
      try {
        const candidate = ctx.get('subprocess') as { spawn?: unknown } | undefined
        return candidate !== undefined && typeof candidate.spawn === 'function'
          ? candidate as unknown as WorkspaceSubprocess
          : undefined
      } catch {
        return undefined
      }
    })(),
    navigate: (sessionId, url) => service.navigate(sessionId, url),
  })
  const tools = [
    ...createBrowserTools({ service, saveImage }),
    ...createWorkspaceTools({ workspace }),
    ...createDesktopTools({ service, saveImage }),
  ]

  ctx.effect(() => {
    const disposers = routes.map(route => ctx.webServer.register(route))
    const upgradeDisposer = ctx.webServer.registerUpgrade(upgrade)
    return () => {
      for (const dispose of disposers) dispose()
      upgradeDisposer()
    }
  }, 'webdev: routes')

  ctx.effect(() => {
    const disposers = tools.map(tool => ctx.tools.register(tool))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'webdev: tools')

  // Volatile settings update in place. Dispose only the old browser attachment;
  // the next tool or panel action lazily uses the new source.
  ctx.effect(() => {
    const dispose = ctx.on('loader/volatile-update', paths => {
      if (paths.some(path => path[0] === 'realBrowserEnabled' || path[0] === 'cdpEndpoint')) {
        void service.reconfigure().catch(() => undefined)
      }
    })
    return () => { dispose() }
  }, 'webdev: settings')

  // One disposer for the whole runtime: stop previews/processes and the
  // browser in that order. A preview server left open is a listening socket
  // with a token; a process left running outlives the panel that asked for it.
  ctx.effect(() => () => {
    void workspace.dispose()
    void service.dispose()
  }, 'webdev: lifetime')
}

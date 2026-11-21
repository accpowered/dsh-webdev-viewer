// New test for dsh-webdev-viewer (Apache-2.0). See NOTICE.
// @vitest-environment node
/**
 * A local file reaches the browser as a loopback page, never as a `file:` URL:
 * the desktop guest refuses those. These tests pin the two facts the panel
 * relies on — the served page answers after the token exchange, and the address
 * shown for it is the path the person opened.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileUrlOfPath } from '../../src/core/local-path.ts'
import { WebdevWorkspace } from '../../src/host/workspace.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

/** One workspace whose root is the temp directory the test creates. */
async function tempWorkspace(): Promise<{ root: string; workspace: WebdevWorkspace }> {
  await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'local-'))
  roots.push(root)
  const workspace = new WebdevWorkspace({
    getRoot: () => root,
    navigate: async () => undefined,
  })
  return { root, workspace }
}

describe('serving a local file', () => {
  it('serves the file over loopback and reports the path to show', async () => {
    const { root, workspace } = await tempWorkspace()
    const file = join(root, 'matt-skills-guide.html')
    await writeFile(file, '<!doctype html><html><body><h1>guide</h1></body></html>')

    const served = await workspace.serveLocal(undefined, file)
    expect(served.displayUrl).toBe(fileUrlOfPath(file))
    expect(served.displayUrl.startsWith('file:///')).toBe(true)
    expect(served.root).toBe(root)
    expect(served.entry).toBe('/matt-skills-guide.html')

    // The token is exchanged for a cookie by whoever loads the URL — the CDP
    // tab, the desktop guest, or this test.
    const bootstrap = await fetch(served.entryUrl, { redirect: 'manual' })
    expect(bootstrap.status).toBe(303)
    const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0] ?? ''
    const page = await fetch(`http://127.0.0.1:${new URL(served.entryUrl).port}/matt-skills-guide.html`, {
      headers: { cookie },
    })
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('guide')
    await workspace.dispose()
  })

  it('serves the containing directory, so a sibling stylesheet loads', async () => {
    const { root, workspace } = await tempWorkspace()
    await writeFile(join(root, 'app.css'), 'h1 { color: red }')
    const file = join(root, 'page.html')
    await writeFile(file, '<!doctype html><html><head><link rel="stylesheet" href="app.css"></head><body>x</body></html>')

    const served = await workspace.serveLocal(undefined, file)
    const bootstrap = await fetch(served.entryUrl, { redirect: 'manual' })
    const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0] ?? ''
    const asset = await fetch(`http://127.0.0.1:${new URL(served.entryUrl).port}/app.css`, { headers: { cookie } })
    expect(asset.status).toBe(200)
    expect(await asset.text()).toContain('color: red')
    await workspace.dispose()
  })

  it('refuses a path outside the workspace when the caller asks for containment', async () => {
    const { root, workspace } = await tempWorkspace()
    const outside = await mkdtemp(join(process.cwd(), '.tmp', 'outside-'))
    roots.push(outside)
    const file = join(outside, 'secret.html')
    await writeFile(file, '<p>secret</p>')

    await expect(workspace.serveLocal(undefined, file, { withinWorkspace: true }))
      .rejects.toThrow(/outside the workspace/)
    // The person's own address-bar route is the one that may open it.
    await expect(workspace.serveLocal(undefined, file)).resolves.toMatchObject({ root: outside })
    await workspace.dispose()
  })

  it('reports a missing path instead of starting a server for it', async () => {
    const { root, workspace } = await tempWorkspace()
    await expect(workspace.serveLocal(undefined, join(root, 'nope.html')))
      .rejects.toThrow(/no such file or directory/)
    await workspace.dispose()
  })
})

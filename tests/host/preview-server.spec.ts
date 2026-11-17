// New test for dsh-webdev-viewer (Apache-2.0). See NOTICE.
// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { startPreview, type PreviewHandle } from '../../src/host/preview-server.ts'

const handles: PreviewHandle[] = []
const roots: string[] = []

afterEach(async () => {
  for (const handle of handles.splice(0)) await handle.close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('preview server', () => {
  it('exchanges a token for a scoped cookie and injects live reload', async () => {
    await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
    const root = await mkdtemp(join(process.cwd(), '.tmp', 'preview-'))
    roots.push(root)
    await writeFile(join(root, 'index.html'), '<!doctype html><html><body><h1>preview</h1></body></html>')
    const handle = await startPreview({ root })
    handles.push(handle)

    const bootstrap = await fetch(handle.url, { redirect: 'manual' })
    expect(bootstrap.status).toBe(303)
    const cookie = bootstrap.headers.get('set-cookie')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    const pair = cookie?.split(';')[0]
    expect(pair).toBeTruthy()

    const page = await fetch(`http://127.0.0.1:${handle.port}/`, { headers: { cookie: pair ?? '' } })
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    const body = await page.text()
    expect(body).toContain('preview')
    expect(body).toContain('__dsh_webdev_events')

    const denied = await fetch(`http://127.0.0.1:${handle.port}/`)
    expect(denied.status).toBe(401)
  })

  it('rejects traversal and a non-token bootstrap without serving bytes', async () => {
    await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
    const root = await mkdtemp(join(process.cwd(), '.tmp', 'preview-'))
    roots.push(root)
    await writeFile(join(root, 'index.html'), '<p>ok</p>')
    await writeFile(join(root, 'secret.txt'), 'secret')
    const handle = await startPreview({ root })
    handles.push(handle)

    const badBootstrap = await fetch(`http://127.0.0.1:${handle.port}/__dsh_webdev_bootstrap?token=wrong`)
    expect(badBootstrap.status).toBe(401)

    const bootstrap = await fetch(handle.url, { redirect: 'manual' })
    const pair = bootstrap.headers.get('set-cookie')?.split(';')[0] ?? ''
    const traversal = await fetch(`http://127.0.0.1:${handle.port}/..%2fpackage.json`, { headers: { cookie: pair } })
    expect(traversal.status).toBe(404)
    const secret = await fetch(`http://127.0.0.1:${handle.port}/secret.txt`, { headers: { cookie: pair } })
    expect(secret.status).toBe(200)
    expect(await secret.text()).toBe('secret')
  })

  it('refuses a filesystem root', async () => {
    await mkdir(join(process.cwd(), '.tmp'), { recursive: true })
    await expect(startPreview({ root: process.platform === 'win32' ? 'C:\\' : '/' })).rejects.toThrow()
  })
})

// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Workspace lifecycle for one DSH session: static preview, project detection,
 * project process, logs, and URL hand-off to the browser.
 *
 * The project-detection and log/URL-extraction shape are adapted from the
 * MIT-licensed host half of dsh-web-preview-panel 0.2.4. The transport is
 * deliberately different: this file serves through the plugin's loopback,
 * token-gated preview server and spawns through the host's subprocess service,
 * so the process tree stays owned by DSH and no workspace path becomes a DSH
 * web route.
 *
 * @module dsh-webdev-viewer/host/workspace
 */

import { promises as fsp } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { isInside, startPreview, type PreviewHandle } from './preview-server.ts'

/** Structural view of the host subprocess service. */
export interface WorkspaceSubprocess {
  spawn(options: {
    argv: string[]
    cwd: string
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs?: number
  }): WorkspaceProcess
}

/** Structural view of one subprocess handle. */
export interface WorkspaceProcess {
  collected?: {
    stdout?: { readFrom(offset: number): { text: string; nextOffset: number } }
    stderr?: { readFrom(offset: number): { text: string; nextOffset: number } }
  }
  done: Promise<unknown>
  terminate(): void
}

/** What one preview tool call returns. */
export interface PreviewResult {
  url: string
  root: string
  entry: string
  navigateError?: string
}

/** One project kind plus the command that starts it. */
export interface ProjectDetection {
  type: 'node' | 'rust' | 'go' | 'python' | 'static'
  name: string
  command?: string
}

/** One run's observable state. */
export interface ProjectRunStatus {
  running: boolean
  kind: string
  command: string
  url?: string
  exitCode?: number | null
  lines: string[]
}

interface RunState extends ProjectRunStatus {
  sessionId: string | undefined
  process: WorkspaceProcess
  interval?: NodeJS.Timeout
  stdoutOffset: number
  stderrOffset: number
  navigated?: string
}

/** Workspace callbacks and services. */
export interface WebdevWorkspaceOptions {
  /** Current workspace root; read lazily because the sandbox service may mount later. */
  getRoot: () => string | undefined
  /** Host subprocess service; absent hosts still get detection and preview. */
  subprocess?: WorkspaceSubprocess
  /** Host browser hand-off; failure is reported but does not hide the preview. */
  navigate: (sessionId: string | undefined, url: string) => Promise<unknown>
}

/** Package-manager command prefix for package.json scripts. */
function packageManager(dir: string, files: ReadonlySet<string>): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun'
  return 'npm'
}

/** Windows needs a shell for .cmd shims; POSIX gets /bin/sh. */
function shellArgv(command: string): string[] {
  return process.platform === 'win32'
    ? ['cmd.exe', '/d', '/s', '/c', command]
    : ['/bin/sh', '-c', command]
}

/** Strip ANSI so a coloured dev-server banner can still yield a URL. */
function plain(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, '')
}

/**
 * One workspace's previews and project processes, keyed by DSH session.
 */
export class WebdevWorkspace {
  private readonly options: WebdevWorkspaceOptions
  private readonly previews = new Map<string, PreviewHandle>()
  private readonly runs = new Map<string, RunState>()

  constructor(options: WebdevWorkspaceOptions) {
    this.options = options
  }

  /** Session key; anonymous callers share one workspace state. */
  private keyOf(sessionId: string | undefined): string {
    return sessionId ?? '__anonymous__'
  }

  /** Resolve the workspace root and canonicalize it. */
  private async root(root?: string): Promise<string> {
    const candidate = root ?? this.options.getRoot()
    if (candidate === undefined || candidate.length === 0) throw new Error('no workspace root is available')
    return await fsp.realpath(candidate)
  }

  /** Resolve one path under the workspace and refuse any escape. */
  private async resolveTarget(root: string | undefined, path: string | undefined): Promise<{ workspace: string; target: string; isFile: boolean }> {
    const workspace = await this.root(root)
    const candidate = path === undefined || path.length === 0 ? workspace : resolve(workspace, path)
    let target: string
    try {
      target = await fsp.realpath(candidate)
    } catch {
      throw new Error(`workspace path does not exist: ${path ?? '.'}`)
    }
    if (!isInside(workspace, target)) throw new Error('preview/run path is outside the workspace')
    const stat = await fsp.stat(target)
    if (!stat.isDirectory() && !stat.isFile()) throw new Error('preview/run path is not a file or directory')
    return { workspace, target, isFile: stat.isFile() }
  }

  /** Stop the preview bound to this session, if any. */
  private async closePreview(key: string): Promise<void> {
    const handle = this.previews.get(key)
    if (handle === undefined) return
    this.previews.delete(key)
    await handle.close().catch(() => undefined)
  }

  /**
   * Serve one file or directory over the private preview server and navigate
   * the session's browser to it.
   * @param sessionId - calling DSH session.
   * @param path - workspace-relative file or directory; default the root.
   * @param root - explicit workspace root from the agent session.
   * @returns the token URL and served root.
   */
  async preview(sessionId: string | undefined, path?: string, root?: string): Promise<PreviewResult> {
    const key = this.keyOf(sessionId)
    const { target, isFile } = await this.resolveTarget(root, path)
    const servedRoot = isFile ? dirname(target) : target
    const entry = isFile ? `/${encodeURIComponent(basename(target))}` : '/'
    await this.closePreview(key)
    const handle = await startPreview({ root: servedRoot, entry })
    this.previews.set(key, handle)
    let navigateError: string | undefined
    try {
      await this.options.navigate(sessionId, handle.url)
    } catch (error) {
      navigateError = error instanceof Error ? error.message : String(error)
    }
    return {
      url: handle.url,
      root: servedRoot,
      entry,
      ...navigateError === undefined ? {} : { navigateError },
    }
  }

  /**
   * Stop the preview for one session.
   * @param sessionId - calling DSH session.
   */
  async stopPreview(sessionId: string | undefined): Promise<void> {
    await this.closePreview(this.keyOf(sessionId))
  }

  /**
   * Detect the project kind under one workspace directory.
   * @param sessionId - calling DSH session.
   * @param path - workspace-relative directory or file.
   * @param root - explicit workspace root from the agent session.
   */
  async detect(sessionId: string | undefined, path?: string, root?: string): Promise<ProjectDetection> {
    const { target, isFile } = await this.resolveTarget(root, path)
    const dir = isFile ? dirname(target) : target
    let names: string[]
    try {
      names = await fsp.readdir(dir)
    } catch {
      return { type: 'static', name: '静态网页' }
    }
    const files = new Set(names)
    const has = (name: string): boolean => files.has(name)
    if (has('Cargo.toml')) return { type: 'rust', name: 'Rust 项目', command: 'cargo run' }
    if (has('package.json')) {
      try {
        const pkg = JSON.parse(await fsp.readFile(resolve(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, unknown> }
        const scripts = pkg.scripts ?? {}
        const script = ['dev', 'start', 'serve', 'preview'].find(name => typeof scripts[name] === 'string')
        if (script !== undefined) {
          const pm = packageManager(dir, files)
          return { type: 'node', name: 'Node 项目', command: `${pm} run ${script}` }
        }
      } catch {
        // A malformed package.json is still a Node project, but it has no
        // detected start command; the caller can pass one explicitly.
      }
      return { type: 'node', name: 'Node 项目' }
    }
    if (has('go.mod')) return { type: 'go', name: 'Go 项目', command: 'go run .' }
    if (has('manage.py')) {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      return { type: 'python', name: 'Django 项目', command: `${python} manage.py runserver 127.0.0.1:8081` }
    }
    if (has('app.py')) {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      return { type: 'python', name: 'Python 项目', command: `${python} app.py` }
    }
    if (has('pyproject.toml') || has('requirements.txt')) {
      const python = process.platform === 'win32' ? 'python' : 'python3'
      return { type: 'python', name: 'Python 项目', command: `${python} -m http.server 8081` }
    }
    return { type: 'static', name: '静态网页' }
  }

  /**
   * Start the detected project for one session.
   * @param sessionId - calling DSH session.
   * @param path - workspace-relative project directory.
   * @param override - explicit shell command overriding detection.
   * @param root - explicit workspace root from the agent session.
   * @returns the initial run status.
   */
  async run(sessionId: string | undefined, path?: string, override?: string, root?: string): Promise<ProjectRunStatus> {
    const key = this.keyOf(sessionId)
    const existing = this.runs.get(key)
    if (existing !== undefined && existing.running) return this.snapshot(existing)
    const subprocess = this.options.subprocess
    if (subprocess === undefined) throw new Error('the host subprocess service is not available; start the project manually')
    const { target, isFile } = await this.resolveTarget(root, path)
    const dir = isFile ? dirname(target) : target
    const detection = await this.detect(sessionId, path, root)
    const command = override?.trim() || detection.command
    if (command === undefined || command.length === 0) {
      throw new Error('no start command was detected; pass command explicitly')
    }
    let process_: WorkspaceProcess
    try {
      process_ = subprocess.spawn({
        argv: shellArgv(command),
        cwd: dir,
        stdio: { stdin: 'ignore', stdout: { maxBytes: 2_000_000 }, stderr: { maxBytes: 2_000_000 } },
        graceMs: 8000,
      })
    } catch (error) {
      throw new Error(`failed to start project: ${error instanceof Error ? error.message : String(error)}`)
    }
    const state: RunState = {
      running: true,
      kind: detection.type,
      command,
      lines: [],
      sessionId,
      process: process_,
      stdoutOffset: 0,
      stderrOffset: 0,
    }
    this.runs.set(key, state)
    state.interval = setInterval(() => { this.pump(key, state) }, 500)
    void process_.done.then((result) => {
      const exitCode = typeof result === 'object' && result !== null && 'exitCode' in result
        ? (result as { exitCode?: unknown }).exitCode
        : undefined
      state.running = false
      state.exitCode = typeof exitCode === 'number' ? exitCode : null
      if (state.interval !== undefined) clearInterval(state.interval)
      state.interval = undefined
      state.lines.push(`[process exited${state.exitCode === null ? '' : `: ${state.exitCode}`}]`)
      state.lines = state.lines.slice(-400)
    }).catch(() => {
      state.running = false
      state.exitCode = null
      if (state.interval !== undefined) clearInterval(state.interval)
      state.interval = undefined
    })
    return this.snapshot(state)
  }

  /** Read new process output, detect a local URL, and navigate once. */
  private pump(key: string, state: RunState): void {
    if (!state.running) return
    const append = (text: string | undefined, stream: 'out' | 'err'): void => {
      if (text === undefined || text.length === 0) return
      for (const line of text.split(/\r?\n/)) {
        if (line.trim().length > 0) state.lines.push(`${stream === 'err' ? '[stderr] ' : ''}${line}`)
      }
      state.lines = state.lines.slice(-400)
    }
    try {
      const stdout = state.process.collected?.stdout
      if (stdout !== undefined) {
        const read = stdout.readFrom(state.stdoutOffset)
        state.stdoutOffset = read.nextOffset
        append(read.text, 'out')
      }
      const stderr = state.process.collected?.stderr
      if (stderr !== undefined) {
        const read = stderr.readFrom(state.stderrOffset)
        state.stderrOffset = read.nextOffset
        append(read.text, 'err')
      }
    } catch {
      return
    }
    if (state.url !== undefined) return
    const text = plain(state.lines.join('\n'))
    const local = text.match(/(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]):(\d+)/i)
    const absolute = text.match(/https?:\/\/[A-Za-z0-9.:[\]-]+/i)
    const url = local !== null
      ? `http://localhost:${local[1]}`
      : absolute?.[0].replace(/[.,;:]$/, '')
    if (url === undefined) return
    state.url = url
    if (state.navigated === url) return
    state.navigated = url
    state.lines.push(`[webdev] page detected: ${url}`)
    state.lines = state.lines.slice(-400)
    void this.options.navigate(state.sessionId, url).catch(() => undefined)
    void key
  }

  /** Immutable copy of a run. */
  private snapshot(state: RunState): ProjectRunStatus {
    return {
      running: state.running,
      kind: state.kind,
      command: state.command,
      ...state.url === undefined ? {} : { url: state.url },
      ...state.exitCode === undefined ? {} : { exitCode: state.exitCode },
      lines: state.lines.slice(-150),
    }
  }

  /**
   * Current run status for one session.
   * @param sessionId - calling DSH session.
   */
  logs(sessionId: string | undefined): ProjectRunStatus {
    const state = this.runs.get(this.keyOf(sessionId))
    if (state === undefined) return { running: false, kind: '', command: '', lines: [] }
    return this.snapshot(state)
  }

  /**
   * Stop the session's project and preview.
   * @param sessionId - calling DSH session.
   */
  async stop(sessionId: string | undefined): Promise<void> {
    const key = this.keyOf(sessionId)
    const state = this.runs.get(key)
    if (state !== undefined) {
      this.runs.delete(key)
      if (state.interval !== undefined) clearInterval(state.interval)
      state.running = false
      try { state.process.terminate() } catch { /* already gone */ }
    }
    await this.closePreview(key)
  }

  /** Stop every preview and process this workspace owns. */
  async dispose(): Promise<void> {
    for (const key of [...this.previews.keys()]) await this.closePreview(key)
    for (const [key, state] of this.runs) {
      if (state.interval !== undefined) clearInterval(state.interval)
      state.running = false
      try { state.process.terminate() } catch { /* already gone */ }
      this.runs.delete(key)
    }
  }
}

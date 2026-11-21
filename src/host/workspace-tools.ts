// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Workspace tools: preview, run, stop, logs.
 *
 * These are separate from the browser tools because they own files and
 * processes rather than CDP tabs. The preview server is loopback-only,
 * token-gated, and rooted in the workspace; `webdev_run` executes a detected
 * project script (or an explicit command) through the host subprocess service,
 * so the process is killed with the plugin.
 *
 * @module dsh-webdev-viewer/host/workspace-tools
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ProjectRunStatus, WebdevWorkspace } from './workspace.ts'

/** What the workspace tools need. */
export interface WorkspaceToolDeps {
  workspace: WebdevWorkspace
}

/** One text block. */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Structured JSON rendered as the model-facing text block. */
function renderJson(value: unknown): ContentBlock[] {
  return text(JSON.stringify(value, null, 2))
}

/** Read the calling agent's session id. */
function sessionIdOf(exec: ToolRunContext): string | undefined {
  const agent = exec.agent as { session?: { id?: unknown } } | undefined
  const id = agent?.session?.id
  return typeof id === 'string' ? id : undefined
}

/** Read the session's validated working directory. */
function cwdOf(exec: ToolRunContext): string | undefined {
  const agent = exec.agent as { session?: { header?: { cwd?: unknown } } } | undefined
  const cwd = agent?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}

/** Strip null exitCode for the tool schema and add a summary. */
function runResult(status: ProjectRunStatus, summary: string): {
  running: boolean
  kind: string
  command: string
  url?: string
  exitCode?: number
  lines: string[]
  summary: string
} {
  return {
    running: status.running,
    kind: status.kind,
    command: status.command,
    ...status.url === undefined ? {} : { url: status.url },
    ...status.exitCode === undefined || status.exitCode === null ? {} : { exitCode: status.exitCode },
    lines: status.lines.slice(-80),
    summary,
  }
}

/**
 * Build the four workspace tools.
 * @param deps - the workspace lifecycle.
 * @returns tool definitions in registration order.
 */
export function createWorkspaceTools(deps: WorkspaceToolDeps): ToolDefinition[] {
  const { workspace } = deps

  const preview = defineTool({
    name: 'webdev_preview',
    description: 'Serve a workspace file or directory over a private loopback HTTP server and open it in the webdev browser tab. '
      + 'The server uses a random port, a one-time token exchanged for an HttpOnly cookie, and a path-containment check; only files under the current workspace are served. '
      + 'HTML gets a tiny live-reload script, so editing a static file refreshes the page. '
      + 'When path is omitted the workspace root is served; when it names a file, that file is the entry. '
      + 'This does not modify the page or the workspace. '
      + '中文触发词：预览本地网页、静态预览、热更新、打开工作区文件。',
    parameters: {
      path: {
        type: 'string',
        description: 'Workspace-relative file or directory. Omit to serve the workspace root. Absolute paths are accepted only when they stay inside the workspace.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true, description: 'Tokenized loopback URL; the hosted page reads it as a normal URL after the cookie exchange.' },
          displayUrl: { type: 'string', required: true, description: 'Address the panel shows for the page: the file: URL of the served entry.' },
          root: { type: 'string', required: true, description: 'Absolute directory being served.' },
          entry: { type: 'string', required: true, description: 'Entry path inside the served root.' },
          navigateError: { type: 'string', description: 'Set when the preview started but the browser could not be navigated.' },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const result = await workspace.preview(sessionIdOf(exec), args.path, cwdOf(exec))
      return {
        ...result,
        summary: `Previewing ${result.entry} from ${result.root} on port ${new URL(result.url).port}`,
      }
    },
  })

  const run = defineTool({
    name: 'webdev_run',
    description: 'Detect and start a project in the workspace (Node, Rust, Go, Python, or static) and watch its output for a local URL. '
      + 'When a localhost/127.0.0.1 URL appears, the browser tab is navigated to it automatically; use webdev_logs to read the tail and webdev_stop to stop it. '
      + 'Detection covers Cargo.toml, package.json scripts (dev/start/serve/preview), go.mod, manage.py, app.py, and Python requirements; package-manager lockfiles choose npm/pnpm/yarn/bun. '
      + 'Pass command to override detection, for example "pnpm run dev -- --host 127.0.0.1". The command runs in the workspace with a shell, so treat it as code execution. '
      + 'The host owns the process; stopping the plugin stops it too. '
      + '中文触发词：运行项目、启动开发服务器、跑起来、看日志、热更新。',
    parameters: {
      path: {
        type: 'string',
        description: 'Workspace-relative project directory. Omit to use the workspace root.',
      },
      command: {
        type: 'string',
        description: 'Explicit shell command overriding project detection. Runs with the project directory as cwd.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          running: { type: 'boolean', required: true },
          kind: { type: 'string', required: true },
          command: { type: 'string', required: true },
          url: { type: 'string', description: 'Local URL detected in output and opened in the browser.' },
          exitCode: { type: 'integer', description: 'Exit code after the process stops.' },
          lines: { type: 'array', items: { type: 'string' }, description: 'Tail of stdout/stderr.' },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const status = await workspace.run(sessionIdOf(exec), args.path, args.command, cwdOf(exec))
      return runResult(status, `Started ${status.command} (${status.kind})`)
    },
  })

  const stop = defineTool({
    name: 'webdev_stop',
    description: 'Stop the workspace project process and close its private preview for this session. Safe to call when nothing is running. '
      + '中文触发词：停止项目、关闭预览、结束开发服务器。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stopped: { type: 'boolean', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (_args, exec) => {
      await workspace.stop(sessionIdOf(exec))
      return { stopped: true, summary: 'Stopped the workspace project and preview' }
    },
  })

  const logs = defineTool({
    name: 'webdev_logs',
    description: 'Return the tail of the current workspace project process output, its detected local URL, kind, command, running state, and exit code. '
      + 'Logs are bounded; use it after webdev_run to see whether the server started or crashed. '
      + '中文触发词：看项目日志、运行日志、端口、启动失败。',
    parameters: {
      tail: {
        type: 'integer',
        description: 'Number of recent lines to return, 1–400; defaults to 120.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          running: { type: 'boolean', required: true },
          kind: { type: 'string', required: true },
          command: { type: 'string', required: true },
          url: { type: 'string' },
          exitCode: { type: 'integer' },
          lines: { type: 'array', items: { type: 'string' }, required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args, exec) => {
      const status = workspace.logs(sessionIdOf(exec))
      const tail = typeof args.tail === 'number' ? Math.max(1, Math.min(400, Math.trunc(args.tail))) : 120
      const lines = status.lines.slice(-tail)
      return runResult({ ...status, lines }, status.running ? 'Project is running' : 'Project is not running')
    },
  })

  return [preview, run, stop, logs]
}

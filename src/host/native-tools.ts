// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Tools for the desktop webview the user is actually looking at.
 *
 * These route through the panel socket to the Electron `<webview>` guest, not
 * through CDP. They exist because a Desktop panel can show a native guest while
 * the CDP tools still target the separate real-browser attachment. The agent
 * picks the family that matches the surface it is working on.
 *
 * @module dsh-webdev-viewer/host/native-tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { BrowserViewService } from './service.ts'
import type { DurableImageRef } from './tools.ts'

/** What the desktop tools need from the host. */
export interface DesktopToolDeps {
  service: BrowserViewService
  saveImage?: (input: { data: Uint8Array; mediaType: 'image/png' | 'image/jpeg'; name?: string }) => Promise<DurableImageRef>
}

/** One text block. */
function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

/** Structured JSON rendered as the model-facing text block. */
function renderJson(value: unknown): ContentBlock[] {
  return text(JSON.stringify(value, null, 2))
}

/** One snapshot node, mirroring the wire contract. */
const SNAPSHOT_NODE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ref: { type: 'integer', required: true, description: 'Pass it to webdev_desktop_click.' },
    tag: { type: 'string', required: true },
    id: { type: 'string' },
    classes: { type: 'array', items: { type: 'string' } },
    role: { type: 'string' },
    name: { type: 'string' },
    text: { type: 'string' },
    box: {
      type: 'object',
      additionalProperties: false,
      properties: {
        x: { type: 'number', required: true },
        y: { type: 'number', required: true },
        width: { type: 'number', required: true },
        height: { type: 'number', required: true },
      },
    },
    depth: { type: 'integer', required: true },
  },
} as const

/** File extension matching one screenshot media type. */
function extensionOf(mediaType: string): 'png' | 'jpg' {
  return mediaType === 'image/png' ? 'png' : 'jpg'
}

/**
 * Build the desktop-view tool family.
 * @param deps - the service plus the optional attachment sink.
 * @returns the tool definitions.
 */
export function createDesktopTools(deps: DesktopToolDeps): ToolDefinition[] {
  const { service } = deps

  const navigate = defineTool({
    name: 'webdev_desktop_navigate',
    description: 'Navigate the desktop webview the user sees in the right sidebar and report its settled URL/title. '
      + 'Use this, not webdev_navigate, when the panel is showing the desktop browser; the two tools target different page instances. '
      + 'The desktop guest renders natively and needs no CDP attachment. '
      + '中文触发词：打开网址、导航桌面视图。',
    parameters: {
      url: { type: 'string', required: true, description: 'Absolute URL to load in the desktop guest.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args) => {
      const result = await service.nativeNavigate(args.url)
      return { ...result, summary: `Navigated the desktop view to ${result.url}` }
    },
  })

  const snapshot = defineTool({
    name: 'webdev_desktop_snapshot',
    description: 'Snapshot the desktop webview the user sees in the right sidebar. '
      + 'Returns refs, tags, roles, names, text and boxes for the desktop guest, not the CDP attachment. '
      + 'Call it before webdev_desktop_click; refs belong to this observation. '
      + '中文触发词：看桌面页面结构、DOM 快照。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          tabId: { type: 'string', required: true },
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          nodes: { type: 'array', required: true, items: SNAPSHOT_NODE_SCHEMA },
          truncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async () => await service.nativeSnapshot(),
  })

  const click = defineTool({
    name: 'webdev_desktop_click',
    description: 'Click an element in the desktop webview the user sees, using a ref from webdev_desktop_snapshot, a CSS selector, or x/y. '
      + 'The click goes through the guest input channel (mouseDown/mouseUp), so focus and handlers behave normally. '
      + '中文触发词：点桌面页面、点击桌面元素。',
    parameters: {
      ref: { type: 'integer', description: 'Ref from the most recent webdev_desktop_snapshot.' },
      selector: { type: 'string', description: 'CSS selector when you do not need a snapshot.' },
      x: { type: 'number', description: 'Viewport x in CSS pixels.' },
      y: { type: 'number', description: 'Viewport y in CSS pixels.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { summary: { type: 'string', required: true } },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args) => ({ summary: await service.nativeClick({ ref: args.ref, selector: args.selector, x: args.x, y: args.y }) }),
  })

  const type = defineTool({
    name: 'webdev_desktop_type',
    description: 'Type text into the focused field of the desktop webview the user sees, optionally clicking a ref/selector first. '
      + 'Use webdev_desktop_press afterwards when the page needs Enter/Tab to commit. '
      + '中文触发词：在桌面视图输入、填写。',
    parameters: {
      text: { type: 'string', required: true, description: 'Text to insert.' },
      ref: { type: 'integer', description: 'Ref from the most recent webdev_desktop_snapshot.' },
      selector: { type: 'string', description: 'CSS selector when you do not need a snapshot.' },
      x: { type: 'number', description: 'Viewport x in CSS pixels.' },
      y: { type: 'number', description: 'Viewport y in CSS pixels.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { summary: { type: 'string', required: true } },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args) => ({
      summary: await service.nativeType({ ref: args.ref, selector: args.selector, x: args.x, y: args.y }, args.text),
    }),
  })

  const press = defineTool({
    name: 'webdev_desktop_press',
    description: 'Press one key in the desktop webview the user sees (Enter, Tab, Escape, Backspace, arrows, or a character). '
      + '中文触发词：桌面视图回车、按键。',
    parameters: {
      key: { type: 'string', required: true, description: 'Key name or one character.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { summary: { type: 'string', required: true } },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args) => ({ summary: await service.nativePress(args.key) }),
  })

  const scroll = defineTool({
    name: 'webdev_desktop_scroll',
    description: 'Scroll the desktop webview at a viewport point. Positive delta_y scrolls down. '
      + '中文触发词：桌面视图滚动。',
    parameters: {
      delta_y: { type: 'number', required: true, description: 'Vertical delta in CSS pixels; positive is down.' },
      delta_x: { type: 'number', description: 'Horizontal delta; defaults to 0.' },
      x: { type: 'number', description: 'Viewport x; defaults to 0.' },
      y: { type: 'number', description: 'Viewport y; defaults to 0.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { summary: { type: 'string', required: true } },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args) => ({
      summary: await service.nativeScroll(args.x ?? 0, args.y ?? 0, args.delta_x ?? 0, args.delta_y),
    }),
  })

  const consoleTool = defineTool({
    name: 'webdev_desktop_console',
    description: 'Return the console messages captured from the desktop webview the user sees. '
      + 'The guest ring is fed by the webview console-message event; use it for renderer logs and errors. '
      + '中文触发词：看桌面控制台、桌面报错。',
    parameters: {
      limit: { type: 'integer', description: 'Number of recent entries, 1–500; defaults to 100.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                level: { type: 'string', required: true },
                text: { type: 'string', required: true },
                at: { type: 'integer', required: true },
              },
            },
          },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args) => {
      const limit = typeof args.limit === 'number' ? Math.max(1, Math.min(500, Math.trunc(args.limit))) : 100
      const entries = await service.nativeConsole(limit)
      return { entries, summary: `${entries.length} desktop console entr${entries.length === 1 ? 'y' : 'ies'}` }
    },
  })

  const screenshot = defineTool({
    name: 'webdev_desktop_screenshot',
    description: 'Capture the desktop webview the user sees as an image and return the image. '
      + 'This is a capture of the native guest; use it when the user should see the page or when layout matters. '
      + '中文触发词：截图桌面视图、看页面画面。',
    parameters: {
      format: {
        type: 'string',
        enum: ['png'],
        description: 'Desktop capture is PNG (the guest exposes a PNG data URL).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          url: { type: 'string', required: true },
          title: { type: 'string', required: true },
          image: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              attachmentId: { type: 'string', required: true },
              mediaType: { type: 'string', required: true },
              bytes: { type: 'integer', required: true },
              width: { type: 'integer', required: true },
              height: { type: 'integer', required: true },
              name: { type: 'string' },
            },
          },
        },
      },
      render: (_args, value) => {
        const envelope = `<path>webdev:screenshot/${value.url === '' ? 'desktop' : 'desktop'}.${extensionOf(value.image.mediaType)}</path>
<type>image</type>
<content>
${value.image.mediaType} screenshot, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes
url: ${value.url}
title: ${value.title}
</content>`
        const block = { type: 'image', attachment: value.image } as unknown as ContentBlock
        return [...text(envelope), block]
      },
    },
    execute: async (args) => {
      const saveImage = deps.saveImage
      if (saveImage === undefined) throw new Error('webdev_desktop_screenshot needs the host attachment service')
      const format = 'png'
      const shot = await service.nativeScreenshot(format)
      const ref = await saveImage({
        data: Buffer.from(shot.data, 'base64'),
        mediaType: shot.mediaType,
        name: `webdev-desktop.${extensionOf(shot.mediaType)}`,
      })
      return {
        url: shot.url,
        title: shot.title,
        image: {
          attachmentId: ref.attachmentId,
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
          ...ref.name === undefined ? {} : { name: ref.name },
        },
      }
    },
  })

  return [navigate, snapshot, click, type, press, scroll, consoleTool, screenshot]
}

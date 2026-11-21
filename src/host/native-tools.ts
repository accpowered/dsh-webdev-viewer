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
const DEFAULT_STYLE_PROPERTIES = [
  'color',
  'background-color',
  'font-size',
  'padding',
  'margin',
  'border-radius',
] as const

/** Properties one `inspect` call probes on every candidate layer. */
const STYLE_INSPECT_PROPERTIES = [
  'border-radius',
  'background-color',
  'background-image',
  'box-shadow',
  'border',
  'padding',
  'position',
] as const

/** The four layers a composite widget can draw itself with. */
const STYLE_LAYERS = [
  { layer: 'self', relation: 'self' as const, pseudo: undefined },
  { layer: 'parent', relation: 'parent' as const, pseudo: undefined },
  { layer: '::before', relation: 'self' as const, pseudo: '::before' as const },
  { layer: '::after', relation: 'self' as const, pseudo: '::after' as const },
] as const

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
      + 'It cannot load a local file: its Electron embedder refuses file: navigations. For a local page use webdev_navigate, which serves it through the private preview server and the panel follows that tab. '
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

  const networkTool = defineTool({
    name: 'webdev_desktop_network',
    description: 'Return loaded-resource timings from the desktop webview the user sees. '
      + 'The webview tag exposes no request/response status or pending/failed events; this is a performance-resource list, not a full network log. '
      + 'Use the webdev_* CDP network tool when status codes matter. '
      + '中文触发词：桌面网络请求、资源列表。',
    parameters: {
      limit: { type: 'integer', description: 'Number of recent resource entries, 1–500; defaults to 100.' },
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
                url: { type: 'string', required: true },
                initiatorType: { type: 'string', required: true },
                duration: { type: 'integer', required: true },
                transferSize: { type: 'integer', required: true },
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
      const entries = await service.nativeNetwork(limit)
      return { entries, summary: `${entries.length} desktop resource entr${entries.length === 1 ? 'y' : 'ies'}` }
    },
  })

  const style = defineTool({
    name: 'webdev_desktop_style',
    description: 'Inspect or change styles in the desktop webview the user is looking at, live, and report the values. '
      + 'This is a temporary preview: inline styles or a marked stylesheet rule on this page instance only, never a source edit, and a reload or navigation discards it. '
      + 'Use action=inspect first when a composite widget does not respond to a change on the element itself: it reports the values of the element, its parent, and its ::before/::after layers, so you can see which layer draws the visual. '
      + 'Then set/reset that layer with relation="parent" and/or pseudo="::before"|"::after". action=get reads a layer without changing it. '
      + 'Take the selector from the element the user picked or from webdev_desktop_snapshot. '
      + '中文触发词：改样式看看、临时样式、圆角、颜色预览、前端效果调试、检查伪元素。',
    parameters: {
      selector: {
        type: 'string',
        required: true,
        description: 'CSS selector of the element in the desktop guest, e.g. from a pick or webdev_desktop_snapshot.',
      },
      action: {
        type: 'string',
        enum: ['get', 'set', 'reset', 'inspect'],
        description: 'Operation. Defaults to set when value is given, otherwise get. inspect probes self, parent, ::before and ::after.',
      },
      relation: {
        type: 'string',
        enum: ['self', 'parent'],
        description: 'Which element to target: the picked element (default) or its parent.',
      },
      pseudo: {
        type: 'string',
        enum: ['none', '::before', '::after'],
        description: 'Pseudo-element of the resolved element to target; none means the element itself.',
      },
      property: { type: 'string', description: 'CSS property to set/reset/get, e.g. border-radius, color, padding.' },
      value: { type: 'string', description: 'CSS value for set, e.g. "0" or "#ff0000".' },
      properties: {
        type: 'array',
        items: { type: 'string' },
        description: 'For get: properties to read. Defaults to color, background-color, font-size, padding, margin, border-radius.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          selector: { type: 'string', required: true },
          action: { type: 'string', required: true },
          relation: { type: 'string' },
          pseudo: { type: 'string' },
          property: { type: 'string' },
          value: { type: 'string' },
          before: { type: 'string' },
          after: { type: 'string' },
          values: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                property: { type: 'string', required: true },
                value: { type: 'string', required: true },
              },
            },
          },
          layers: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                layer: { type: 'string', required: true },
                values: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      property: { type: 'string', required: true },
                      value: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
          temporary: { type: 'boolean', required: true, description: 'Always true: the override lives on the page instance only and a reload discards it.' },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => renderJson(value),
    },
    execute: async (args) => {
      const selector = args.selector.trim()
      if (selector === '') throw new Error('webdev_desktop_style needs a selector')
      const action = args.action ?? (args.value === undefined ? 'get' : 'set')
      const relation = args.relation === 'parent' ? 'parent' as const : 'self' as const
      const pseudo = args.pseudo === '::before' || args.pseudo === '::after' ? args.pseudo : undefined
      const options = {
        ...relation === 'parent' ? { relation } : {},
        ...pseudo === undefined ? {} : { pseudo },
      }
      if (action === 'inspect') {
        const layers: Array<{ layer: string; values: Array<{ property: string; value: string }> }> = []
        for (const layer of STYLE_LAYERS) {
          try {
            const values = await service.nativeStyle(selector, STYLE_INSPECT_PROPERTIES, {
              ...layer.relation === 'parent' ? { relation: layer.relation } : {},
              ...layer.pseudo === undefined ? {} : { pseudo: layer.pseudo },
            })
            layers.push({
              layer: layer.layer,
              values: STYLE_INSPECT_PROPERTIES.map(property => ({ property, value: values[property] ?? '' })),
            })
          } catch {
            // A missing parent or a detached element is a layer with no answer,
            // not a reason to fail the whole inspection.
            layers.push({ layer: layer.layer, values: [] })
          }
        }
        return {
          selector,
          action,
          relation,
          ...pseudo === undefined ? {} : { pseudo },
          layers,
          temporary: true,
          summary: `Inspected self/parent/::before/::after of ${selector} in the desktop view`,
        }
      }
      if (action === 'get') {
        const properties = args.properties !== undefined && args.properties.length > 0
          ? args.properties
          : [...DEFAULT_STYLE_PROPERTIES]
        const values = await service.nativeStyle(selector, properties, options)
        return {
          selector,
          action,
          relation,
          ...pseudo === undefined ? {} : { pseudo },
          values: properties.map(property => ({ property, value: values[property] ?? '' })),
          temporary: true,
          summary: `Read ${properties.length} style value(s) of ${selector}${pseudo ?? ''}${relation === 'parent' ? ' (parent)' : ''} in the desktop view`,
        }
      }
      const property = args.property?.trim()
      if (property === undefined || property === '') {
        throw new Error(`webdev_desktop_style ${action} needs a CSS property`)
      }
      const layer = `${relation === 'parent' ? 'parent ' : ''}${selector}${pseudo ?? ''}`
      const before = (await service.nativeStyle(selector, [property], options))[property] ?? ''
      if (action === 'set') {
        if (args.value === undefined) throw new Error('webdev_desktop_style set needs a value')
        await service.nativeStyleSet(selector, property, args.value, options)
        const after = (await service.nativeStyle(selector, [property], options))[property] ?? ''
        service.noteStylePreview(`${layer} · ${property}: ${before === '' ? '(none)' : before} → ${after === '' ? '(none)' : after}`)
        return {
          selector,
          action,
          relation,
          ...pseudo === undefined ? {} : { pseudo },
          property,
          value: args.value,
          before,
          after,
          temporary: true,
          summary: `${property}: ${before === '' ? '(none)' : before} -> ${after === '' ? '(none)' : after} on ${layer} (temporary preview, not saved)`,
        }
      }
      await service.nativeStyleReset(selector, property, options)
      const after = (await service.nativeStyle(selector, [property], options))[property] ?? ''
      service.noteStylePreview(`${layer} · reset ${property}`)
      return {
        selector,
        action,
        relation,
        ...pseudo === undefined ? {} : { pseudo },
        property,
        before,
        after,
        temporary: true,
        summary: `reset ${property}: ${before === '' ? '(none)' : before} -> ${after === '' ? '(stylesheet value)' : after} on ${layer} (temporary preview)`,
      }
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

  return [navigate, snapshot, click, type, press, scroll, consoleTool, networkTool, style, screenshot]
}

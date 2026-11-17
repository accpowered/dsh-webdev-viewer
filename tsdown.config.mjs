import { clientBundle } from './shared/tsdown.client.mjs'

export default clientBundle('dsh-webdev-viewer', ['src/index.ts'], {
  libExternal: [/^@deepseek-ai\//],
})

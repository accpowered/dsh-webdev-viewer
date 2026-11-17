// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * Human input forwarding for the panel.
 *
 * The agent's action layer already dispatches trusted CDP input; the panel only
 * needs a generic path for the same primitives. Coordinates are viewport CSS
 * pixels, already mapped by the client from its rendered frame. Keyboard text
 * goes through the same keyDown/char/keyUp sequence the agent's `pressKey` uses
 * so pages that listen for key events behave the same for both callers.
 *
 * @module dsh-webdev-viewer/core/input
 */
import { keyDefinition } from './actions.ts'
import type { CdpTransport } from './cdp.ts'
import type { BrowserInputEvent } from './protocol.ts'
import type { TabManager } from './tabs.ts'

/** The collaborators one input event needs. */
export interface InputScope {
  /** Protocol transport shared with the tab manager. */
  transport: CdpTransport
  /** Tab bookkeeping and session lookup. */
  tabs: TabManager
}

const BUTTONS: Readonly<Record<string, number>> = { none: 0, left: 1, right: 2, middle: 4 }

/**
 * Forward one human input event to a tab.
 * @param scope - transport and tab manager.
 * @param tabId - target tab.
 * @param event - validated panel event.
 * @returns after the CDP command round-trip(s) settle.
 */
export async function dispatchInput(scope: InputScope, tabId: string, event: BrowserInputEvent): Promise<void> {
  const sessionId = scope.tabs.sessionOf(tabId)
  switch (event.type) {
    case 'mouse': {
      const button = event.button ?? 'left'
      const bit = BUTTONS[button] ?? 0
      const buttons = event.action === 'down' ? (event.buttons ?? bit) : event.action === 'up' ? 0 : (event.buttons ?? 0)
      await scope.transport.send('Input.dispatchMouseEvent', {
        type: event.action === 'move' ? 'mouseMoved' : event.action === 'down' ? 'mousePressed' : 'mouseReleased',
        x: event.x,
        y: event.y,
        button,
        buttons,
        clickCount: event.clickCount ?? 1,
        modifiers: event.modifiers ?? 0,
      }, sessionId)
      return
    }
    case 'wheel': {
      await scope.transport.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: event.x,
        y: event.y,
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        modifiers: event.modifiers ?? 0,
      }, sessionId)
      return
    }
    case 'key': {
      const source = event.key
      const definition = (() => {
        try {
          return keyDefinition(source)
        } catch {
          return { key: source, code: event.code ?? source, windowsVirtualKeyCode: 0, text: undefined }
        }
      })()
      const code = event.code ?? definition.code
      if (event.action === 'down') {
        // A modifier chord is a shortcut, not text: Ctrl+C must copy, not type "c".
        const text = (event.modifiers ?? 0) === 0 ? definition.text : undefined
        await scope.transport.send('Input.dispatchKeyEvent', {
          type: 'keyDown',
          key: definition.key,
          code,
          windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
          nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
          modifiers: event.modifiers ?? 0,
          ...text === undefined ? {} : { text },
        }, sessionId)
        if (text !== undefined) {
          await scope.transport.send('Input.dispatchKeyEvent', {
            type: 'char',
            key: definition.key,
            code,
            text,
            unmodifiedText: text,
            modifiers: event.modifiers ?? 0,
          }, sessionId)
        }
      } else {
        await scope.transport.send('Input.dispatchKeyEvent', {
          type: 'keyUp',
          key: definition.key,
          code,
          windowsVirtualKeyCode: definition.windowsVirtualKeyCode,
          nativeVirtualKeyCode: definition.windowsVirtualKeyCode,
          modifiers: event.modifiers ?? 0,
        }, sessionId)
      }
      return
    }
    case 'text': {
      await scope.transport.send('Input.insertText', { text: event.text }, sessionId)
      return
    }
  }
}

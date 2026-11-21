// New test for dsh-webdev-viewer (Apache-2.0). See NOTICE.
// @vitest-environment node
/**
 * The address bar has to tell three things apart: a URL the browser loads
 * itself, an absolute local path the host must serve, and text that is neither.
 * Each case below is a value a person really pastes.
 */
import { describe, expect, it } from 'vitest'
import { fileUrlOfPath, parseLocalTarget, pathOfFileUrl, stripPathInput } from '../../src/core/local-path.ts'

describe('parseLocalTarget', () => {
  it('keeps a web URL for the browser', () => {
    expect(parseLocalTarget('https://example.com/a?b=1')).toEqual({ kind: 'web', url: 'https://example.com/a?b=1' })
    expect(parseLocalTarget('about:blank')).toEqual({ kind: 'web', url: 'about:blank' })
    // The URL parser normalizes a data: payload, so only the decision matters.
    expect(parseLocalTarget('data:text/html,hi')).toMatchObject({ kind: 'web' })
  })

  it('reads a Windows path as a file and shows it as a file URL', () => {
    expect(parseLocalTarget('C:\\Users\\accpo\\guide.html')).toEqual({
      kind: 'file',
      path: 'C:\\Users\\accpo\\guide.html',
      displayUrl: 'file:///C:/Users/accpo/guide.html',
    })
    expect(parseLocalTarget('C:/Users/accpo/guide.html')).toEqual({
      kind: 'file',
      path: 'C:/Users/accpo/guide.html',
      displayUrl: 'file:///C:/Users/accpo/guide.html',
    })
  })

  it('survives a quoted paste and a long-path prefix', () => {
    expect(parseLocalTarget('"C:\\a b\\c.html"')).toMatchObject({ kind: 'file', path: 'C:\\a b\\c.html' })
    expect(parseLocalTarget('\\\\?\\C:\\a\\b.html')).toMatchObject({ kind: 'file', path: 'C:\\a\\b.html' })
    expect(stripPathInput('  C:\\a  ')).toBe('C:\\a')
  })

  it('reads a file URL back into the path it names', () => {
    expect(parseLocalTarget('file:///C:/Users/accpo/guide.html')).toEqual({
      kind: 'file',
      path: 'C:\\Users\\accpo\\guide.html',
      displayUrl: 'file:///C:/Users/accpo/guide.html',
    })
    expect(parseLocalTarget('FIle:///C:/a%20b/c.html')).toEqual({
      kind: 'file',
      path: 'C:\\a b\\c.html',
      displayUrl: 'file:///C:/a%20b/c.html',
    })
  })

  it('reads a UNC file URL as a UNC path', () => {
    expect(parseLocalTarget('file://server/share/x.html')).toEqual({
      kind: 'file',
      path: '\\\\server\\share\\x.html',
      displayUrl: 'file://server/share/x.html',
    })
    expect(parseLocalTarget('\\\\server\\share\\x.html')).toMatchObject({
      kind: 'file',
      path: '\\\\server\\share\\x.html',
    })
  })

  it('treats a POSIX absolute path as a file', () => {
    expect(parseLocalTarget('/home/me/x.html')).toEqual({
      kind: 'file',
      path: '/home/me/x.html',
      displayUrl: 'file:///home/me/x.html',
    })
    expect(parseLocalTarget('file:///home/me/x.html')).toEqual({
      kind: 'file',
      path: '/home/me/x.html',
      displayUrl: 'file:///home/me/x.html',
    })
  })

  it('leaves anything that is not a URL or an absolute path alone', () => {
    expect(parseLocalTarget('example.com/docs')).toEqual({ kind: 'text', value: 'example.com/docs' })
    expect(parseLocalTarget('   ')).toEqual({ kind: 'text', value: '' })
    expect(parseLocalTarget('file://')).toEqual({ kind: 'text', value: 'file://' })
  })
})

describe('fileUrlOfPath', () => {
  it('percent-encodes every segment', () => {
    expect(fileUrlOfPath('C:\\a b\\c#d?e.html')).toBe('file:///C:/a%20b/c%23d%3Fe.html')
    expect(fileUrlOfPath('/home/me/a b.html')).toBe('file:///home/me/a%20b.html')
  })

  it('round-trips through pathOfFileUrl', () => {
    const path = 'C:\\Users\\me\\a b\\x.html'
    const url = fileUrlOfPath(path)
    expect(pathOfFileUrl(url)).toBe(path)
  })
})

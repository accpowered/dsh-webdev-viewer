// New file for dsh-webdev-viewer (Apache-2.0). See NOTICE.
/**
 * The image-header reader that lets a screenshot verify itself.
 *
 * The field bug this guards against is a capture whose encoded size disagreed
 * with the viewport it claimed to show, reported as a normal success. Neither
 * PNG nor JPEG needs a decoder to answer, only a header walk.
 */

import { describe, expect, it } from 'vitest'
import { imageSizeOf } from '../../src/core/image-size.ts'

/** A minimal PNG header: signature, IHDR length/type, width, height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(32)
  bytes.set([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], 0)
  const view = new DataView(bytes.buffer)
  view.setUint32(8, 13) // IHDR payload length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

/** One JPEG marker segment: 0xFF, marker, length, payload. */
function segment(marker: number, payload: number[]): number[] {
  const length = payload.length + 2
  return [0xFF, marker, (length >> 8) & 0xFF, length & 0xFF, ...payload]
}

/** A JPEG carrying an APP0 segment before the frame header, as encoders emit. */
function jpegHeader(width: number, height: number): Uint8Array {
  const app0 = segment(0xE0, Array.from({ length: 16 }, () => 0x00))
  const sof0 = segment(0xC0, [
    8,
    (height >> 8) & 0xFF, height & 0xFF,
    (width >> 8) & 0xFF, width & 0xFF,
    3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
  ])
  return Uint8Array.from([0xFF, 0xD8, ...app0, ...sof0, 0xFF, 0xD9])
}

describe('size', () => {
  it('operator hands in a PNG and its IHDR size comes back', () => {
    // Given a PNG header for a 1343x939 image
    // When the size is read
    // Then both dimensions are reported
    expect(imageSizeOf(pngHeader(1343, 939))).toEqual({ width: 1343, height: 939 })
  })

  it('operator hands in a JPEG with an APP segment and the frame header size comes back', () => {
    // Given a JPEG whose first segment is not the frame header
    // When the size is read
    // Then the walk skips the APP0 segment and reports the frame size
    expect(imageSizeOf(jpegHeader(2014, 1408))).toEqual({ width: 2014, height: 1408 })
  })

  it('operator hands in bytes that are neither format and nothing is invented', () => {
    // Given random bytes and a truncated PNG
    // When the size is read
    // Then the answer is undefined rather than a wrong number
    expect(imageSizeOf(Uint8Array.from([1, 2, 3, 4]))).toBeUndefined()
    expect(imageSizeOf(pngHeader(10, 10).slice(0, 12))).toBeUndefined()
  })
})

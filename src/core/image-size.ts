/**
 * Pixel size of an encoded image, read from its own header.
 *
 * Why the host reads this itself: `Page.captureScreenshot` answers with a base64
 * blob and nothing else. The plan says what size that blob should be, and the
 * field's worst bug report was exactly the case where it was not — a capture
 * that came back at a different size than the viewport it claimed to show, with
 * no field saying so. Comparing the plan against the encoded header is the only
 * way to tell "the page is 1343 px wide" from "the image is 1251 px wide", and
 * it needs no image library: PNG and JPEG both state width and height in a fixed
 * header.
 *
 * @module dsh-webdev-viewer/core/image-size
 */

/** One decoded image size, in pixels. */
export interface ImageSize {
  /** Encoded width. */
  width: number
  /** Encoded height. */
  height: number
}

/** PNG magic bytes: `\x89PNG\r\n\x1a\n`. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] as const

/** Whether the buffer starts with the PNG signature. */
function isPng(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

/** Read one big-endian 32-bit value. */
function uint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3]
}

/** Read one big-endian 16-bit value. */
function uint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] << 8) + bytes[offset + 1]
}

/**
 * Read the size out of a PNG's IHDR chunk.
 * @param bytes - encoded PNG.
 * @returns the size, or undefined when the header is incomplete.
 */
function pngSize(bytes: Uint8Array): ImageSize | undefined {
  // signature (8) + length (4) + 'IHDR' (4) + width (4) + height (4)
  if (bytes.length < 24) return undefined
  const width = uint32(bytes, 16)
  const height = uint32(bytes, 20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/**
 * Walk a JPEG's marker segments until the frame header that states the size.
 *
 * Only the SOF markers carry dimensions, and the ones that do not (Huffman
 * tables, restart markers, standalone markers) have to be skipped by their own
 * length — an app segment of 64 KB sits before the frame header in most camera
 * and screen-capture encodes.
 * @param bytes - encoded JPEG.
 * @returns the size, or undefined when no frame header was found.
 */
function jpegSize(bytes: Uint8Array): ImageSize | undefined {
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xFF) {
      offset += 1
      continue
    }
    let marker = bytes[offset + 1]
    while (marker === 0xFF) {
      offset += 1
      if (offset + 1 >= bytes.length) return undefined
      marker = bytes[offset + 1]
    }
    // Standalone markers have no length field.
    if (marker === 0x01 || marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) {
      offset += 2
      continue
    }
    if (marker === 0xD9) return undefined
    if (offset + 4 >= bytes.length) return undefined
    const length = uint16(bytes, offset + 2)
    if (length < 2) return undefined
    const isFrameHeader = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC
    if (isFrameHeader) {
      if (offset + 9 >= bytes.length) return undefined
      const height = uint16(bytes, offset + 5)
      const width = uint16(bytes, offset + 7)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    offset += 2 + length
  }
  return undefined
}

/**
 * Read an encoded image's pixel size from its header.
 * @param bytes - encoded PNG or JPEG.
 * @returns the size, or undefined when the format is neither or the header is cut.
 */
export function imageSizeOf(bytes: Uint8Array): ImageSize | undefined {
  if (isPng(bytes)) return pngSize(bytes)
  if (bytes.length > 3 && bytes[0] === 0xFF && bytes[1] === 0xD8) return jpegSize(bytes)
  return undefined
}

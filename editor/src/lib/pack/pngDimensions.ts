import { unzlibSync } from "fflate";

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function readPngDimensions(buf: Uint8Array): { width: number; height: number } {
  if (buf.length < PNG_SIGNATURE.length) throw new Error("not a PNG");
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG");
  }
  if (buf.length < 24) throw new Error("truncated PNG buffer");
  // IHDR starts at offset 8: 4 bytes length, 4 bytes "IHDR", 4 bytes width, 4 bytes height
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getUint32(16, false); // big-endian
  const height = view.getUint32(20, false);
  return { width, height };
}

/**
 * Scans PNG pixel data to find `contentWidth` = (rightmost non-transparent column) + 1.
 *
 * This matches the value MC's bitmap font provider uses as the glyph advance before
 * adding its standard +1 spacing pixel. Storing this instead of the PNG header width
 * lets `TitleCompiler.estimateBodyWidth` emit exact cursor offsets for images with
 * transparent right padding (e.g. `generic_54.png` is 256 px wide but the chest
 * content ends at column 175 → advance 177, not 257).
 *
 * Supports 8-bit RGBA (colorType 6) and 8-bit gray+alpha (colorType 4).
 * For PNGs with no alpha channel every pixel is opaque, so contentWidth = header width.
 * Falls back to the header width on any parse or decompress error — never throws.
 */
export function readPngContentWidth(buf: Uint8Array): number {
  try {
    return _readPngContentWidth(buf);
  } catch {
    if (buf.length < 24) return 0;
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    return view.getUint32(16, false);
  }
}

function _readPngContentWidth(buf: Uint8Array): number {
  if (buf.length < 29) throw new Error("buffer too short");
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  const bitDepth = buf[24];
  const colorType = buf[25];

  // Only un-filter and scan for 8-bit images with an alpha channel.
  // colorType 6 = RGBA (4 bytes/px, alpha at index 3)
  // colorType 4 = gray+alpha (2 bytes/px, alpha at index 1)
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 4)) return width;

  const bpp = colorType === 6 ? 4 : 2;
  const alphaOff = bpp - 1;

  // Collect and concatenate IDAT chunks (PNG may split them across multiple chunks)
  let offset = 8;
  const parts: Uint8Array[] = [];
  while (offset + 12 <= buf.length) {
    const len = view.getUint32(offset, false);
    const type = view.getUint32(offset + 4, false);
    if (type === 0x49454e44) break; // IEND
    if (type === 0x49444154 && offset + 8 + len <= buf.length) {
      // IDAT
      parts.push(buf.subarray(offset + 8, offset + 8 + len));
    }
    offset += 12 + len;
  }
  if (parts.length === 0) return width;

  let total = 0;
  for (const p of parts) total += p.length;
  const compressed = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    compressed.set(p, pos);
    pos += p.length;
  }

  const raw = unzlibSync(compressed);

  const rowBytes = width * bpp;
  const stride = 1 + rowBytes;
  if (raw.length < stride * height) return width;

  // Un-filter each scanline and track the rightmost column with alpha > 0.
  const prev = new Uint8Array(rowBytes); // zero-initialized (row above first row)
  let rightmost = -1;

  for (let y = 0; y < height; y++) {
    if (rightmost === width - 1) break; // all columns known opaque, no need to scan more

    const filter = raw[y * stride];
    const src = y * stride + 1;
    const cur = new Uint8Array(rowBytes);

    for (let i = 0; i < rowBytes; i++) {
      const r = raw[src + i] as number;
      const a = i >= bpp ? (cur[i - bpp] as number) : 0; // left pixel, same channel
      const b = prev[i] as number; // above pixel, same channel
      const c = i >= bpp ? (prev[i - bpp] as number) : 0; // above-left pixel, same channel
      switch (filter) {
        case 0:
          cur[i] = r;
          break;
        case 1:
          cur[i] = (r + a) & 0xff;
          break;
        case 2:
          cur[i] = (r + b) & 0xff;
          break;
        case 3:
          cur[i] = (r + ((a + b) >> 1)) & 0xff;
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          cur[i] = (r + pred) & 0xff;
          break;
        }
        default:
          cur[i] = r;
      }
    }

    for (let x = width - 1; x > rightmost; x--) {
      if (cur[x * bpp + alphaOff] !== 0) {
        rightmost = x;
        break;
      }
    }

    prev.set(cur);
  }

  return rightmost + 1; // 0 if fully transparent, width if fully opaque
}

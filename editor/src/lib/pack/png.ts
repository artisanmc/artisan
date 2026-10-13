import { unzlibSync } from "fflate";
import { deflateRle } from "./deflateRle";

/**
 * PNG minimal, remplaçant navigateur de `pngjs` pour imageButtons et vanillaGui.
 *
 * Décodage : mêmes règles que `PNG.sync.read` de pngjs 7 — tous les types de
 * couleur, profondeurs 1/2/4/8/16, tRNS, Adam7 — vers du RGBA 8 bits.
 * Encodage : celui de `PNG.sync.write` (RGBA 8 bits, filtre choisi ligne par
 * ligne à la plus petite somme absolue, un seul IDAT, pas de gAMA) compressé
 * comme zlib le fait pour pngjs (deflateRle.ts) : les octets sont les mêmes.
 */
export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const IHDR = 0x49484452;
const PLTE = 0x504c5445;
const IDAT = 0x49444154;
const IEND = 0x49454e44;
const TRNS = 0x74524e53;

// Adam7 : départ et pas, en x puis en y, pour chacune des 7 passes.
const ADAM7 = [
  [0, 8, 0, 8],
  [4, 8, 0, 8],
  [0, 4, 4, 8],
  [2, 4, 0, 4],
  [0, 2, 2, 4],
  [1, 2, 0, 2],
  [0, 1, 1, 2],
] as const;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Uint8Array, start: number, end: number): number {
  let crc = -1;
  for (let i = start; i < end; i++) {
    crc = (CRC_TABLE[(crc ^ (bytes[i] as number)) & 0xff] as number) ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

export function createImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(4 * width * height) };
}

/** `PNG.bitblt` de pngjs : copie d'un rectangle, mêmes contrôles de bornes. */
export function bitblt(
  src: RgbaImage,
  dst: RgbaImage,
  srcX: number,
  srcY: number,
  width: number,
  height: number,
  deltaX: number,
  deltaY: number,
): void {
  if (
    srcX > src.width ||
    srcY > src.height ||
    srcX + width > src.width ||
    srcY + height > src.height
  ) {
    throw new Error("bitblt reading outside image");
  }
  if (
    deltaX > dst.width ||
    deltaY > dst.height ||
    deltaX + width > dst.width ||
    deltaY + height > dst.height
  ) {
    throw new Error("bitblt writing outside image");
  }
  for (let y = 0; y < height; y++) {
    const from = ((srcY + y) * src.width + srcX) * 4;
    dst.data.set(
      src.data.subarray(from, from + width * 4),
      ((deltaY + y) * dst.width + deltaX) * 4,
    );
  }
}

function paeth(left: number, above: number, upLeft: number): number {
  const p = left + above - upLeft;
  const pLeft = Math.abs(p - left);
  const pAbove = Math.abs(p - above);
  const pUpLeft = Math.abs(p - upLeft);
  if (pLeft <= pAbove && pLeft <= pUpLeft) return left;
  return pAbove <= pUpLeft ? above : upLeft;
}

interface Pass {
  width: number;
  height: number;
  x0: number;
  dx: number;
  y0: number;
  dy: number;
}

function passesOf(width: number, height: number, interlace: boolean): Pass[] {
  if (!interlace) return [{ width, height, x0: 0, dx: 1, y0: 0, dy: 1 }];
  const out: Pass[] = [];
  for (const [x0, dx, y0, dy] of ADAM7) {
    const w = Math.ceil((width - x0) / dx);
    const h = Math.ceil((height - y0) / dy);
    if (w > 0 && h > 0) out.push({ width: w, height: h, x0, dx, y0, dy });
  }
  return out;
}

export function decodePng(bytes: Uint8Array): RgbaImage {
  for (let i = 0; i < SIGNATURE.length; i++) {
    if (bytes[i] !== SIGNATURE[i]) throw new Error("Invalid file signature");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = -1;
  let interlace = false;
  const palette: number[][] = [];
  let transColor: number[] | null = null;
  const idat: Uint8Array[] = [];
  let ended = false;

  let pos = 8;
  while (!ended) {
    if (pos + 8 > bytes.length) throw new Error("truncated PNG");
    const length = view.getUint32(pos);
    const type = view.getUint32(pos + 4);
    const start = pos + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error("truncated PNG");
    if (colorType < 0 && type !== IHDR) throw new Error("Expected IHDR on beggining");
    if (crc32(bytes, pos + 4, end) !== view.getUint32(end)) throw new Error("Crc error");
    const data = bytes.subarray(start, end);
    if (type === IHDR) {
      width = view.getUint32(start);
      height = view.getUint32(start + 4);
      depth = data[8] as number;
      colorType = data[9] as number;
      if (![1, 2, 4, 8, 16].includes(depth)) throw new Error(`Unsupported bit depth ${depth}`);
      if (!(colorType in CHANNELS)) throw new Error("Unsupported color type");
      if (data[10] !== 0) throw new Error("Unsupported compression method");
      if (data[11] !== 0) throw new Error("Unsupported filter method");
      if (data[12] !== 0 && data[12] !== 1) throw new Error("Unsupported interlace method");
      interlace = data[12] === 1;
    } else if (type === PLTE) {
      for (let i = 0; i + 3 <= data.length; i += 3) {
        palette.push([data[i] as number, data[i + 1] as number, data[i + 2] as number, 0xff]);
      }
    } else if (type === TRNS) {
      if (colorType === 3) {
        if (palette.length === 0) throw new Error("Transparency chunk must be after palette");
        if (data.length > palette.length)
          throw new Error("More transparent colors than palette size");
        for (let i = 0; i < data.length; i++) (palette[i] as number[])[3] = data[i] as number;
      } else if (colorType === 0) {
        transColor = [view.getUint16(start)];
      } else if (colorType === 2) {
        transColor = [view.getUint16(start), view.getUint16(start + 2), view.getUint16(start + 4)];
      }
    } else if (type === IDAT) {
      if (colorType === 3 && palette.length === 0) throw new Error("Expected palette not found");
      idat.push(data);
    } else if (type === IEND) {
      ended = true;
    } else if (!(bytes[pos + 4]! & 0x20)) {
      throw new Error("Unsupported critical chunk type");
    }
    pos = end + 4;
  }
  if (pos !== bytes.length) throw new Error("unrecognised content at end of stream");

  let total = 0;
  for (const part of idat) total += part.length;
  const compressed = new Uint8Array(total);
  let offset = 0;
  for (const part of idat) {
    compressed.set(part, offset);
    offset += part.length;
  }
  const raw = unzlibSync(compressed);

  const channels = CHANNELS[colorType] as number;
  // Écart en octets avec le pixel de gauche : un pixel entier, ou un octet sous 8 bits.
  const left = depth >= 8 ? (channels * depth) / 8 : 1;
  const maxSample = 2 ** depth - 1;
  const samples = new Uint16Array(width * height * 4);
  const passes = passesOf(width, height, interlace);
  let rawPos = 0;
  for (const pass of passes) {
    const byteWidth = Math.ceil((pass.width * channels * depth) / 8);
    let prev: Uint8Array | null = null;
    for (let y = 0; y < pass.height; y++) {
      if (rawPos + byteWidth + 1 > raw.length) throw new Error("Ran out of data");
      const filter = raw[rawPos] as number;
      const line = new Uint8Array(byteWidth);
      for (let x = 0; x < byteWidth; x++) {
        const r = raw[rawPos + 1 + x] as number;
        const a = x >= left ? (line[x - left] as number) : 0;
        const b = prev ? (prev[x] as number) : 0;
        const c = prev && x >= left ? (prev[x - left] as number) : 0;
        if (filter === 0) line[x] = r;
        else if (filter === 1) line[x] = r + a;
        else if (filter === 2) line[x] = r + b;
        else if (filter === 3) line[x] = r + ((a + b) >> 1);
        else if (filter === 4) line[x] = r + paeth(a, b, c);
        else throw new Error(`Unrecognised filter type - ${filter}`);
      }
      rawPos += byteWidth + 1;
      prev = line;

      let bit = 0;
      const sample = () => {
        let v: number;
        if (depth === 16) v = ((line[bit >> 3] as number) << 8) | (line[(bit >> 3) + 1] as number);
        else if (depth === 8) v = line[bit >> 3] as number;
        else v = ((line[bit >> 3] as number) >> (8 - depth - (bit & 7))) & maxSample;
        bit += depth;
        return v;
      };
      const outY = pass.y0 + y * pass.dy;
      for (let x = 0; x < pass.width; x++) {
        const o = (outY * width + pass.x0 + x * pass.dx) * 4;
        if (channels <= 2) {
          const g = sample();
          samples[o] = g;
          samples[o + 1] = g;
          samples[o + 2] = g;
          samples[o + 3] = channels === 2 ? sample() : maxSample;
        } else {
          samples[o] = sample();
          samples[o + 1] = sample();
          samples[o + 2] = sample();
          samples[o + 3] = channels === 4 ? sample() : maxSample;
        }
      }
    }
  }
  // pngjs ignore un reste après la dernière ligne sans entrelacement, pas avec.
  if (interlace && rawPos !== raw.length) throw new Error("unrecognised content at end of stream");

  const out = createImage(width, height);
  for (let i = 0; i < samples.length; i += 4) {
    if (colorType === 3) {
      const color = palette[samples[i] as number];
      if (!color) throw new Error(`index ${samples[i]} not in palette`);
      out.data.set(color, i);
      continue;
    }
    const transparent =
      transColor !== null &&
      (transColor.length === 1
        ? transColor[0] === samples[i]
        : transColor[0] === samples[i] &&
          transColor[1] === samples[i + 1] &&
          transColor[2] === samples[i + 2]);
    for (let k = 0; k < 4; k++) {
      const v = transparent ? 0 : (samples[i + k] as number);
      out.data[i + k] = depth === 8 ? v : Math.floor((v * 255) / maxSample + 0.5);
    }
  }
  return out;
}

type FilterValue = (data: Uint8Array, pos: number, x: number, byteWidth: number) => number;

const FILTERS: FilterValue[] = [
  (d, p, x) => d[p + x] as number,
  (d, p, x) => (d[p + x] as number) - (x >= 4 ? (d[p + x - 4] as number) : 0),
  (d, p, x, w) => (d[p + x] as number) - (p > 0 ? (d[p + x - w] as number) : 0),
  (d, p, x, w) => {
    const left = x >= 4 ? (d[p + x - 4] as number) : 0;
    const up = p > 0 ? (d[p + x - w] as number) : 0;
    return (d[p + x] as number) - ((left + up) >> 1);
  },
  (d, p, x, w) => {
    const left = x >= 4 ? (d[p + x - 4] as number) : 0;
    const up = p > 0 ? (d[p + x - w] as number) : 0;
    const upLeft = p > 0 && x >= 4 ? (d[p + x - (w + 4)] as number) : 0;
    return (d[p + x] as number) - paeth(left, up, upLeft);
  },
];

function chunk(type: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  view.setUint32(4, type);
  out.set(data, 8);
  view.setUint32(out.length - 4, crc32(out, 4, out.length - 4));
  return out;
}

export function encodePng(image: RgbaImage): Uint8Array {
  const { width, height, data } = image;
  const byteWidth = width * 4;
  const filtered = new Uint8Array((byteWidth + 1) * height);
  let rawPos = 0;
  let sel = 0;
  for (let y = 0, pos = 0; y < height; y++, pos += byteWidth) {
    let min = Number.POSITIVE_INFINITY;
    FILTERS.forEach((filter, type) => {
      let sum = 0;
      for (let x = 0; x < byteWidth; x++) sum += Math.abs(filter(data, pos, x, byteWidth));
      if (sum < min) {
        sel = type;
        min = sum;
      }
    });
    filtered[rawPos++] = sel;
    const filter = FILTERS[sel] as FilterValue;
    for (let x = 0; x < byteWidth; x++) filtered[rawPos++] = filter(data, pos, x, byteWidth);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const parts = [
    new Uint8Array(SIGNATURE),
    chunk(IHDR, ihdr),
    chunk(IDAT, deflateRle(filtered)),
    chunk(IEND, new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

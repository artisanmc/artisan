// Is an uploaded zip a resource pack? Read from its end, without loading it: the end of central
// directory record, then the central directory, looking for `pack.mcmeta` at the root. Anything else
// (an archive of something else, a zip64, a truncated file) is refused: this bucket hosts packs only.

/** The end of central directory record is 22 bytes, followed by a comment of at most 65,535. */
export const TAIL_BYTES = 22 + 0xffff;
/** A pack's central directory: ~80 bytes per file, so this is over 100,000 files. */
export const MAX_DIRECTORY_BYTES = 8 * 1024 * 1024;

const EOCD = 0x06054b50;
const ENTRY = 0x02014b50;
const MARKER = "pack.mcmeta";

/** Where the central directory sits, from the last [tail] bytes of a zip of [size] bytes; null: not a zip we take. */
export function centralDirectory(tail: Uint8Array, size: number): { offset: number; length: number; entries: number } | null {
  const view = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  for (let i = tail.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) !== EOCD) continue;
    // A comment that runs past the end: this signature is inside the data, keep looking.
    if (i + 22 + view.getUint16(i + 20, true) !== tail.length) continue;
    const entries = view.getUint16(i + 10, true);
    const length = view.getUint32(i + 12, true);
    const offset = view.getUint32(i + 16, true);
    // zip64 markers: no pack needs one, and its records would need a second lookup.
    if (entries === 0xffff || length === 0xffffffff || offset === 0xffffffff) return null;
    if (entries === 0 || length > MAX_DIRECTORY_BYTES || offset + length > size) return null;
    return { offset, length, entries };
  }
  return null;
}

/** Whether a central directory lists `pack.mcmeta` at the root. */
export function listsPackMcmeta(directory: Uint8Array, entries: number): boolean {
  const view = new DataView(directory.buffer, directory.byteOffset, directory.byteLength);
  const decoder = new TextDecoder();
  let p = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > directory.length || view.getUint32(p, true) !== ENTRY) return false;
    const nameLength = view.getUint16(p + 28, true);
    const extraLength = view.getUint16(p + 30, true);
    const commentLength = view.getUint16(p + 32, true);
    if (p + 46 + nameLength > directory.length) return false;
    if (nameLength === MARKER.length && decoder.decode(directory.subarray(p + 46, p + 46 + nameLength)) === MARKER) return true;
    p += 46 + nameLength + extraLength + commentLength;
  }
  return false;
}

/** Reads [key] of [bucket] by ranges: at most 64 KiB and its central directory, whatever its size. */
export async function isResourcePack(bucket: R2Bucket, key: string, size: number): Promise<boolean> {
  if (size < 22) return false;
  const tailLength = Math.min(size, TAIL_BYTES);
  const tail = await bucket.get(key, { range: { offset: size - tailLength, length: tailLength } });
  if (!tail) return false;
  const directory = centralDirectory(new Uint8Array(await tail.arrayBuffer()), size);
  if (!directory) return false;
  const listing = await bucket.get(key, { range: { offset: directory.offset, length: directory.length } });
  if (!listing) return false;
  return listsPackMcmeta(new Uint8Array(await listing.arrayBuffer()), directory.entries);
}

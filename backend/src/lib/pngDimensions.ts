const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

export function readPngDimensions(buf: Uint8Array): { width: number; height: number } {
  if (buf.length < PNG_SIGNATURE.length) throw new Error("not a PNG");
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) throw new Error("not a PNG");
  }
  if (buf.length < 24) throw new Error("truncated PNG buffer");
  // IHDR starts at offset 8: 4 bytes length, 4 bytes "IHDR", 4 bytes width, 4 bytes height
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const width = view.getUint32(16, false);   // big-endian
  const height = view.getUint32(20, false);
  return { width, height };
}

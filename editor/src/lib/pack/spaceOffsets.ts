/**
 * Codepoints used by the `space` provider in the `artisan:default` font.
 * Each maps to a pixel advance (positive or negative). A greedy decomposition
 * by descending absolute value lets us shift the rendering cursor by any
 * integer in `[-511, +511]` using at most 9 chars.
 *
 * Reserved range: U+F800..U+F811 (Private Use Area, distinct from glyph
 * codepoints which live in U+E000..U+F7FF).
 *
 * Why U+F800 and not U+F900? U+F900..U+FAFF is the CJK Compatibility
 * Ideographs Unicode block, for which MC's default font has glyphs (Chinese
 * characters). Picking codepoints there means the client renders Chinese
 * chars before the `space` provider's advance ever applies. U+F800..U+F8FF
 * is still in the BMP Private Use Area (no vanilla glyph), so the override
 * works reliably.
 *
 * Ordering convention: positives ascending (1, 2, 4, ..., 256) at offsets
 * 0..8, then negatives descending in magnitude (-1, -2, ..., -256) at
 * offsets 9..17. The exact mapping is consumed both ways (encoder + decoder)
 * via `spaceOffsetTable()`, so as long as that table is the source of truth
 * the layout is irrelevant to callers.
 */
export const SPACE_OFFSET_CODEPOINT_START = 0xf800;

/**
 * Pixel advances supported by the space provider. The codepoint for each
 * entry is `SPACE_OFFSET_CODEPOINT_START + index`.
 *
 * Sum of positives = 511; sum of negatives = -511. The encoder therefore
 * supports offsets in `[-511, +511]` exactly.
 */
export const SPACE_OFFSET_ADVANCES: ReadonlyArray<number> = [
  1, 2, 4, 8, 16, 32, 64, 128, 256, -1, -2, -4, -8, -16, -32, -64, -128, -256,
];

/** Returns `{codepoint, advance}[]` — one entry per offset. */
export function spaceOffsetTable(): Array<{ codepoint: number; advance: number }> {
  return SPACE_OFFSET_ADVANCES.map((advance, i) => ({
    codepoint: SPACE_OFFSET_CODEPOINT_START + i,
    advance,
  }));
}

/**
 * Greedy decomposition: returns a string of UTF-16 chars (from the offset
 * codepoint range) that, when rendered with the space provider, advance
 * the cursor by exactly `pixels`. Returns "" for 0.
 *
 * Throws if `pixels` is not an integer or if its magnitude exceeds the
 * encoder's range (max = sum of positive advances = 511).
 */
export function encodeOffset(pixels: number): string {
  if (!Number.isInteger(pixels)) {
    throw new Error(`encodeOffset: expected integer, got ${pixels}`);
  }
  if (pixels === 0) return "";

  const table = spaceOffsetTable();
  // Pick the entries with the same sign as `pixels`, sorted by |advance| desc.
  const sameSign = table
    .filter(({ advance }) => (pixels > 0 ? advance > 0 : advance < 0))
    .sort((a, b) => Math.abs(b.advance) - Math.abs(a.advance));

  const maxMagnitude = sameSign.reduce((acc, { advance }) => acc + Math.abs(advance), 0);
  if (Math.abs(pixels) > maxMagnitude) {
    throw new Error(`encodeOffset: |${pixels}| exceeds encoder range ±${maxMagnitude}`);
  }

  let remaining = pixels;
  let out = "";
  for (const { codepoint, advance } of sameSign) {
    // Greedy: take this advance while it doesn't overshoot.
    while ((advance > 0 && remaining >= advance) || (advance < 0 && remaining <= advance)) {
      out += String.fromCodePoint(codepoint);
      remaining -= advance;
    }
  }
  // With powers-of-two and exact-sum checks, remaining must reach 0.
  if (remaining !== 0) {
    throw new Error(`encodeOffset: failed to decompose ${pixels} (remaining=${remaining})`);
  }
  return out;
}

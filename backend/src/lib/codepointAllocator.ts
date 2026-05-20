import { and, eq, isNotNull, max } from "drizzle-orm";
import { db } from "../db/index";
import { assets } from "../db/schema";

export const CODEPOINT_MIN = 0xE000;   // 57344
// We stop at U+F7FF (63487) and reserve U+F800..U+F8FF for the `space` provider
// codepoints (see lib/spaceOffsets.ts). Codepoints at or above U+F900 are
// intentionally NOT used: U+F900..U+FAFF is the CJK Compatibility Ideographs
// block and MC's default font has glyphs there, which would render as Chinese
// chars instead of letting bitmap providers apply.
export const CODEPOINT_MAX = 0xF7FF;   // 63487

/**
 * Returns the next free codepoint for glyphs of a given pack.
 * Strategy: pick max(codepoint) + 1, falling back to CODEPOINT_MIN if no glyphs exist.
 * Concurrent insert safety is handled by the unique constraint at the call site.
 */
export async function allocateCodepoint(packId: string): Promise<number> {
  const rows = await db
    .select({ max: max(assets.codepoint) })
    .from(assets)
    .where(and(eq(assets.packId, packId), isNotNull(assets.codepoint)));

  const current = rows[0]?.max ?? null;
  const next = current === null ? CODEPOINT_MIN : current + 1;
  if (next > CODEPOINT_MAX) {
    throw new Error("Codepoint range exhausted (U+E000–U+F7FF)");
  }
  return next;
}

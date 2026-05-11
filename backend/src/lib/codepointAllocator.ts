import { and, eq, isNotNull, max } from "drizzle-orm";
import { db } from "../db/index";
import { assets } from "../db/schema";

export const CODEPOINT_MIN = 0xE000;   // 57344
export const CODEPOINT_MAX = 0xF7FF;   // 63487 (we reserve U+F800–U+F8FF for Oraxen/Nexo)

/**
 * Returns the next free codepoint for glyphs of a given server_key.
 * Strategy: pick max(codepoint) + 1, falling back to CODEPOINT_MIN if no glyphs exist.
 * Concurrent insert safety is handled by the unique constraint at the call site.
 */
export async function allocateCodepoint(serverKeyId: string): Promise<number> {
  const rows = await db
    .select({ max: max(assets.codepoint) })
    .from(assets)
    .where(and(eq(assets.serverKeyId, serverKeyId), isNotNull(assets.codepoint)));

  const current = rows[0]?.max ?? null;
  const next = current === null ? CODEPOINT_MIN : current + 1;
  if (next > CODEPOINT_MAX) {
    throw new Error("Codepoint range exhausted (U+E000–U+F7FF)");
  }
  return next;
}

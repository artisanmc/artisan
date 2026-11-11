/**
 * The codepoint range reserved for a Project's glyphs.
 *
 * It stops at U+F7FF: U+F800..U+F8FF belongs to the `space` providers
 * (`lib/spaceOffsets.ts`) and U+F900+ to the CJK Compatibility Ideographs
 * block, where Minecraft's default font already has glyphs — a bitmap
 * provider would not take over there, and the player would see ideographs.
 */
export const CODEPOINT_MIN = 0xe000; // 57344
export const CODEPOINT_MAX = 0xf7ff; // 63487

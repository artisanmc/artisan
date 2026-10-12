/**
 * La plage de codepoints réservée aux glyphes d'un Project.
 *
 * On s'arrête à U+F7FF : U+F800..U+F8FF appartient aux providers `space`
 * (`lib/spaceOffsets.ts`) et U+F900+ au bloc CJK Compatibility Ideographs, où la
 * police par défaut de Minecraft a déjà des glyphes — un bitmap provider n'y
 * prendrait pas la main, et le joueur verrait des idéogrammes.
 *
 * Ces bornes vivaient dans `codepointAllocator` (allocateur SQL, mort avec la
 * table) ; elles n'ont rien à voir avec le stockage, elles décrivent Minecraft.
 */
export const CODEPOINT_MIN = 0xe000; // 57344
export const CODEPOINT_MAX = 0xf7ff; // 63487

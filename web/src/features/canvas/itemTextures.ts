/**
 * Vanilla Minecraft item textures bundled at build-time via Vite's
 * `import.meta.glob`. Filenames are lower_snake_case (e.g. diamond.png),
 * material names in our domain are UPPER_SNAKE_CASE (e.g. DIAMOND), so we
 * uppercase the basename to build the lookup.
 *
 * Add a new texture by dropping it into `src/assets/minecraft/items/` —
 * Vite picks it up automatically on the next build.
 */
const modules = import.meta.glob<{ default: string }>("@/assets/minecraft/items/*.png", {
  eager: true,
});

const TEXTURES: Record<string, string> = {};
for (const [path, mod] of Object.entries(modules)) {
  const m = path.match(/items\/([a-z_0-9]+)\.png$/);
  if (!m || !m[1]) continue;
  TEXTURES[m[1].toUpperCase()] = mod.default;
}

export const itemTextureUrl = (material: string): string | undefined =>
  TEXTURES[material.toUpperCase()];

/** Sorted list of all materials that have a bundled texture. */
export const knownMaterials = (): string[] => Object.keys(TEXTURES).sort();

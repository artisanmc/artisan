/**
 * Per-item color palettes for the pixel sprite renderer.
 * Each palette is [primary, mid, dark, accent].
 * A sprite's pixel grid references these by 1-based index (0 = transparent).
 *
 * Adding a new item: drop a 4-color palette here, then add an 8x8 pixel grid
 * to itemPixels.ts. Both maps are looked up by the same icon name.
 */
export const SPRITE_PALETTES: Record<string, [string, string, string, string]> =
  {
    diamond_sword: ['#5DECF5', '#2BB8C2', '#1A7C84', '#8B5A2B'],
    iron_sword: ['#D8D8D8', '#9A9A9A', '#5C5C5C', '#8B5A2B'],
    netherite_sword: ['#4A3F3D', '#2D2725', '#1A1614', '#8B5A2B'],
    bow: ['#A86B3D', '#7A4A26', '#E8D8A8', '#5C3A1E'],
    crossbow: ['#8B5A2B', '#5C3A1E', '#D8D8D8', '#3A2510'],
    trident: ['#3FA2B8', '#1F5F70', '#8B5A2B', '#0F2F38'],
    diamond_pickaxe: ['#5DECF5', '#2BB8C2', '#8B5A2B', '#5C3A1E'],
    iron_pickaxe: ['#D8D8D8', '#9A9A9A', '#8B5A2B', '#5C3A1E'],
    netherite_pickaxe: ['#4A3F3D', '#2D2725', '#8B5A2B', '#5C3A1E'],
    iron_axe: ['#D8D8D8', '#9A9A9A', '#8B5A2B', '#5C3A1E'],
    diamond_axe: ['#5DECF5', '#2BB8C2', '#8B5A2B', '#5C3A1E'],
    shears: ['#D8D8D8', '#9A9A9A', '#5C5C5C', '#3A3A3A'],
    shield: ['#8B5A2B', '#D8D8D8', '#5C3A1E', '#9A9A9A'],
    elytra: ['#6B5B7A', '#4A3F5C', '#2D2540', '#8B7AA0'],
    diamond_chestplate: ['#5DECF5', '#2BB8C2', '#1A7C84', '#0F4A52'],
    diamond_helmet: ['#5DECF5', '#2BB8C2', '#1A7C84', '#0F4A52'],
    diamond_boots: ['#5DECF5', '#2BB8C2', '#1A7C84', '#0F4A52'],
    golden_apple: ['#F5C842', '#C49A22', '#8B6E12', '#E84545'],
    enchanted_book: ['#E84545', '#A82828', '#F5DC42', '#5C2020'],
    ender_pearl: ['#1F5F50', '#0F3F30', '#3FAF8F', '#072820'],
    totem: ['#F5DC42', '#C4AA22', '#3F8F5F', '#8B6E12'],
    emerald: ['#3FCF6F', '#1F8F4F', '#0F5F2F', '#7FEFAF'],
    nether_star: ['#F5F5F5', '#D8D8D8', '#9A9A9A', '#FFE8AA'],
    oak_planks: ['#A86B3D', '#7A4A26', '#5C3A1E', '#8B5A2B'],
    stone: ['#9A9A9A', '#7A7A7A', '#5C5C5C', '#3A3A3A'],
    obsidian: ['#1A1024', '#0A050F', '#3A2A4A', '#2A1A35'],
    fishing_rod: ['#A86B3D', '#7A4A26', '#D8D8D8', '#5C3A1E'],
    flint_and_steel: ['#5C5C5C', '#3A3A3A', '#D8D8D8', '#9A9A9A'],
    arrow: ['#A86B3D', '#D8D8D8', '#5C3A1E', '#7A4A26'],
    arrow_left: ['#5DECF5', '#2BB8C2', '#1A7C84', '#0F4A52'],
    arrow_right: ['#5DECF5', '#2BB8C2', '#1A7C84', '#0F4A52'],
    barrier: ['#E84545', '#A82828', '#5C2020', '#F5F5F5'],
  };

/** Default palette for unknown items (stone fallback). */
export const FALLBACK_PALETTE: [string, string, string, string] = [
  '#9A9A9A',
  '#7A7A7A',
  '#5C5C5C',
  '#3A3A3A',
];

export const getPalette = (
  name: string
): [string, string, string, string] =>
  SPRITE_PALETTES[name] ?? FALLBACK_PALETTE;

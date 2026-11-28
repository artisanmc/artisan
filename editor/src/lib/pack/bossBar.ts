import { createImage, encodePng } from "./png";

/**
 * The boss bar Artisan draws a HUD in (`OverlayApi.Slot.BOSS_BAR`): a bar of colour
 * {@link HUD_BOSS_BAR_COLOR}, whose sprites the pack makes transparent so that only the bar's
 * name, the HUD, shows. Every bar of that colour loses its bar for a player with the pack: the
 * colour is reserved (no vanilla boss uses it). Without notches (`progress` overlay), a bar draws
 * only these two sprites. Same files as `BossBar.kt`.
 */
export const HUD_BOSS_BAR_COLOR = "yellow";

/** Size of a vanilla boss bar sprite. */
const WIDTH = 182;
const HEIGHT = 5;

/** The two transparent sprites, by path. */
export function bossBarFiles(): Record<string, Uint8Array> {
  const empty = encodePng(createImage(WIDTH, HEIGHT));
  const dir = "assets/minecraft/textures/gui/sprites/boss_bar";
  return {
    [`${dir}/${HUD_BOSS_BAR_COLOR}_background.png`]: empty,
    [`${dir}/${HUD_BOSS_BAR_COLOR}_progress.png`]: empty,
  };
}

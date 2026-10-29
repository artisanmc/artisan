/**
 * The geometry of the game's screen, as the 1.21 client computes it (SDK 1.14): the GUI scale
 * for a window size, the GUI size it gives, and where the HUD draws (hotbar, action bar,
 * title, boss bars, chat). Pure: `McScreen` draws from it, and a module places its own layers
 * with it. Locked by `testdata/mc-screen-conformance.json`.
 *
 * Sizes are in GUI pixels (window pixels ÷ scale) unless named otherwise.
 */

/** The GUI scale option: `"auto"` (the game's default), or a fixed 1, 2, 3… */
export type GuiScaleChoice = "auto" | number;

/** Window sizes worth previewing, the game's default window first. */
export const MC_SCREEN_PRESETS: readonly { width: number; height: number }[] = [
  { width: 854, height: 480 },
  { width: 1280, height: 720 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
];

/** The smallest GUI the game keeps when it picks a scale. */
export const MIN_GUI_WIDTH = 320;
export const MIN_GUI_HEIGHT = 240;

/**
 * The scale the game uses for a window: the largest one keeping the GUI at least 320×240
 * (`Window.calculateScale`), capped by the chosen one. `"auto"` (or 0) is that largest one;
 * a choice above it falls back to it, as the slider does in game.
 */
export function guiScale(width: number, height: number, choice: GuiScaleChoice = "auto"): number {
  const wanted = choice === "auto" ? 0 : Math.max(0, Math.floor(choice));
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  let scale = 1;
  while (
    scale !== wanted &&
    scale < w &&
    scale < h &&
    Math.floor(w / (scale + 1)) >= MIN_GUI_WIDTH &&
    Math.floor(h / (scale + 1)) >= MIN_GUI_HEIGHT
  ) {
    scale++;
  }
  return scale;
}

/** The largest scale a window allows: the options the GUI scale slider offers are 1…this. */
export const maxGuiScale = (width: number, height: number): number => guiScale(width, height);

/** A rectangle in GUI pixels. */
export interface GuiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface McScreenLayout {
  /** Window pixels per GUI pixel. */
  scale: number;
  /** The GUI size: the window ÷ scale, rounded up as the game does. */
  width: number;
  height: number;
  /** The hotbar, 182×22 at the bottom centre. */
  hotbar: GuiRect;
  /** The experience bar, 182×5 above the hotbar. */
  xpBar: GuiRect;
  /** Top of the hearts and food rows (8×9 icons, hearts from the left, food from the right). */
  statusTop: number;
  /** Top of the action bar text, centred on `centerX`. The conversations HUD rises from here. */
  actionBarTop: number;
  /** Tops of the title (drawn ×4) and the subtitle (×2), centred on `centerX`. */
  titleTop: number;
  subtitleTop: number;
  /** The x every centred element is centred on. */
  centerX: number;
  /** Bottom of the chat's newest line; lines are 9 px tall, text 4 px from the left. */
  chatBottom: number;
  /** The chat's text width (the "Chat width" option at 100 %). */
  chatWidth: number;
  /** Lines shown with the chat closed (recent messages) and open. */
  chatLinesClosed: number;
  chatLinesOpen: number;
  /** The chat input box, while the chat is open. */
  chatInput: GuiRect;
}

/** Chat line pitch, in GUI pixels. */
export const CHAT_LINE_HEIGHT = 9;

/** The layout of a `width`×`height` window at GUI scale `scale` (see `guiScale`). */
export function mcScreenLayout(width: number, height: number, scale: number): McScreenLayout {
  const s = Math.max(1, Math.floor(scale));
  const W = Math.ceil(Math.max(1, Math.floor(width)) / s);
  const H = Math.ceil(Math.max(1, Math.floor(height)) / s);
  const centerX = Math.floor(W / 2);
  const centerY = Math.floor(H / 2);
  return {
    scale: s,
    width: W,
    height: H,
    hotbar: { x: centerX - 91, y: H - 22, width: 182, height: 22 },
    xpBar: { x: centerX - 91, y: H - 29, width: 182, height: 5 },
    statusTop: H - 39,
    actionBarTop: H - 72,
    titleTop: centerY - 40,
    subtitleTop: centerY + 10,
    centerX,
    chatBottom: H - 40,
    chatWidth: 320,
    chatLinesClosed: 10,
    chatLinesOpen: 20,
    chatInput: { x: 2, y: H - 14, width: W - 4, height: 12 },
  };
}

/** The rectangle of the hotbar's selection frame (24×23) around slot `slot` (0–8). */
export function hotbarSelection(layout: McScreenLayout, slot: number): GuiRect {
  const k = Math.min(8, Math.max(0, Math.floor(slot)));
  return { x: layout.hotbar.x - 1 + k * 20, y: layout.hotbar.y - 1, width: 24, height: 23 };
}

/**
 * The boss bar at `index` (0 the top one): its 182×5 bar, its name's top. The game stops
 * drawing bars once one would start below a third of the screen: null past that.
 */
export function bossBarAt(
  layout: McScreenLayout,
  index: number,
): { bar: GuiRect; nameTop: number } | null {
  const y = 12 + index * 19;
  if (index < 0 || (index > 0 && y >= layout.height / 3)) return null;
  return { bar: { x: layout.centerX - 91, y, width: 182, height: 5 }, nameTop: y - 9 };
}

/**
 * Where a container screen of `width`×`height` GUI pixels opens: centred, its origin
 * rounded down (`(W − width) / 2`, integer division).
 */
export function centeredScreen(layout: McScreenLayout, width: number, height: number): GuiRect {
  return {
    x: Math.floor((layout.width - width) / 2),
    y: Math.floor((layout.height - height) / 2),
    width,
    height,
  };
}

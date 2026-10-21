import type { BedrockMenu, BedrockTextLayer } from "./bedrockMenus";
import { BEDROCK_MARKER, bedrockButtonPair, bedrockFieldOffset } from "./bedrockTitle";

/**
 * `ui/chest_screen.json` of the Bedrock pack: the vanilla chest screen, changed
 * only through JSON UI `modifications` on the two root panels (small = 3 rows,
 * large = 6 rows). Each menu adds its elements, visible while the container
 * title carries its key; a title without a key leaves the screen vanilla.
 *
 * What the in-game prototype established (`prototypes/bedrock-overlay/`):
 * only `insert_back` and `replace` on `<panel>/root_panel` take effect;
 * redefining vanilla elements or editing the top half does nothing. So the
 * background is drawn ABOVE the whole vanilla chest panel (it hides the
 * vanilla title and slot cells) and a second slot grid, bound to the same
 * item collection, sits above it to draw the items and take the clicks.
 *
 * Coordinates: a layer's chest pixels (Java, origin at the window's top-left)
 * become Bedrock offsets on `root_panel` 4 px lower, where its slot grid is.
 */
export const BEDROCK_Y = 4;
const GRID_X = 7;
const GRID_Y = 21;
const CELL = 18;
const WIDTH = 176;
const LAYER_BACKGROUND = 30;
const LAYER_GRID = 31;
const LAYER_IMAGE = 32;
const LAYER_TEXT = 33;

export const PANELS = { 3: "small", 6: "large" } as const;

const T = "$artisan_title";

/** JSON UI boolean: `$artisan_title` contains `text`. */
function contains(text: string): string {
  return `(not ((${T} - '${text}') = ${T}))`;
}

function anyOf(conditions: string[]): string {
  return conditions.length === 1 ? (conditions[0] as string) : `(${conditions.join(" or ")})`;
}

/** The `$artisan_title` binding and the visibility every element carries. */
function when(condition: string): Record<string, unknown> {
  return { [T]: "$container_title", visible: condition };
}

function hasKey(menu: BedrockMenu): string {
  return contains(BEDROCK_MARKER + menu.key);
}

/** Field `index` of the title: `'%.Ns' * s` keeps the first N characters. */
function field(menu: BedrockMenu, layer: BedrockTextLayer): string {
  const offset = bedrockFieldOffset(
    menu.buttons.length,
    menu.texts.map((t) => t.length),
    layer.index,
  );
  return `('%.${layer.length}s' * (${T} - ('%.${offset}s' * ${T})))`;
}

const NAMED_COLORS: Record<string, string> = {
  black: "#000000",
  dark_blue: "#0000aa",
  dark_green: "#00aa00",
  dark_aqua: "#00aaaa",
  dark_red: "#aa0000",
  dark_purple: "#aa00aa",
  gold: "#ffaa00",
  gray: "#aaaaaa",
  dark_gray: "#555555",
  blue: "#5555ff",
  green: "#55ff55",
  aqua: "#55ffff",
  red: "#ff5555",
  light_purple: "#ff55ff",
  yellow: "#ffff55",
  white: "#ffffff",
};
/** MC draws chest titles in 0x404040. */
const DEFAULT_COLOR = "#404040";

/** A MiniMessage color (`#rrggbb` or a name) as the `[r, g, b]` floats JSON UI reads. */
export function labelColor(color: string | undefined): number[] {
  const hex = (color && (NAMED_COLORS[color] ?? color)) || DEFAULT_COLOR;
  const match = /^#([0-9a-f]{6})$/i.exec(hex) ?? /^#([0-9a-f]{6})$/i.exec(DEFAULT_COLOR);
  const n = Number.parseInt((match as RegExpExecArray)[1] as string, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round((v / 255) * 1000) / 1000);
}

function id(menu: BedrockMenu, what: string): string {
  const key = [...menu.key].map((c) => (c.codePointAt(0) as number).toString(16)).join("");
  return `artisan_${key}_${what}`;
}

/** Bedrock texture path (no extension) of a menu's composed background. */
export function backgroundTexture(menu: BedrockMenu): string {
  return `textures/artisan/menus/${id(menu, "bg")}`;
}

/** Bedrock texture path (no extension) of a button image. */
export function buttonTexture(key: string): string {
  return `textures/artisan/${key}`;
}

function backgroundElement(menu: BedrockMenu, height: number): Record<string, unknown> {
  return {
    [id(menu, "bg")]: {
      type: "image",
      texture: backgroundTexture(menu),
      size: [WIDTH, height],
      offset: [0, BEDROCK_Y],
      anchor_from: "top_left",
      anchor_to: "top_left",
      layer: LAYER_BACKGROUND,
      ...when(hasKey(menu)),
    },
  };
}

function buttonElements(
  menu: BedrockMenu,
  textureKey: (menuButton: BedrockMenu["buttons"][number], state: number) => string,
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const button of menu.buttons) {
    for (const image of button.images) {
      out.push({
        [id(menu, `b${button.index}_${image.state}`)]: {
          type: "image",
          texture: buttonTexture(textureKey(button, image.state)),
          size: [button.width, button.height],
          offset: [button.x, button.y + BEDROCK_Y],
          anchor_from: "top_left",
          anchor_to: "top_left",
          layer: LAYER_IMAGE,
          ...when(
            `(${hasKey(menu)} and ${contains(bedrockButtonPair(button.index, image.state))})`,
          ),
        },
      });
    }
  }
  return out;
}

function textElements(menu: BedrockMenu): Record<string, unknown>[] {
  return menu.texts.map((layer) => ({
    [id(menu, `t${layer.index}`)]: {
      type: "label",
      text: field(menu, layer),
      offset: [layer.x, layer.y + BEDROCK_Y],
      anchor_from: "top_left",
      anchor_to: "top_left",
      size: [layer.width ?? "default", "default"],
      text_alignment: layer.alignment ?? "left",
      color: labelColor(layer.color),
      font_scale_factor: layer.scale,
      shadow: false,
      layer: LAYER_TEXT,
      ...when(hasKey(menu)),
    },
  }));
}

/** The vanilla `chest_panel` of a root panel, restated so it can be hidden. */
function chestPanel(panel: "small" | "large", visible: string): Record<string, unknown> {
  return {
    chest_panel: {
      type: "panel",
      layer: 5,
      ...when(visible),
      controls: [
        { [`${panel}_chest_panel_top_half@chest.${panel}_chest_panel_top_half`]: {} },
        {
          "inventory_panel_bottom_half_with_label@common.inventory_panel_bottom_half_with_label":
            {},
        },
        { "hotbar_grid@common.hotbar_grid_template": {} },
        {
          "inventory_take_progress_icon_button@common.inventory_take_progress_icon_button": {},
        },
        { "flying_item_renderer@common.flying_item_renderer": { layer: 15 } },
      ],
    },
  };
}

/**
 * The screen file. `backgroundHeight(menu)` is the pixel height of the
 * composed background, `buttonKey` the texture name of a button image.
 */
export function buildChestScreen(
  menus: BedrockMenu[],
  backgroundHeight: (menu: BedrockMenu) => number,
  buttonKey: (menu: BedrockMenu, button: BedrockMenu["buttons"][number], state: number) => string,
): Record<string, unknown> {
  const screen: Record<string, unknown> = {
    namespace: "chest",
    // Our slot: the vanilla container item without its grey cell, the icon
    // stretched to the whole 18x18 cell so that tiles of one image join.
    "artisan_grid_item@common.container_item": {
      $item_collection_name: "container_items",
      $background_images: "common.empty_panel",
      $item_renderer_size: [CELL, CELL],
    },
  };
  for (const rows of [3, 6] as const) {
    const panel = PANELS[rows];
    const here = menus.filter((m) => m.rows === rows);
    if (!here.length) continue;
    const styled = anyOf(here.map(hasKey));
    const transparent = here.filter((m) => m.transparent);
    const modifications: Record<string, unknown>[] = [];
    if (transparent.length) {
      // `vanilla_texture: false`: no Bedrock panel either, and no bottom half.
      const visible = `(not ${anyOf(transparent.map(hasKey))})`;
      modifications.push(
        {
          array_name: "controls",
          operation: "replace",
          control_name: "common_panel",
          value: { "common_panel@common.common_panel": when(visible) },
        },
        {
          array_name: "controls",
          operation: "replace",
          control_name: "chest_panel",
          value: chestPanel(panel, visible),
        },
      );
    }
    modifications.push({
      array_name: "controls",
      operation: "insert_back",
      value: [
        ...here.map((menu) => backgroundElement(menu, backgroundHeight(menu))),
        {
          [`artisan_chest_grid@chest.${panel}_chest_grid`]: {
            offset: [GRID_X, GRID_Y],
            grid_item_template: "chest.artisan_grid_item",
            layer: LAYER_GRID,
            ...when(styled),
          },
        },
        ...here.flatMap((menu) => buttonElements(menu, (b, s) => buttonKey(menu, b, s))),
        ...here.flatMap(textElements),
      ],
    });
    screen[`${panel}_chest_panel/root_panel`] = { modifications };
  }
  return screen;
}

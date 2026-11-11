import { type Scene, type Shot, node, sel, text, textHas, typing, typingRich } from "../app/engine";
import { BOARD, PROJECT } from "../demo";
import { Caption } from "../kit/Caption";
import { EditorScene } from "../kit/EditorScene";

// Cadrages : l'éditeur fait 1600×900, le panneau Propriétés flotte à droite.
const WIDE: Shot = { cx: 800, cy: 450, zoom: 1 };
const panel = (cy: number, zoom = 1.4): Shot => ({ cx: 1380, cy, zoom });

interface Title {
  from: number;
  to: number;
  title: string;
  accent?: string;
  sub?: string;
  position?: "bottom-left" | "top-left";
}

function scene(spec: Scene, frames: number, titles: Title[]) {
  const Component = () => (
    <EditorScene scene={spec}>
      {(frame) =>
        titles.map((t) => (
          <Caption key={t.title} frame={frame} start={t.from} end={t.to} title={t.title} accent={t.accent} sub={t.sub} position={t.position} />
        ))
      }
    </EditorScene>
  );
  return { Component, frames, id: spec.id };
}

/** La planche : tout le module d'un coup d'œil, puis recul jusqu'à la vue entière. */
export const Board = scene(
  {
    id: "board",
    url: BOARD,
    timeline: [],
    camera: [
      [0, { cx: 620, cy: 520, zoom: 1.5 }],
      [120, WIDE],
    ],
  },
  165,
  [
    {
      from: 10,
      to: 160,
      title: "See your server as a whole",
      accent: "as a whole",
      sub: "Every menu, command and dialog on one board, with the links between them.",
    },
  ],
);

/** Un clic sur un item : ses actions, puis l'éditeur d'item et l'aperçu en jeu. */
export const Item = scene(
  {
    id: "item",
    url: BOARD,
    timeline: [
      { at: 24, move: node("slot:shop:10") },
      { at: 26, hover: true },
      { at: 44, click: true },
      { at: 46, hover: true },
      { at: 186, move: node("slot:hub:4") },
      { at: 198, click: true },
      { at: 222, move: sel("svg.lucide-pencil") },
      { at: 234, click: true },
    ],
    camera: [
      [0, WIDE],
      [50, WIDE],
      [84, { cx: 1280, cy: 420, zoom: 1.3 }],
      [150, { cx: 1280, cy: 560, zoom: 1.3 }],
      [168, { cx: 1280, cy: 560, zoom: 1.3 }],
      [190, WIDE],
      [234, WIDE],
      [300, { cx: 800, cy: 400, zoom: 1.12 }],
    ],
  },
  360,
  [
    {
      from: 14,
      to: 178,
      title: "Every click does something",
      accent: "does something",
      sub: "Open a menu, run a command, pay, give, teleport. Wrap steps in conditions.",
    },
    {
      from: 240,
      to: 355,
      title: "Edit an item, see it in game",
      accent: "see it in game",
      sub: "Title, lore, live values and expressions, with the tooltip players will see.",
    },
  ],
);

const alias = sel('input[placeholder="alias…"]');

/** Une commande créée sans code, puis le déploiement relu fichier par fichier. */
export const Publish = scene(
  {
    id: "publish",
    url: BOARD,
    timeline: [
      { at: 22, move: node("command:cmd_shop") },
      { at: 34, click: true },
      { at: 84, move: alias },
      { at: 94, click: true },
      ...typing(102, alias, "store"),
      { at: 128, run: (h) => h.key("Enter") },
      // Le brouillon s'enregistre après la saisie : le bouton Deploy ne s'active qu'ensuite.
      { at: 150, run: (h) => h.wait(700) },
      { at: 176, move: text("Deploy") },
      { at: 188, click: true },
    ],
    camera: [
      [0, WIDE],
      [38, WIDE],
      [70, panel(330)],
      [84, panel(330)],
      [100, panel(640)],
      [150, panel(640)],
      [172, WIDE],
      [262, WIDE],
      [300, { cx: 800, cy: 420, zoom: 1.15 }],
    ],
  },
  345,
  [
    {
      from: 12,
      to: 134,
      title: "Commands without code",
      accent: "without code",
      sub: "Name, aliases, permission, arguments and the steps it runs.",
    },
    {
      from: 140,
      to: 218,
      title: "Edit, then deploy",
      accent: "deploy",
      sub: "Changes stay a draft until you deploy. The server checks every file first.",
    },
  ],
);

/** Déclencheurs et dialogues natifs : deux nœuds de la planche, leurs réglages à droite. */
export const Automate = scene(
  {
    id: "automate",
    url: BOARD,
    timeline: [
      { at: 22, move: node("trigger:welcome") },
      { at: 34, click: true },
      { at: 138, run: (h) => h.key("Escape") },
      { at: 150, move: node("dialog:confirm_purchase") },
      { at: 162, click: true },
    ],
    camera: [
      [0, WIDE],
      [40, WIDE],
      [72, panel(360, 1.3)],
      [122, panel(360, 1.3)],
      [142, WIDE],
      [166, WIDE],
      [196, panel(330, 1.3)],
    ],
  },
  270,
  [
    {
      from: 12,
      to: 136,
      title: "React to what happens",
      accent: "what happens",
      sub: "First join, death and more: conditions, a cooldown, and the steps to run.",
    },
    {
      from: 150,
      to: 265,
      title: "Native dialogs",
      accent: "dialogs",
      sub: "Paper's dialogs: text, inputs and buttons with their own steps.",
    },
  ],
);

/** Le compositeur de titre : fond, texte et icône posés dans le titre du menu. */
export const Composer = scene(
  {
    id: "composer",
    url: BOARD,
    timeline: [
      { at: 22, move: node("slot:hub:1"), dy: -30 },
      { at: 34, click: true },
      { at: 96, move: textHas("coin") },
      { at: 108, click: true },
    ],
    camera: [
      [0, WIDE],
      [40, WIDE],
      [76, { cx: 1100, cy: 520, zoom: 1.3 }],
    ],
  },
  195,
  [
    {
      from: 12,
      to: 190,
      title: "Textured menus, pixel by pixel",
      accent: "pixel by pixel",
      sub: "Backgrounds, icons and text in a menu title. Artisan builds the resource pack.",
    },
  ],
);

const translation = sel("main .cm-editor");

/** Les traductions : la langue choisie, ce qui manque, et un texte traduit sur place. */
export const Languages = scene(
  {
    id: "languages",
    url: `${PROJECT}?tab=translations`,
    timeline: [
      { at: 26, move: text("FR", 'nav[aria-label="Languages"]') },
      { at: 38, click: true },
      { at: 78, move: translation },
      { at: 90, click: true },
      ...typingRich(98, translation, "Cliquez ici pour voter", 2),
    ],
    camera: [
      [0, WIDE],
      [50, WIDE],
      [84, { cx: 700, cy: 330, zoom: 1.15 }],
    ],
  },
  180,
  [
    {
      from: 12,
      to: 175,
      title: "Every text, every language",
      accent: "every language",
      sub: "One text per language. The translation view lists what is still missing.",
    },
  ],
);

export const History = scene(
  {
    id: "history",
    url: `${PROJECT}?tab=history`,
    timeline: [
      { at: 40, move: text("See changes", "body", 1) },
      { at: 52, click: true },
    ],
    camera: [
      [0, WIDE],
      [60, WIDE],
      [120, { cx: 800, cy: 430, zoom: 1.15 }],
    ],
  },
  165,
  [
    {
      from: 12,
      to: 160,
      title: "Every change is a version",
      accent: "is a version",
      sub: "Compare two versions and roll back in one click, hand edits included.",
    },
  ],
);


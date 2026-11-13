import { EditorView } from "@codemirror/view";
import { getInputProps } from "remotion";
import {
  type Entry,
  type Scene,
  type Shot,
  fillRich,
  node,
  sel,
  text,
  textHas,
  typing,
  typingAtCaret,
  typingRich,
} from "../app/engine";
import { followConversation, useConversationsStore } from "@/features/project/assistant/useAssistant";
import talk from "../../fixtures/assistant.json";
import { BOARD, PROJECT, SERVER } from "../demo";
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

/** `--props='{"captions":false}'` rend les scènes sans titre (GIF de la page de vente). */
const captions = (getInputProps() as { captions?: boolean }).captions !== false;

function scene(spec: Scene, frames: number, titles: Title[]) {
  const Component = () => (
    <EditorScene scene={spec}>
      {(frame) =>
        captions &&
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

// L'éditeur d'item : ses deux textes riches (titre, description) et leurs barres d'outils.
const itemField = (nth: number) => sel('[role="dialog"] .cm-editor', nth);
const itemTool = (label: string, nth: number) => sel(`[role="dialog"] button[aria-label="${label}"]`, nth);

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
      // Le titre, réécrit : une couleur et du gras choisis dans la barre, puis la frappe.
      { at: 256, move: itemField(0) },
      { at: 266, click: true },
      fillRich(268, itemField(0)),
      { at: 282, move: itemTool("Color and gradient", 0) },
      { at: 292, click: true },
      { at: 306, move: sel('button[aria-label="Gold"]') },
      { at: 316, click: true },
      { at: 328, move: itemTool("Bold (Ctrl+B)", 0) },
      { at: 338, click: true },
      ...typingAtCaret(344, itemField(0), "Your profile"),
      // Une ligne de plus dans la description, d'une autre couleur.
      { at: 394, move: itemField(1) },
      { at: 404, click: true },
      {
        at: 406,
        run: () => {
          const view = EditorView.findFromDOM(itemField(1)() as HTMLElement);
          if (!view) return;
          const end = view.state.doc.length;
          view.focus();
          view.dispatch({ changes: { from: end, insert: "\n" }, selection: { anchor: end + 1 } });
        },
      },
      { at: 420, move: itemTool("Color and gradient", 1) },
      { at: 430, click: true },
      { at: 444, move: sel('button[aria-label="Mint"]') },
      { at: 454, click: true },
      ...typingAtCaret(462, itemField(1), "Rank: VIP"),
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
  520,
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
      to: 515,
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

const layerY = sel('[data-testid="textarea-y"]');

/** Le compositeur de titre : fond, texte et icône posés dans le titre du menu. */
export const Composer = scene(
  {
    id: "composer",
    url: BOARD,
    timeline: [
      { at: 22, move: node("slot:hub:1"), dy: -30 },
      { at: 34, click: true },
      // Un texte de plus : ajouté, placé plus bas, écrit, puis ajusté à la souris sur le bandeau.
      { at: 96, move: sel('[data-testid="add-layer-text"]') },
      { at: 106, click: true },
      { at: 122, move: layerY },
      { at: 132, click: true },
      ...typing(134, layerY, "100", 4),
      { at: 156, move: sel("textarea") },
      { at: 166, click: true },
      ...typing(170, sel("textarea"), "Season 2 · Week 4", 3),
      { at: 234, move: node("slot:hub:1"), dy: 176 },
      { at: 242, press: true },
      { at: 272, move: node("slot:hub:1"), dy: 234 },
      { at: 278, release: true },
      { at: 296, move: sel('[data-testid="textarea-align-center"]') },
      { at: 306, click: true },
    ],
    camera: [
      [0, WIDE],
      [40, WIDE],
      [76, { cx: 1100, cy: 520, zoom: 1.3 }],
    ],
  },
  340,
  [
    {
      from: 12,
      to: 335,
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


const prompt = sel('[data-testid="assistant-page"] textarea');
const ASK = "Make me a VIP menu with three ranks";
const ANSWER_FROM = 112;
const ANSWER_TO = 372;

/** L'instant `step` de la conversation enregistrée : le hub rejoué le sert, l'éditeur le relit. */
const instant = (at: number, step: number): Entry => ({
  at,
  run: async () => {
    await fetch(`/api/promo/assistant?step=${step}`, { method: "POST" });
    const id = useConversationsStore.getState().currentId;
    if (id) await followConversation(id);
  },
});

/** La réponse de l'assistant, étalée sur les images `from`…`to` : un instant toutes les deux images. */
function answer(from: number, to: number): Entry[] {
  const last = talk.snapshots.length - 1;
  const entries: Entry[] = [];
  for (let at = from; at <= to; at += 2)
    entries.push(instant(at, Math.round((last * (at - from)) / (to - from))));
  return entries;
}

/** L'assistant : une demande en une phrase, le fichier qui s'écrit, puis son aperçu et son YAML à relire. */
export const Assistant = scene(
  {
    id: "assistant",
    url: `${SERVER}/assistant`,
    timeline: [
      { at: 0, run: () => void fetch("/api/promo/assistant", { method: "POST" }) },
      { at: 16, move: prompt },
      { at: 28, click: true },
      ...typing(34, prompt, ASK, 2),
      { at: 104, run: () => fetch("/api/promo/assistant?step=0", { method: "POST" }).then(() => undefined) },
      { at: 108, run: (h) => h.key("Enter") },
      ...answer(ANSWER_FROM, ANSWER_TO),
      { at: 416, move: text("YAML", '[data-testid="assistant-artifact"]') },
      { at: 430, click: true },
    ],
    camera: [
      [0, WIDE],
      [14, WIDE],
      [34, { cx: 620, cy: 760, zoom: 1.35 }],
      [106, { cx: 620, cy: 760, zoom: 1.35 }],
      [130, WIDE],
      [200, WIDE],
      [230, { cx: 1100, cy: 420, zoom: 1.2 }],
      [470, { cx: 1100, cy: 420, zoom: 1.2 }],
      [500, { cx: 1150, cy: 400, zoom: 1.3 }],
    ],
  },
  510,
  [
    {
      from: 6,
      to: 104,
      title: "Describe it, the AI drafts it",
      accent: "the AI drafts it",
      position: "top-left",
    },
    {
      from: 126,
      to: 372,
      title: "A real draft, checked by your server",
      accent: "checked by your server",
      sub: "The assistant reads your modules and writes the file. Nothing is live yet.",
    },
    {
      from: 380,
      to: 505,
      title: "You review, then deploy",
      accent: "deploy",
      sub: "With your own API key, or from Claude, ChatGPT and your IDE over MCP.",
    },
  ],
);

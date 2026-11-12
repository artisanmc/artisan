import "./preboot";
import "@/i18n";
import { hostComponents } from "@/distribution/hostComponents";
import { installHost } from "@/lib/editorHost";
import { registerEditorModule } from "@/lib/moduleDocumentKinds";
import { installRandomUuidFallback } from "@/lib/randomUuid";
import { commandsModule } from "@/modules/commands";
import { dialogsModule } from "@/modules/dialogs";
import { menusModule } from "@/modules/menus";
import { triggersModule } from "@/modules/triggers";
import { variablesModule } from "@/modules/variables";
import { routeTree } from "@/routeTree.gen";
import { listModules } from "@artisan/editor-sdk";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
// Polices de editor/index.html, embarquées pour un rendu sans réseau.
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/inter/700.css";
import i18n from "i18next";
import Konva from "konva";

// Même amorçage que editor/src/main.tsx. Le hub est rejoué par scripts/hub.mjs.
installRandomUuidFallback();
installHost(hostComponents);
void i18n.changeLanguage("en");
if (listModules().length === 0) {
  registerEditorModule(menusModule);
  registerEditorModule(commandsModule);
  registerEditorModule(dialogsModule);
  registerEditorModule(triggersModule);
  registerEditorModule(variablesModule);
}
// Le canvas reste net quand la caméra de la vidéo s'approche.
Konva.pixelRatio = 2;

/** Le routeur de l'éditeur, sur un historique en mémoire : les scènes naviguent par `goto`. */
export const router = createRouter({
  routeTree,
  history: createMemoryHistory({ initialEntries: ["/"] }),
});

// Requêtes en vol : une étape de scène attend que l'éditeur ait fini de lire le hub.
let inFlight = 0;
let lastActivity = performance.now();
const nativeFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  inFlight++;
  lastActivity = performance.now();
  try {
    // Le hub rejoué sert plusieurs rendus à la fois : chaque lecture dit de quelle scène elle vient.
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set("x-promo-scene", network.scene);
    return await nativeFetch(input, { ...init, headers });
  } finally {
    inFlight--;
    lastActivity = performance.now();
  }
};
// Les images (textures, fonds de menu) comptent comme des lectures : Konva les dessine à leur arrivée.
window.addEventListener("promo:image", (event) => {
  const image = (event as CustomEvent<HTMLImageElement>).detail;
  inFlight++;
  lastActivity = performance.now();
  const done = () => {
    inFlight--;
    lastActivity = performance.now();
    image.removeEventListener("load", done);
    image.removeEventListener("error", done);
  };
  image.addEventListener("load", done);
  image.addEventListener("error", done);
});
export const network = {
  /** La scène en cours (engine.tsx). */
  scene: "",
  idleFor: () => (inFlight > 0 ? 0 : performance.now() - lastActivity),
};


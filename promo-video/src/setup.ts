import "@/i18n";
import { registerModule, listModules } from "@artisan/editor-sdk";
import { useTextureStore, getTextureUrl } from "@/features/canvas/textureStore";
import { commandsModule } from "@/modules/commands";
import { menusModule } from "@/modules/menus";
import type { Project } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
// Polices de editor/index.html, embarquées pour un rendu sans réseau.
import "@fontsource/inter/700.css";
import "@fontsource/hanken-grotesk/400.css";
import "@fontsource/hanken-grotesk/500.css";
import "@fontsource/hanken-grotesk/600.css";
import "@fontsource/hanken-grotesk/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import i18n from "i18next";
import { continueRender, delayRender } from "remotion";
import items from "../../backend/data/items/1.21.4.json";
import { demoProject } from "./project";

// Même amorçage que editor/src/main.tsx, sans routeur ni backend.
document.documentElement.dataset.theme = "dark";
void i18n.changeLanguage("en");
if (listModules().length === 0) {
  registerModule(menusModule);
  registerModule(commandsModule);
}

const textures = useTextureStore.getState();
textures.setData("1.21.4", items);
textures.setLibraryItems(items as never);
textures.setLibraryBundleReady(true);
useUiStore.setState({ minimapVisible: false });

export const baseProject: Project = demoProject();

/** Remplace le projet affiché : chaque image décrit l'état complet qu'elle montre. */
export function showProject(project: Project) {
  const account = useAccountStore.getState().account;
  if (account.projects[0] === project) return;
  useAccountStore.setState({
    account: { id: "a_demo" as never, projects: [project], projectOrder: [project.id] },
  });
}
showProject(baseProject);

// Les textures arrivent par le réseau : aucune image n'est capturée avant
// qu'elles soient en cache, sinon les premières images d'un onglet sont vides.
const materials = new Set<string>();
for (const menu of baseProject.menus)
  for (const layer of menu.layers)
    for (const el of layer.elements) if (el.display?.material) materials.add(el.display.material);
// La bibliothèque affiche ses premières tuiles avant la recherche.
for (const item of (items as { id: string }[]).slice(0, 90)) materials.add(item.id);
const handle = delayRender("Préchargement des textures");
Promise.all(
  [...materials].map((m) => {
    const url = getTextureUrl(m);
    if (!url) return null;
    const img = new Image();
    img.src = url;
    return img.decode().catch(() => null);
  }),
).then(() => continueRender(handle));

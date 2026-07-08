import type { FrontendModule } from "@artisan/editor-sdk";
import { BoutiqueScreen } from "./BoutiqueScreen";
import { hasBoutiqueData, readBoutiqueState } from "./state";
import { serializeShopYaml } from "./shopYaml";

/**
 * Tracer-bullet external module. Lives in its own package, consumes the SDK as
 * a dependency. P1c promotes this to a separate repo + published packages.
 */
const boutiqueModule: FrontendModule = {
  id: "boutique",
  displayName: "Boutique",
  schemaVersion: "boutique/v1",
  sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
  routes: [{ path: "/", component: BoutiqueScreen }],
  exportFiles: (project) => {
    const state = readBoutiqueState(project);
    if (!hasBoutiqueData(project) && state.categories.length === 0) return {};
    const files: Record<string, string> = { "boutique/shop.yaml": serializeShopYaml(state) };
    return files;
  },
};

export default boutiqueModule;

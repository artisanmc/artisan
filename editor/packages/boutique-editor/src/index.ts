import type { FrontendModule } from "@artisan/editor-sdk";
import { BoutiqueScreen } from "./BoutiqueScreen";
import { boutiqueLocalRows } from "./localRows";
import { exportBoutiqueFiles } from "./state";

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
  exportFiles: exportBoutiqueFiles,
  localPreviewRows: boutiqueLocalRows,
};

export default boutiqueModule;

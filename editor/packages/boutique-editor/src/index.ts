import type { FrontendModule } from "@artisan/editor-sdk";
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
  // No configuration screen anymore: the catalog is edited through the
  // GENERATED Sources form (declared models) and item sets live at the MENU
  // level — the bespoke BoutiqueScreen died with them (2026-07-27).
  routes: [],
  exportFiles: exportBoutiqueFiles,
  localPreviewRows: boutiqueLocalRows,
  dataSourceModels: { "boutique:items": "boutique:item", "boutique:categories": "boutique:category" },
};

export default boutiqueModule;

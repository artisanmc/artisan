import type { FrontendModule } from "@artisan/editor-sdk";
import { boutiqueLocalRows } from "./localRows";
import { migrateIcons } from "./migrateIcons";
import { exportBoutiqueFiles } from "./state";

/** External module living in its own package, consuming the SDK as a dependency. */
const boutiqueModule: FrontendModule = {
  id: "boutique",
  displayName: "Boutique",
  schemaVersion: "boutique/v1",
  sidebar: { icon: () => null, label: "Boutique", to: "/m/boutique" },
  // No configuration screen: the catalog is edited through the generated
  // Sources form (declared models) and item sets live at the menu level.
  routes: [],
  exportFiles: exportBoutiqueFiles,
  localPreviewRows: boutiqueLocalRows,
  migrateProject: migrateIcons,
  dataSourceModels: {
    "boutique:items": "boutique:item",
    "boutique:categories": "boutique:category",
  },
};

export default boutiqueModule;

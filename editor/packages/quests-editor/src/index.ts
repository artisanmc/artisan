import type { FrontendModule } from "@artisan/editor-sdk";
import { QuestsScreen } from "./QuestsScreen";

/** External module living in its own package, consuming the SDK as a dependency. */
const questsModule: FrontendModule = {
  id: "quests",
  displayName: "Quests",
  schemaVersion: "quests/v1",
  sidebar: { icon: () => null, label: "Quests", to: "/m/quests" },
  routes: [{ path: "/", component: QuestsScreen }],
};

export default questsModule;

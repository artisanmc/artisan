import type { FrontendModule } from "@artisan/editor-sdk";
import { QuestsScreen } from "./QuestsScreen";

/**
 * Tracer-bullet external module. Lives in its own package, consumes the SDK as
 * a dependency. P1c promotes this to a separate repo + published packages.
 */
const questsModule: FrontendModule = {
  id: "quests",
  displayName: "Quests",
  schemaVersion: "quests/v1",
  sidebar: { icon: () => null, label: "Quests", to: "/m/quests" },
  routes: [{ path: "/", component: QuestsScreen }],
};

export default questsModule;

import { type FrontendModule, SDK_VERSION } from "@artisan/editor-sdk";
import { questGroupKind } from "./questGroupKind";

/**
 * The editor view of ArtisanQuests (presence id `msquests`): the `quest_group` kind.
 * Built into the editor as a fallback, and built as a bundle (`npm run build:bundle`)
 * that the plugin's jar serves, so the view matches the installed plugin.
 */
const questsModule: FrontendModule = {
  id: "msquests",
  displayName: "Quests",
  schemaVersion: "quest_group/v1",
  sdk: SDK_VERSION,
  sidebar: { icon: () => null, label: "Quests", to: "/m/msquests" },
  // Quests are Documents: they are edited from the project, no screen of their own.
  routes: [],
  documents: [questGroupKind],
};

export default questsModule;

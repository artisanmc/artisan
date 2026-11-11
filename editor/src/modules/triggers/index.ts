import type { FrontendModule } from "@artisan/editor-sdk";
import { triggerKind } from "./triggerKind";

export const triggersModule: FrontendModule = {
  id: "triggers",
  displayName: "Triggers",
  schemaVersion: "trigger/v1",
  sidebar: {
    icon: () => null,
    label: "Triggers",
    to: "/",
  },
  routes: [],
  documents: [triggerKind],
};

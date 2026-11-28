import type { FrontendModule } from "@artisan/editor-sdk";
import { hudKind } from "./hudKind";

export const hudsModule: FrontendModule = {
  id: "huds",
  displayName: "HUD",
  schemaVersion: "hud/v1",
  sidebar: {
    icon: () => null,
    label: "HUD",
    to: "/",
  },
  routes: [],
  documents: [hudKind],
};

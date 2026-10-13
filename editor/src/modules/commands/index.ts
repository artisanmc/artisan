import type { FrontendModule } from "@artisan/editor-sdk";

export const commandsModule: FrontendModule = {
  id: "commands",
  displayName: "Commandes",
  schemaVersion: "command/v1",
  sidebar: {
    icon: () => null,
    label: "Commandes",
    to: "/",
  },
  routes: [],
};

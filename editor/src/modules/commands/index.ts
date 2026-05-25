import type { FrontendModule } from "../api/types";

export const commandsModule: FrontendModule = {
  id: "commands",
  displayName: "Commandes",
  schemaVersion: "command/v1",
  sidebar: {
    icon: () => null,
    label: "Commandes",
    to: "/networks",
  },
  routes: [],
};

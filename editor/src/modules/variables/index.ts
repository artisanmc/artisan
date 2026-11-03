import type { FrontendModule } from "@artisan/editor-sdk";
import { variableKind } from "./variableKind";

export const variablesModule: FrontendModule = {
  id: "variables",
  displayName: "Variables",
  schemaVersion: "variable/v1",
  sidebar: {
    icon: () => null,
    label: "Variables",
    to: "/",
  },
  routes: [],
  documents: [variableKind],
};

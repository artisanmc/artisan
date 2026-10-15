import type { FrontendModule } from "@artisan/editor-sdk";
import { dialogKind } from "./dialogKind";

/** The core dialogs module: it exists to declare the dialog kind like a module would. */
export const dialogsModule: FrontendModule = {
  id: "dialogs",
  displayName: "Dialogs",
  schemaVersion: "dialog/v1",
  sidebar: {
    icon: () => null,
    label: "Dialogs",
    to: "/",
  },
  routes: [],
  documents: [dialogKind],
};

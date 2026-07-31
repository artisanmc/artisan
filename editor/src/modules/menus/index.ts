import type { FrontendModule } from "@artisan/editor-sdk";

/**
 * V1 editor MenusModule — wraps the existing project/menu editing routes.
 *
 * Routes are still declared via TanStack Router file-based routing
 * (editor/src/routes/*). This module decl is the bridge: it points the
 * sidebar to the network list page, where the user picks a network → project → menus.
 */
export const menusModule: FrontendModule = {
  id: "menus",
  displayName: "Menus",
  schemaVersion: "menu/v1",
  sidebar: {
    icon: () => null,
    label: "Menus",
    to: "/networks",
  },
  routes: [],
};

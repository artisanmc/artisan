import { Toaster } from "@/components/Toaster";
import "@/i18n"; // bootstraps i18next before any component reads translations
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";
import { hostComponents } from "@/distribution/hostComponents";
import { installHost } from "@/lib/editorHost";
import { registerEditorModule } from "@/lib/moduleDocumentKinds";
import { installRandomUuidFallback } from "@/lib/randomUuid";
import { detectInitialTheme } from "@/state/themeStore";
import { listModules } from "@artisan/editor-sdk";
import { commandsModule } from "./modules/commands";
import { dialogsModule } from "./modules/dialogs";
import { menusModule } from "./modules/menus";
import { triggersModule } from "./modules/triggers";

installRandomUuidFallback();
// Before any module renders: the SDK's hooks reach the editor through it.
installHost(hostComponents);

// Apply data-theme to <html> before React mounts — prevents FOUC on reload.
document.documentElement.dataset.theme = detectInitialTheme();

// Core modules only — external modules (boutique, quests…) are lazy-loaded and
// presence-gated by modulesStore via src/distribution/modules.manifest.ts. A module's
// Document kinds enter the host registries as it is registered.
if (listModules().length === 0) {
  registerEditorModule(menusModule);
  registerEditorModule(commandsModule);
  registerEditorModule(dialogsModule);
  registerEditorModule(triggersModule);
}

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RouterProvider router={router} />
    <Toaster />
  </StrictMode>,
);

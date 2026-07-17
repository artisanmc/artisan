import { Toaster } from "@/components/Toaster";
import "@/i18n"; // bootstraps i18next before any component reads translations
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";
import { detectInitialTheme } from "@/state/themeStore";
import { registerModule, listModules } from "@artisan/editor-sdk";
import { menusModule } from "./modules/menus";
import { commandsModule } from "./modules/commands";

// Apply data-theme to <html> before React mounts — prevents FOUC on reload.
document.documentElement.dataset.theme = detectInitialTheme();

// Core modules only — external modules (boutique, quests…) are lazy-loaded and
// presence-gated by modulesStore via src/distribution/modules.manifest.ts.
if (listModules().length === 0) {
  registerModule(menusModule);
  registerModule(commandsModule);
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

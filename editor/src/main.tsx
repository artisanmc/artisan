import { Toaster } from "@/components/Toaster";
import "@/i18n"; // bootstraps i18next before any component reads translations
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { routeTree } from "./routeTree.gen";
import "./styles/globals.css";
import { registerModule, listModules } from "./modules/api/registry";
import { menusModule } from "./modules/menus";
import { commandsModule } from "./modules/commands";

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

import "./i18n";
import { LandingPage } from "@/features/marketing/LandingPage";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/globals.css";

// artisanmc.net: the landing page alone; the wiki is copied next to it at build time.
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="p-8 text-2xl font-semibold">Interfaze editor — bootstrapping</div>
  </StrictMode>,
);

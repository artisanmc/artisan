import { Button } from "@/components/ui/button";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <div className="flex flex-col gap-3 p-8">
      <h1 className="font-semibold text-2xl">Interfaze editor</h1>
      <div>
        <Button variant="default">Smoke test</Button>
      </div>
    </div>
  </StrictMode>,
);

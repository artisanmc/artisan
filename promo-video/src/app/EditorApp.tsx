import { Toaster } from "@/components/Toaster";
import { RouterProvider } from "@tanstack/react-router";
import { AbsoluteFill } from "remotion";
import { router } from "./boot";

/** L'éditeur entier, tel que le plugin le sert : même arbre que editor/src/main.tsx. */
export function EditorApp() {
  return (
    <AbsoluteFill id="editor-root" style={{ background: "var(--surface)" }}>
      <RouterProvider router={router as never} />
      <Toaster />
    </AbsoluteFill>
  );
}

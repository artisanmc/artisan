import type { ReactNode } from "react";
import { Overlay, type Scene, useScene } from "../app/engine";
import { Cursor } from "./Cursor";

/** Une scène jouée dans l'éditeur : titres et curseur par-dessus, hors du cadrage. */
export function EditorScene({ scene, children }: { scene: Scene; children?: (frame: number) => ReactNode }) {
  const { cursor, clicks, frame } = useScene(scene);
  return (
    <Overlay>
      {children?.(frame)}
      {cursor && <Cursor at={cursor} frame={frame} clicks={clicks} />}
    </Overlay>
  );
}

import { Composition } from "remotion";
import "./styles.css";
import "./app/boot";
import { EditorApp } from "./app/EditorApp";
import { H, W } from "./app/engine";
import order from "./order.json";
import { Assistant, Automate, Board, Composer, History, Item, Languages, Publish } from "./scenes/editor";
import { Intro, Modules, Outro, Setup } from "./scenes/titles";

/** Chaque scène est une composition ; order.json donne le montage, que scripts/render.mjs rend scène par scène puis colle. */
const ALL = [Intro, Board, Item, Publish, Automate, Composer, Languages, History, Assistant, Setup, Modules, Outro];
const SCENES = (order as string[]).map((id) => {
  const found = ALL.find((s) => s.id === id);
  if (!found) throw new Error(`Scène inconnue dans order.json : ${id}`);
  return found;
});

// L'éditeur et la scène, montés une fois : un composant recréé à chaque rendu de Root remonterait
// tout l'éditeur au milieu d'une scène (textures rechargées, dialogues fermés).
const COMPOSITIONS = SCENES.map(({ id, Component, frames }) => ({
  id,
  frames,
  Mounted: () => (
    <>
      <EditorApp />
      <Component />
    </>
  ),
}));

const video = { fps: 30, width: W, height: H };

export function Root() {
  return (
    <>
      {COMPOSITIONS.map(({ id, Mounted, frames }) => (
        <Composition key={id} id={id} durationInFrames={frames} {...video} component={Mounted} />
      ))}
    </>
  );
}

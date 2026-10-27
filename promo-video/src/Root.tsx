import { Composition } from "remotion";
import "./styles.css";
import { Spike } from "./Spike";
import { Debug } from "./Debug";

export function Root() {
  return (
    <>
    <Composition id="Debug" component={Debug} durationInFrames={1} fps={30} width={1920} height={1080} />
    <Composition id="Spike" component={Spike} durationInFrames={60} fps={30} width={1920} height={1080} />
    </>
  );
}

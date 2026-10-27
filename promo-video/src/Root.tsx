import { Composition } from "remotion";
import "./styles.css";
import { Spike } from "./Spike";

export function Root() {
  return (
    <Composition id="Spike" component={Spike} durationInFrames={60} fps={30} width={1920} height={1080} />
  );
}

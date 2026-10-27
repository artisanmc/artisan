import { Composition } from "remotion";
import "./styles.css";
import "./setup";
import { Promo, PROMO_FRAMES } from "./Promo";
import { Design } from "./scenes/Design";
import { Intro } from "./scenes/Intro";
import { Links } from "./scenes/Links";
import { Outro } from "./scenes/Outro";
import { Publish } from "./scenes/Publish";
import { Setup } from "./scenes/Setup";

const scene = { fps: 30, width: 1920, height: 1080 };

export function Root() {
  return (
    <>
      <Composition id="Promo" component={Promo} durationInFrames={PROMO_FRAMES} {...scene} />
      <Composition id="Intro" component={Intro} durationInFrames={120} {...scene} />
      <Composition id="Design" component={Design} durationInFrames={300} {...scene} />
      <Composition id="Links" component={Links} durationInFrames={270} {...scene} />
      <Composition id="Setup" component={Setup} durationInFrames={270} {...scene} />
      <Composition id="Publish" component={Publish} durationInFrames={180} {...scene} />
      <Composition id="Outro" component={Outro} durationInFrames={120} {...scene} />
    </>
  );
}

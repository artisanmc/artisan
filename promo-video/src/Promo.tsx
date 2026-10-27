import { AbsoluteFill, Series, interpolate, useCurrentFrame } from "remotion";
import { Design } from "./scenes/Design";
import { Intro } from "./scenes/Intro";
import { Links } from "./scenes/Links";
import { Outro } from "./scenes/Outro";
import { Publish } from "./scenes/Publish";
import { Setup } from "./scenes/Setup";

// Ordre et durées du storyboard (30 images/s). Les scènes 3 (titres) et 7
// (modules) arrivent quand leurs choix sont tranchés.
const SCENES = [
  { id: "intro", frames: 120, component: Intro },
  { id: "design", frames: 300, component: Design },
  { id: "links", frames: 270, component: Links },
  { id: "setup", frames: 270, component: Setup },
  { id: "publish", frames: 180, component: Publish },
  { id: "outro", frames: 120, component: Outro },
];

export const PROMO_FRAMES = SCENES.reduce((n, s) => n + s.frames, 0);

/** Fondu d'entrée et de sortie : deux canvas ne sont jamais montés ensemble. */
function Fade({ frames, children }: { frames: number; children: React.ReactNode }) {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 8, frames - 8, frames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
}

export function Promo() {
  return (
    <AbsoluteFill style={{ background: "var(--surface)" }}>
      <Series>
        {SCENES.map(({ id, frames, component: Scene }) => (
          <Series.Sequence key={id} durationInFrames={frames}>
            <Fade frames={frames}>
              <Scene />
            </Fade>
          </Series.Sequence>
        ))}
      </Series>
    </AbsoluteFill>
  );
}

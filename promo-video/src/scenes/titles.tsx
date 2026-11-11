import type { CSSProperties, ReactNode } from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { Overlay, useNoShot } from "../app/engine";
import { Backdrop } from "../kit/Backdrop";

// Les écrans hors éditeur : ils couvrent l'éditeur, avec ses polices, ses couleurs et ses classes.

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Entrée d'un bloc à l'image `at` : il monte de quelques pixels en apparaissant. */
function enter(frame: number, at: number): CSSProperties {
  return {
    opacity: interpolate(frame, [at, at + 14], [0, 1], clamp),
    transform: `translateY(${interpolate(frame, [at, at + 18], [22, 0], clamp)}px)`,
  };
}

function Screen({ frames, children }: { frames: number; children: (frame: number) => ReactNode }) {
  const frame = useCurrentFrame();
  useNoShot();
  const fade = interpolate(frame, [frames - 10, frames - 1], [1, 0], clamp);
  return (
    <Overlay>
      <Backdrop />
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          opacity: fade,
          fontFamily: "var(--font-body)",
          color: "var(--text)",
        }}
      >
        {children(frame)}
      </div>
    </Overlay>
  );
}

const headline: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontWeight: 700,
  letterSpacing: "-0.04em",
  lineHeight: 1.04,
  textAlign: "center",
};
const lead: CSSProperties = { fontSize: 26, color: "var(--text-mut)", textAlign: "center", maxWidth: 1100 };
const brand: CSSProperties = { color: "var(--brand)" };

function Wordmark({ height }: { height: number }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: height * 0.45 }}>
      <img src="/symbol-dark.svg" alt="" style={{ height: height * 1.5 }} />
      <img src="/wordmark-dark.svg" alt="Artisan" style={{ height }} />
    </div>
  );
}

function IntroScreen() {
  return (
    <Screen frames={INTRO}>
      {(frame) => (
        <>
          <div style={enter(frame, 4)}>
            <Wordmark height={44} />
          </div>
          <div style={{ ...headline, fontSize: 88, marginTop: 56, ...enter(frame, 16) }}>
            One editor for your <span style={brand}>whole server</span>.
          </div>
          <div style={{ ...lead, marginTop: 28, ...enter(frame, 28) }}>
            Menus, commands, dialogs and triggers, in a web editor your own server serves.
          </div>
        </>
      )}
    </Screen>
  );
}

const STEPS: { title: ReactNode; text: string }[] = [
  { title: "Drop the jar", text: "Put Artisan in plugins/ and start your Paper server." },
  {
    title: (
      <>
        Type <code style={{ fontFamily: "var(--font-mono)", color: "var(--brand)" }}>/artisan editor</code>
      </>
    ),
    text: "You get a link that signs you in, over HTTPS.",
  },
  { title: "Edit, then deploy", text: "Changes stay a draft until you deploy. Then they are live in game." },
];
const PILLS = ["No port to open", "No account, no cloud", "Plain YAML files", "Velocity & BungeeCord"];

function SetupScreen() {
  return (
    <Screen frames={SETUP}>
      {(frame) => (
        <>
          <div className="eyebrow" style={{ fontSize: 18, ...enter(frame, 2) }}>
            Self-hosted
          </div>
          <div style={{ ...headline, fontSize: 72, marginTop: 14, ...enter(frame, 6) }}>
            Running in <span style={brand}>two minutes</span>
          </div>
          <div style={{ display: "flex", gap: 24, marginTop: 56 }}>
            {STEPS.map((step, i) => (
              <div
                key={step.text}
                className="card"
                style={{ width: 400, padding: "30px 32px", ...enter(frame, 26 + i * 26) }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "var(--brand-soft)",
                    color: "var(--brand)",
                    fontFamily: "var(--font-mono)",
                    fontWeight: 600,
                    fontSize: 22,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {i + 1}
                </div>
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 28, marginTop: 20 }}>
                  {step.title}
                </div>
                <div style={{ fontSize: 20, lineHeight: 1.4, color: "var(--text-mut)", marginTop: 10 }}>{step.text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 14, marginTop: 44 }}>
            {PILLS.map((pill, i) => (
              <div
                key={pill}
                style={{
                  padding: "12px 22px",
                  borderRadius: 999,
                  border: "1px solid var(--brand-line)",
                  background: "var(--brand-soft)",
                  fontSize: 21,
                  fontWeight: 500,
                  ...enter(frame, 108 + i * 8),
                }}
              >
                {pill}
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

const MODULES = [
  { id: "store", name: "Store", text: "Categories, ranks, kits, discounts" },
  { id: "auctions", name: "Auctions", text: "Fixed prices and bids" },
  { id: "daily-rewards", name: "Daily Rewards", text: "A calendar, streaks, jokers" },
  { id: "guilds", name: "Guilds", text: "Ranks, a bank, a home" },
  { id: "quests", name: "Quests", text: "Objectives, stages, rewards" },
];

function ModulesScreen() {
  return (
    <Screen frames={MODULES_FRAMES}>
      {(frame) => (
        <>
          <div
            style={{
              padding: "8px 18px",
              borderRadius: 999,
              border: "1px solid var(--border)",
              background: "var(--surface-raised)",
              color: "var(--text-mut)",
              fontSize: 18,
              fontWeight: 500,
              ...enter(frame, 2),
            }}
          >
            Coming soon
          </div>
          <div style={{ ...headline, fontSize: 72, marginTop: 18, ...enter(frame, 6) }}>
            Extend it with <span style={brand}>modules</span>
          </div>
          <div style={{ ...lead, marginTop: 20, ...enter(frame, 16) }}>
            Each module adds gameplay and is configured in the same editor.
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 56 }}>
            {MODULES.map((module, i) => (
              <div
                key={module.id}
                className="card"
                style={{
                  width: 268,
                  padding: "30px 20px 26px",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  ...enter(frame, 30 + i * 10),
                }}
              >
                <img
                  src={`/brand/modules/${module.id}/icon.svg`}
                  alt=""
                  style={{ width: 96, height: 96, imageRendering: "pixelated" }}
                />
                <div style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 26, marginTop: 22 }}>
                  {module.name}
                </div>
                <div style={{ fontSize: 19, color: "var(--text-mut)", marginTop: 8 }}>{module.text}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Screen>
  );
}

function OutroScreen() {
  return (
    <Screen frames={OUTRO + 60}>
      {(frame) => (
        <>
          <div style={enter(frame, 4)}>
            <Wordmark height={56} />
          </div>
          <div style={{ ...headline, fontSize: 76, marginTop: 52, ...enter(frame, 14) }}>
            Your server, <span style={brand}>one editor away</span>.
          </div>
          <div style={{ ...lead, marginTop: 24, ...enter(frame, 26) }}>
            Install Artisan, open the editor, deploy your first menu.
          </div>
          <div
            style={{
              marginTop: 44,
              padding: "14px 30px",
              borderRadius: 14,
              background: "var(--brand)",
              color: "var(--brand-fg)",
              fontFamily: "var(--font-display)",
              fontWeight: 600,
              fontSize: 28,
              ...enter(frame, 38),
            }}
          >
            artisanmc.net
          </div>
        </>
      )}
    </Screen>
  );
}

const INTRO = 96;
const SETUP = 210;
const MODULES_FRAMES = 165;
const OUTRO = 120;

export const Intro = { Component: IntroScreen, frames: INTRO, id: "intro" };
export const Setup = { Component: SetupScreen, frames: SETUP, id: "setup" };
export const Modules = { Component: ModulesScreen, frames: MODULES_FRAMES, id: "modules" };
export const Outro = { Component: OutroScreen, frames: OUTRO, id: "outro" };

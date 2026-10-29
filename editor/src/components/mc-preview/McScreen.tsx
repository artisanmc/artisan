import { wrapLore } from "@/lib/loreWrap";
import { ATLAS_META } from "@/lib/mcFont/charCells";
import type { Style } from "@/lib/miniMessage";
import {
  CHAT_LINE_HEIGHT,
  type GuiRect,
  type McBossBarColor,
  type McScreenGeometry,
  type McScreenProps,
  bossBarAt,
  guiScale,
  hotbarSelection,
  mcScreenLayout,
} from "@artisan/editor-sdk";
import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import useImage from "use-image";
import { McText, guiTextureUrl } from "./McText";
import { MAX_ASCENT } from "./mcGlyphs";

/**
 * The client draws a string's ASCII cell top at its y; `McText` leaves room above for the
 * accented atlas' taller cells. A canvas placed this much higher puts the text where the
 * game does.
 */
const TEXT_LIFT = MAX_ASCENT - ATLAS_META.ascii.ascent;

const WHITE: Style = { color: "#ffffff" };
const XP_GREEN: Style = { color: "#80ff20" };

/**
 * The game's screen (SDK `McScreen`): every element placed in GUI pixels from
 * `mcScreenLayout`, drawn at window pixels (× scale), the whole window then zoomed to the
 * container. The vanilla HUD sprites come from the hub's textures, with flat colours while
 * they are not served.
 */
export function McScreen({
  width,
  height,
  guiScale: choice = "auto",
  zoom = "fit",
  backdrop = "scene",
  hotbar = {},
  survival,
  chat = [],
  chatInput,
  actionBar,
  title,
  bossBars = [],
  screen,
  children,
  className,
}: McScreenProps) {
  const scale = guiScale(width, height, choice);
  const layout = mcScreenLayout(width, height, scale);
  const geometry: McScreenGeometry = { layout, scale, textLift: TEXT_LIFT };
  const fitRef = useRef<HTMLDivElement>(null);
  const fitWidth = useWidth(fitRef);
  const factor = zoom === "fit" ? (fitWidth ?? width) / width : zoom;
  const open = chatInput !== undefined;
  const px = (n: number) => n * scale;
  const at = (r: GuiRect): CSSProperties => ({
    position: "absolute",
    left: px(r.x),
    top: px(r.y),
    width: px(r.width),
    height: px(r.height),
  });

  return (
    <div
      ref={fitRef}
      data-testid="mc-screen"
      data-gui-scale={scale}
      data-gui-size={`${layout.width}x${layout.height}`}
      className={className}
      style={{
        position: "relative",
        width: zoom === "fit" ? "100%" : width * factor,
        height: height * factor,
        overflow: "hidden",
        borderRadius: "var(--r-sm)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width,
          height,
          transform: `scale(${factor})`,
          transformOrigin: "0 0",
          background:
            backdrop === "scene"
              ? "linear-gradient(to bottom, var(--mc-scene-sky) 0%, var(--mc-scene-horizon) 62%, var(--mc-scene-ground) 62%)"
              : undefined,
        }}
      >
        {hotbar !== false && (
          <>
            <Sprite path="hud/hotbar" rect={layout.hotbar} scale={scale} fallback="hotbar" />
            <Sprite
              path="hud/hotbar_selection"
              rect={hotbarSelection(layout, hotbar.selected ?? 0)}
              scale={scale}
              fallback="selection"
            />
          </>
        )}
        {hotbar !== false && survival && (
          <SurvivalBars geometry={geometry} survival={survival} at={at} />
        )}
        {bossBars.map((b, k) => {
          const place = bossBarAt(layout, k);
          if (!place) return null;
          const color = b.color ?? "pink";
          const progress = Math.min(1, Math.max(0, b.progress));
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: bars have no identity
            <div key={k}>
              <Centered top={place.nameTop} scale={scale}>
                <McText source={b.name} defaults={WHITE} scale={scale} align="center" />
              </Centered>
              <Sprite
                path={`boss_bar/${color}_background`}
                rect={place.bar}
                scale={scale}
                fallback={{ bossBar: color, dim: true }}
              />
              <Sprite
                path={`boss_bar/${color}_progress`}
                rect={{ ...place.bar, width: Math.round(place.bar.width * progress) }}
                textureWidth={place.bar.width}
                scale={scale}
                fallback={{ bossBar: color }}
              />
            </div>
          );
        })}
        {title && (
          <>
            <Centered top={layout.titleTop} scale={scale} lift={4}>
              <McText source={title.title} defaults={WHITE} scale={4 * scale} align="center" />
            </Centered>
            {title.subtitle && (
              <Centered top={layout.subtitleTop} scale={scale} lift={2}>
                <McText source={title.subtitle} defaults={WHITE} scale={2 * scale} align="center" />
              </Centered>
            )}
          </>
        )}
        {actionBar && (
          <Centered top={layout.actionBarTop} scale={scale}>
            <McText source={actionBar} defaults={WHITE} scale={scale} align="center" />
          </Centered>
        )}
        <Chat geometry={geometry} messages={chat} open={open} />
        {open && (
          <div
            data-testid="mc-screen-chat-input"
            style={{ ...at(layout.chatInput), background: "var(--mc-chat-line-bg)" }}
          >
            <div style={{ position: "absolute", left: px(2), top: px(2 - TEXT_LIFT) }}>
              <McText source={`${escapeTags(chatInput)}_`} defaults={WHITE} scale={scale} />
            </div>
          </div>
        )}
        {children?.(geometry)}
        {screen && (
          <div
            data-testid="mc-screen-open"
            style={{
              position: "absolute",
              inset: 0,
              background:
                "linear-gradient(to bottom, var(--mc-screen-dim-top), var(--mc-screen-dim-bottom))",
            }}
          >
            {screen(geometry)}
          </div>
        )}
      </div>
    </div>
  );
}

/** A line centred on the screen's middle, its text top at `top` GUI px (× `lift` when drawn bigger). */
function Centered({
  top,
  scale,
  lift = 1,
  children,
}: {
  top: number;
  scale: number;
  lift?: number;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: (top - TEXT_LIFT * lift) * scale,
        display: "flex",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

/** The chat: the newest lines over the bottom-left corner, each on its translucent strip. */
function Chat({
  geometry: { layout, scale },
  messages,
  open,
}: {
  geometry: McScreenGeometry;
  messages: string[];
  open: boolean;
}) {
  const lines = messages.flatMap((m) =>
    m.split(/\n|<newline>|<br\/?>/i).flatMap((l) => wrapLore(l, layout.chatWidth)),
  );
  const shown = lines.slice(-(open ? layout.chatLinesOpen : layout.chatLinesClosed));
  if (shown.length === 0) return null;
  return (
    <div data-testid="mc-screen-chat">
      {shown.map((line, k) => {
        const bottom = layout.chatBottom - (shown.length - 1 - k) * CHAT_LINE_HEIGHT;
        return (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no identity
            key={k}
            style={{
              position: "absolute",
              left: 0,
              top: (bottom - CHAT_LINE_HEIGHT) * scale,
              width: (layout.chatWidth + 12) * scale,
              height: CHAT_LINE_HEIGHT * scale,
              background: "var(--mc-chat-line-bg)",
            }}
          >
            <div style={{ position: "absolute", left: 4 * scale, top: (1 - TEXT_LIFT) * scale }}>
              <McText source={line} defaults={WHITE} scale={scale} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SurvivalBars({
  geometry: { layout, scale },
  survival,
  at,
}: {
  geometry: McScreenGeometry;
  survival: NonNullable<McScreenProps["survival"]>;
  at: (r: GuiRect) => CSSProperties;
}) {
  const health = clamp(survival.health ?? 20, 0, 20);
  const food = clamp(survival.food ?? 20, 0, 20);
  const xp = clamp(survival.xp ?? 0, 0, 1);
  const icons = Array.from({ length: 10 }, (_, k) => k);
  const { xpBar } = layout;
  return (
    <>
      {icons.map((k) => {
        const rect = { x: xpBar.x + k * 8, y: layout.statusTop, width: 9, height: 9 };
        const fill = health - k * 2;
        return (
          <div key={`h${k}`}>
            <Sprite path="hud/heart/container" rect={rect} scale={scale} fallback="slot" />
            {fill > 0 && (
              <Sprite
                path={fill >= 2 ? "hud/heart/full" : "hud/heart/half"}
                rect={rect}
                scale={scale}
                fallback="heart"
              />
            )}
          </div>
        );
      })}
      {icons.map((k) => {
        const rect = {
          x: xpBar.x + xpBar.width - k * 8 - 9,
          y: layout.statusTop,
          width: 9,
          height: 9,
        };
        const fill = food - k * 2;
        return (
          <div key={`f${k}`}>
            <Sprite path="hud/food_empty" rect={rect} scale={scale} fallback="slot" />
            {fill > 0 && (
              <Sprite
                path={fill >= 2 ? "hud/food_full" : "hud/food_half"}
                rect={rect}
                scale={scale}
                fallback="food"
              />
            )}
          </div>
        );
      })}
      <Sprite path="hud/experience_bar_background" rect={xpBar} scale={scale} fallback="slot" />
      <Sprite
        path="hud/experience_bar_progress"
        rect={{ ...xpBar, width: Math.round(xpBar.width * xp) }}
        textureWidth={xpBar.width}
        scale={scale}
        fallback="xp"
      />
      {(survival.level ?? 0) > 0 && (
        <div style={{ ...at({ ...xpBar, y: xpBar.y - 6 - TEXT_LIFT }), height: "auto" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <McText source={String(survival.level)} defaults={XP_GREEN} scale={scale} />
          </div>
        </div>
      )}
    </>
  );
}

type Fallback =
  | "hotbar"
  | "selection"
  | "slot"
  | "heart"
  | "food"
  | "xp"
  | { bossBar: McBossBarColor; dim?: boolean };

/**
 * A vanilla GUI sprite (`textures/gui/sprites/<path>`) stretched to `rect`, cut at
 * `rect.width` when `textureWidth` is wider (a progress bar). A flat colour stands in
 * while the texture is not served.
 */
function Sprite({
  path,
  rect,
  scale,
  textureWidth,
  fallback,
}: {
  path: string;
  rect: GuiRect;
  scale: number;
  textureWidth?: number;
  fallback: Fallback;
}) {
  const url = guiTextureUrl(`sprites/${path}`);
  const [image] = useImage(url, "anonymous");
  const style: CSSProperties = {
    position: "absolute",
    left: rect.x * scale,
    top: rect.y * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  };
  if (rect.width <= 0) return null;
  if (image) {
    return (
      <div
        data-sprite={path}
        style={{
          ...style,
          backgroundImage: `url(${url})`,
          backgroundSize: `${(textureWidth ?? rect.width) * scale}px ${rect.height * scale}px`,
          backgroundRepeat: "no-repeat",
          imageRendering: "pixelated",
        }}
      />
    );
  }
  return <div data-sprite={path} style={{ ...style, ...fallbackStyle(fallback, scale) }} />;
}

function fallbackStyle(fallback: Fallback, scale: number): CSSProperties {
  if (typeof fallback === "object") {
    return {
      background: `var(--mc-bossbar-${fallback.bossBar})`,
      opacity: fallback.dim ? 0.35 : 1,
    };
  }
  switch (fallback) {
    case "hotbar":
      return {
        background: "var(--mc-hotbar-bg)",
        border: `${scale}px solid var(--mc-hotbar-border)`,
      };
    case "selection":
      return { border: `${scale}px solid var(--mc-slot-light)` };
    case "slot":
      return { background: "var(--mc-hotbar-bg)" };
    case "heart":
      return { background: "var(--mc-heart)" };
    case "food":
      return { background: "var(--mc-food)" };
    case "xp":
      return { background: "var(--mc-xp)" };
  }
}

/** The container's width, followed as it resizes; undefined before the first measure. */
function useWidth(ref: RefObject<HTMLDivElement | null>): number | undefined {
  const [width, setWidth] = useState<number>();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || undefined);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth || undefined));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** Typed chat text is shown as typed: its tags are not MiniMessage. */
const escapeTags = (text: string) => text.replace(/[\\<]/g, "\\$&");

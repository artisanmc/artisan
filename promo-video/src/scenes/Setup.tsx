import { ServerRow } from "@/components/LinkedServersDropdown";
import { MIN_CONTENT_VERSION } from "@/lib/api/networks";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { File, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { presence, tween } from "../kit/anim";
import { Backdrop } from "../kit/Backdrop";
import { Caption } from "../kit/Caption";

// Installation : le jar dans plugins/, une commande en jeu, l'éditeur ouvert.
// Aucune redirection de port : le serveur se connecte lui-même.
const PLUGINS = ["LuckPerms-5.4.jar", "PlaceholderAPI-2.11.jar", "Vault-1.7.jar"];
const JAR_IN = 30;
const TYPED = 78;
const REPLY = 100;
const ONLINE = 150;

function Panel({ title, children, style }: { title: string; children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="card" style={{ padding: 0, overflow: "hidden", ...style }}>
      <div
        className="eyebrow"
        style={{ padding: "14px 20px", borderBottom: "1px solid var(--border-soft)", fontSize: 13 }}
      >
        {title}
      </div>
      <div style={{ padding: 20 }}>{children}</div>
    </div>
  );
}

function FileRow({ name, highlight, style }: { name: string; highlight?: boolean; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: "var(--r-sm)",
        fontFamily: "var(--font-mono)",
        fontSize: 20,
        color: highlight ? "var(--text)" : "var(--text-mut)",
        background: highlight ? "var(--brand-soft)" : "transparent",
        border: highlight ? "1px solid var(--brand-line)" : "1px solid transparent",
        ...style,
      }}
    >
      <File size={20} color={highlight ? "var(--brand)" : "var(--text-faint)"} />
      {name}
    </div>
  );
}

export function Setup() {
  const frame = useCurrentFrame();
  const { t, i18n } = useTranslation();
  const jar = tween(frame, [JAR_IN, JAR_IN + 18], [0, 1]);
  const command = "/artisan editor";
  const typed = command.slice(0, Math.max(0, Math.floor((frame - 56) / 1.4)));
  const reply = presence(frame, REPLY, 400, 8);
  const online = tween(frame, [ONLINE, ONLINE + 16], [0, 1]);
  const out = interpolate(frame, [255, 270], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop />
      <AbsoluteFill style={{ flexDirection: "row", gap: 40, padding: "0 120px 220px", alignItems: "center", justifyContent: "center" }}>
        <Panel title="1 · Drop the jar" style={{ width: 520 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, fontFamily: "var(--font-mono)", fontSize: 20, color: "var(--text)", marginBottom: 10 }}>
            <Folder size={20} color="var(--text-mut)" /> plugins/
          </div>
          <div style={{ paddingLeft: 20 }}>
            <FileRow
              name="Artisan-2.0.jar"
              highlight
              style={{ opacity: jar, transform: `translateY(${(1 - jar) * -40}px)` }}
            />
            {PLUGINS.map((p) => (
              <FileRow key={p} name={p} />
            ))}
          </div>
        </Panel>

        <Panel title="2 · Run one command" style={{ width: 560, opacity: tween(frame, [40, 56], [0.35, 1]) }}>
          <div
            style={{
              background: "rgba(0,0,0,.55)",
              borderRadius: "var(--r-xs)",
              padding: "16px 18px",
              minHeight: 150,
              fontFamily: "var(--font-mono)",
              fontSize: 21,
              lineHeight: 1.6,
            }}
          >
            {frame >= TYPED + 8 ? (
              <div style={{ color: "#fff" }}>&lt;Steve&gt; {command}</div>
            ) : null}
            <div style={{ opacity: reply }}>
              <MiniMessageInline source="<green>[Artisan]</green> <gray>Editor ready for</gray> <white>Skyward</white>" />
              <br />
              <MiniMessageInline source="<aqua><u>Click to open the editor</u></aqua>" />
            </div>
          </div>
          <div
            style={{
              marginTop: 12,
              padding: "10px 14px",
              borderRadius: "var(--r-xs)",
              background: "rgba(0,0,0,.35)",
              fontFamily: "var(--font-mono)",
              fontSize: 21,
              color: "#fff",
              opacity: frame < TYPED + 8 ? 1 : 0.4,
            }}
          >
            {frame < TYPED + 8 ? typed : ""}
            <span style={{ opacity: Math.floor(frame / 8) % 2 ? 0 : 1 }}>_</span>
          </div>
        </Panel>

        <Panel title="3 · You're live" style={{ width: 460, opacity: tween(frame, [REPLY + 10, REPLY + 26], [0.35, 1]) }}>
          <div style={{ transform: "scale(1.5)", transformOrigin: "top left", width: "66%" }}>
            <ServerRow
              s={{
                id: "survival",
                label: "Skyward · Survival",
                online: online > 0.5,
                isCurrent: true,
                lastMcVersion: "1.21.4",
                lastSeenAt: null,
                lastSeenIp: null,
                contentVersion: MIN_CONTENT_VERSION,
              }}
              lang={i18n.language}
              t={t}
            />
          </div>
        </Panel>
      </AbsoluteFill>
      <Caption
        frame={frame}
        start={ONLINE + 6}
        end={270}
        title="Runs on your server. No port to open."
        accent="No port to open."
        sub="Install the plugin, type one command, start editing."
      />
    </AbsoluteFill>
  );
}

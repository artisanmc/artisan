import { ChangeList } from "@/components/ui/change-list";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { tween } from "../kit/anim";
import { Backdrop } from "../kit/Backdrop";
import { Caption } from "../kit/Caption";
import { Cursor } from "../kit/Cursor";

// Revue de publication : le brouillon face aux fichiers du serveur.
const context = require.context("../../project/menus", false, /\.yaml$/);
const draft: Record<string, string> = {};
for (const key of context.keys()) draft[`menus/${key.slice(2)}`] = context(key) as string;
const server: Record<string, string> = { ...draft };
server["menus/ranks.yaml"] = (draft["menus/ranks.yaml"] ?? "")
  .replace("40,000 coins", "50,000 coins")
  .replace(/open_menu confirm with rank="(\w+)" price="\d+"/g, 'run_command "buy rank $1" as player');

const CLICK = 120;

export function Publish() {
  const frame = useCurrentFrame();
  const { t } = useTranslation();
  const done = frame >= CLICK + 6;
  const dialogIn = tween(frame, [0, 14], [0, 1]);
  const toast = tween(frame, [CLICK + 8, CLICK + 22], [0, 1]);
  const out = interpolate(frame, [165, 180], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const cursor = {
    x: interpolate(frame, [40, CLICK - 4], [1100, 1560], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
    y: interpolate(frame, [40, CLICK - 4], [700, 958], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  };
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
        <div
          className="card"
          style={{
            width: 1400,
            height: 660,
            marginTop: 230,
            display: "flex",
            flexDirection: "column",
            gap: 16,
            padding: 28,
            opacity: dialogIn,
            transform: `scale(${0.96 + 0.04 * dialogIn})`,
            boxShadow: "0 40px 120px rgba(0,0,0,.55)",
          }}
        >
          <div>
            <div style={{ fontSize: 26, fontWeight: 600, color: "var(--text)" }}>{t("deploy.reviewTitle")}</div>
            <div style={{ fontSize: 17, color: "var(--text-mut)", marginTop: 4 }}>{t("deploy.reviewBody")}</div>
          </div>
          <ChangeList
            before={server}
            after={draft}
            beforeLabel={t("deploy.server")}
            afterLabel={t("deploy.draft")}
            className="min-h-0 flex-1 overflow-hidden"
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button type="button" className="btn btn-ghost">
              {t("save.cancel")}
            </button>
            <button type="button" className="btn btn-primary" style={{ minWidth: 140 }}>
              {done ? <Check size={18} /> : null}
              {t("deploy.confirm")}
            </button>
          </div>
        </div>
      </AbsoluteFill>
      <div
        className="card"
        style={{
          position: "absolute",
          right: 60,
          top: 60,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 22px",
          fontSize: 20,
          color: "var(--text)",
          opacity: toast,
          transform: `translateY(${(1 - toast) * -20}px)`,
          border: "1px solid var(--brand-line)",
        }}
      >
        <Check size={22} color="var(--brand)" /> Deployed to Skyward · Survival
      </div>
      <Cursor frame={frame} at={cursor} clicks={[CLICK]} opacity={tween(frame, [30, 40], [0, 1])} />
      <Caption
        frame={frame}
        start={10}
        end={180}
        title="Review. Deploy. Done."
        accent="Deploy."
        sub="See every change before it reaches your server."
        position="top-left"
      />
    </AbsoluteFill>
  );
}

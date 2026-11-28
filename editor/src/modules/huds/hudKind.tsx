import type { ProjectId } from "@/domain/types";
import type { DocumentEditorProps, DocumentKindContribution } from "@artisan/editor-sdk";
import i18next from "i18next";
import { PanelsTopLeft } from "lucide-react";
import { HudEditor } from "./HudEditor";
import {
  DEFAULT_PRIORITY,
  DEFAULT_REFRESH,
  HUD_KIND,
  HUD_START,
  HUD_START_TEXTS,
  type Hud,
  hudFromFile,
  hudPackImages,
  hudToFile,
  lifetimeOf,
} from "./hud";

function HudView({ projectId, document }: DocumentEditorProps) {
  return <HudEditor projectId={projectId as ProjectId} hud={document as Hud} />;
}

/**
 * The HUD kind (ADR `server-huds`), declared like a module's. Its images go into the server's pack
 * at the heights its layout draws them (`pack.images`), as `Hud.packImages` gives them.
 */
export const hudKind: DocumentKindContribution & { wide?: boolean } = {
  ...HUD_KIND,
  label: "projectPanel.huds",
  icon: PanelsTopLeft,
  component: HudView,
  ownHeader: true,
  // The composer lays its layers, the screen and the panel side by side.
  wide: true,
  create: ({ id, projectId }) =>
    ({
      id,
      projectId: projectId as ProjectId,
      enabled: true,
      slot: "boss_bar",
      priority: DEFAULT_PRIORITY,
      refresh: DEFAULT_REFRESH,
      conditions: [],
      layout: structuredClone(HUD_START),
      texts: { ...HUD_START_TEXTS },
    }) satisfies Hud,
  parse: (src, ctx) =>
    hudFromFile(src as Record<string, unknown>, ctx as { projectId: string; lang: string }),
  serialize: (doc) => hudToFile(doc as Hud),
  pack: { images: (src) => hudPackImages(src as Record<string, unknown>) },
  board: {
    summary: (doc) => {
      const hud = doc as Hud;
      return i18next.t("huds.summary", {
        lifetime: i18next.t(`huds.lifetimes.${lifetimeOf(hud)}`),
        slot: i18next.t(`huds.slots.${hud.slot}`),
      });
    },
    accent: "var(--kind-hud)",
  },
};

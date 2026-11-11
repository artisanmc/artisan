import type { Project, ProjectId } from "@/domain/types";
import type { DocumentParseOpts } from "@/schema/documentCodecs";
import type { DocumentEditorProps, DocumentKindContribution } from "@artisan/editor-sdk";
import i18next from "i18next";
import { Zap } from "lucide-react";
import { TriggerEditor } from "./TriggerEditor";
import {
  TRIGGER_KIND,
  type Trigger,
  triggerChainSlots,
  triggerFromFile,
  triggerLTextSites,
  triggerToFile,
} from "./trigger";

function TriggerView({ projectId, document }: DocumentEditorProps) {
  return <TriggerEditor projectId={projectId as ProjectId} trigger={document as Trigger} />;
}

/** The short name of a Trigger's event (`Mort`), its wire name when the catalog has none. */
export function eventShortLabel(on: string): string {
  if (!on) return i18next.t("triggers.pickEvent");
  return i18next.t(`triggers.events.${on}.short`, { defaultValue: on });
}

/** The Trigger kind (ADR `triggers-and-variables`), declared like a module's. */
export const triggerKind: DocumentKindContribution = {
  ...TRIGGER_KIND,
  label: "projectPanel.triggers",
  icon: Zap,
  component: TriggerView,
  ownHeader: true,
  create: ({ id, projectId }) =>
    ({
      id,
      projectId: projectId as ProjectId,
      on: "",
      conditions: [],
      enabled: true,
      steps: [],
    }) satisfies Trigger,
  parse: (src, ctx) => triggerFromFile(src as Record<string, unknown>, ctx as DocumentParseOpts),
  serialize: (doc, project) => triggerToFile(doc as Trigger, project as Project),
  ltextSites: (doc) => triggerLTextSites(doc as Trigger),
  chainSlots: (doc) => triggerChainSlots(doc as Trigger),
  board: {
    summary: (doc) => {
      const t = doc as Trigger;
      return i18next.t("triggers.summary", {
        event: eventShortLabel(t.on),
        count: t.steps.length,
      });
    },
    accent: "var(--kind-trigger)",
  },
};

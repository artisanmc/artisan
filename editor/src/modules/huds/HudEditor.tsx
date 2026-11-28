import { MiniMessageField } from "@/components/MiniMessageField";
import { EditorHeader } from "@/components/ui/editor-header";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import type { ProjectId } from "@/domain/types";
import { OverlayComposer } from "@/features/canvas/overlay/OverlayComposer";
import { FieldLabel, Lane } from "@/features/inspector/layout";
import { ConditionListEditor } from "@/features/inspector/properties/ConditionListEditor";
import { useProjectsStore } from "@/state/projectsStore";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  HUD_KIND,
  type Hud,
  type HudLifetime,
  type HudSlot,
  hudPreview,
  lifetimeOf,
  nextTextName,
  readRefresh,
  textLayerNames,
} from "./hud";

/** The refresh periods the page offers, in ticks; another value of the file is kept and listed. */
const REFRESHES = [5, 20, 100, 0] as const;

/**
 * A HUD's page: where it is drawn and how long it stays (permanent, conditional, temporary) with
 * how often it is checked again, then its layout on the game's screen and the text of each text
 * layer, where `{` offers the player's and the Variables' values.
 */
export function HudEditor({ projectId, hud }: { projectId: ProjectId; hud: Hud }) {
  const { t } = useTranslation();
  const updateDocument = useProjectsStore((s) => s.updateDocument);
  const update = (patch: Partial<Hud>) =>
    updateDocument({ projectId, kind: HUD_KIND.kind, id: hud.id, doc: { ...hud, ...patch } });
  // "Conditional" with no condition yet reads back as permanent: the choice is kept here.
  const [picked, setPicked] = useState<HudLifetime | null>(null);
  const lifetime = picked === "conditional" && hud.enabled ? "conditional" : lifetimeOf(hud);
  const location = useMemo(() => ({ kind: "event" as const, values: [] }), []);
  const entries = usePlaceholderEntries(projectId, location);
  const names = textLayerNames(hud.layout);
  const fresh = nextTextName(hud.layout);
  const slots = [...names, fresh].map((name, i) => ({
    name,
    kind: "text" as const,
    label: name === fresh ? t("huds.newText", { n: i + 1 }) : name,
  }));

  const pickLifetime = (next: HudLifetime) => {
    setPicked(next);
    if (next === "permanent") update({ enabled: true, conditions: [] });
    else if (next === "conditional") update({ enabled: true });
    else update({ enabled: false });
  };
  const setText = (name: string, value: string) => {
    const texts = { ...hud.texts };
    if (value === "") delete texts[name];
    else texts[name] = value;
    update({ texts });
  };
  const refreshes: number[] = REFRESHES.includes(hud.refresh as (typeof REFRESHES)[number])
    ? [...REFRESHES]
    : [...REFRESHES, hud.refresh];

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <EditorHeader
        kind={HUD_KIND.kind}
        eyebrow={t("huds.kindLabel")}
        title={<span className="font-mono text-[20px]">{hud.id}</span>}
        details={
          <span className="text-[13px] text-[var(--text-mut)]">
            {t("huds.summary", {
              lifetime: t(`huds.lifetimes.${lifetime}`),
              slot: t(`huds.slots.${hud.slot}`),
            })}
          </span>
        }
      />
      <div className="@container page-inset-x flex-1 overflow-auto py-[var(--page-pad)]">
        <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(280px,360px)_1fr] @5xl:items-start">
          <section className="panel flex flex-col gap-4 rounded-[var(--r-md)] p-4">
            <Lane label={t("huds.where")}>
              <div className="flex flex-col gap-3">
                <div>
                  <FieldLabel>{t("huds.slot")}</FieldLabel>
                  <Segmented<HudSlot>
                    label={t("huds.slot")}
                    value={hud.slot}
                    options={(["boss_bar", "action_bar"] as const).map((v) => ({
                      value: v,
                      label: t(`huds.slots.${v}`),
                    }))}
                    onChange={(slot) => update({ slot })}
                  />
                  <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                    {t("huds.slotHint")}
                  </p>
                </div>
                <div>
                  <FieldLabel>{t("huds.priority")}</FieldLabel>
                  <Input
                    type="number"
                    aria-label={t("huds.priority")}
                    value={hud.priority}
                    onChange={(e) => {
                      const n = Math.trunc(Number(e.target.value));
                      if (Number.isFinite(n)) update({ priority: n });
                    }}
                    className="h-7 w-[120px] text-[12px]"
                  />
                  <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                    {t("huds.priorityHint")}
                  </p>
                </div>
              </div>
            </Lane>
            <Lane label={t("huds.lifetime")}>
              <div className="flex flex-col gap-3">
                <Segmented<HudLifetime>
                  label={t("huds.lifetime")}
                  value={lifetime}
                  options={(["permanent", "conditional", "temporary"] as const).map((v) => ({
                    value: v,
                    label: t(`huds.lifetimes.${v}`),
                  }))}
                  onChange={pickLifetime}
                />
                <p className="text-[11.5px] text-[var(--text-faint)]">
                  {t(`huds.lifetimeHint.${lifetime}`, { id: hud.id })}
                </p>
                {lifetime !== "permanent" ? (
                  <ConditionListEditor
                    label={t(lifetime === "temporary" ? "huds.alsoIf" : "huds.onlyIf")}
                    conditions={hud.conditions}
                    onChange={(conditions) => update({ conditions })}
                    emptyHint={t("huds.onlyIfEmpty")}
                  />
                ) : null}
                <div>
                  <FieldLabel>{t("huds.refresh")}</FieldLabel>
                  <Segmented<number>
                    label={t("huds.refresh")}
                    value={hud.refresh}
                    options={refreshes.map((v) => ({
                      value: v,
                      label: v === 0 ? t("huds.onChange") : t("huds.every", { s: v / 20 }),
                    }))}
                    onChange={(refresh) => update({ refresh: readRefresh(refresh) })}
                  />
                  <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                    {t("huds.refreshHint")}
                  </p>
                </div>
              </div>
            </Lane>
          </section>
          <div className="flex min-w-0 flex-col gap-4">
            <section className="panel rounded-[var(--r-md)] p-4">
              <Lane label={t("huds.layout")} hint={t("huds.layoutHint")}>
                <OverlayComposer
                  projectId={projectId}
                  slot={hud.slot}
                  value={hud.layout}
                  onChange={(layout) => update({ layout })}
                  slots={slots}
                  preview={hudPreview(hud, entries)}
                />
              </Lane>
            </section>
            <section className="panel rounded-[var(--r-md)] p-4">
              <Lane label={t("huds.texts")} hint={t("huds.textsHint")}>
                {names.length === 0 ? (
                  <p className="text-[12px] text-[var(--text-mut)]">{t("huds.noText")}</p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {names.map((name) => (
                      // A div, not a label: a label hands a click in the text to the toolbar's Bold.
                      <div key={name}>
                        <FieldLabel>{name}</FieldLabel>
                        <MiniMessageField
                          value={hud.texts[name] ?? ""}
                          onChange={(value) => setText(name, value)}
                          entries={entries}
                          aria-label={name}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </Lane>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

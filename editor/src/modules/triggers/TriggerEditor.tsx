import { EditorHeader } from "@/components/ui/editor-header";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { ChainAddress } from "@/domain/chainAddress";
import type { ProjectId } from "@/domain/types";
import { ActionChainEditor } from "@/features/inspector/chain/StepTree";
import { FieldLabel, Lane } from "@/features/inspector/layout";
import { ActionScopeProvider } from "@/features/inspector/properties/ActionEditor";
import { ConditionListEditor } from "@/features/inspector/properties/ConditionListEditor";
import { ChainEventProvider } from "@/lib/actions/eventActions";
import type { GameEvent } from "@/lib/api/gameEvents";
import { useProjectsStore } from "@/state/projectsStore";
import { ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { EventPicker } from "./EventPicker";
import { eventContextEntries, findGameEvent, useGameEvents } from "./gameEvents";
import { TRIGGER_KIND, TRIGGER_SLOT, type Trigger } from "./trigger";

/**
 * A Trigger's page: the header says it as a sentence ("Quand un joueur meurt") beside its id
 * (the panel draws no other: `ownHeader`), the left column holds when it runs (its event, the
 * "Seulement si" conditions, the delay, the switch), the right one what it does, with the
 * event's values at hand.
 */
export function TriggerEditor({ projectId, trigger }: { projectId: ProjectId; trigger: Trigger }) {
  const { t } = useTranslation();
  const updateDocument = useProjectsStore((s) => s.updateDocument);
  const { events, serverReady, serverNames } = useGameEvents();
  const event = findGameEvent(events, trigger.on);
  // A fresh trigger opens on the picker: nothing else on the page means anything yet.
  const [picking, setPicking] = useState(trigger.on === "");
  const update = (patch: Partial<Trigger>) =>
    updateDocument({
      projectId,
      kind: TRIGGER_KIND.kind,
      id: trigger.id,
      doc: { ...trigger, ...patch },
    });
  const values = useMemo(() => (event ? eventContextEntries(event) : []), [event]);
  const scope = useMemo(() => ({ kind: "event" as const, values }), [values]);
  const address = useMemo<ChainAddress>(
    () => ({ kind: "document", docKind: TRIGGER_KIND.kind, docId: trigger.id, slot: TRIGGER_SLOT }),
    [trigger.id],
  );
  const eventTitle = trigger.on
    ? t(`triggers.events.${trigger.on}.title`, { defaultValue: trigger.on })
    : t("triggers.pickEvent");
  const missing = trigger.on !== "" && serverReady && !serverNames.has(trigger.on);
  const unbounded =
    event?.frequency === "normal" && trigger.conditions.length === 0 && !trigger.cooldownSeconds;

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <EditorHeader
        kind={TRIGGER_KIND.kind}
        eyebrow={t("triggers.kindLabel")}
        title={eventTitle}
        meta={
          trigger.enabled ? null : (
            <span className="badge badge-brick">{t("triggers.disabledBadge")}</span>
          )
        }
      >
        <span className="min-w-0 max-w-full truncate font-mono text-[12.5px] text-[var(--text-faint)]">
          {trigger.id}
        </span>
      </EditorHeader>
      <div className="@container flex-1 overflow-auto px-4 py-4">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(280px,360px)_1fr] @3xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="panel rounded-[var(--r-md)] p-4">
              <Lane label={t("triggers.trigger")}>
                <div className="flex flex-col gap-3">
                  <div>
                    <FieldLabel>{t("triggers.event")}</FieldLabel>
                    <button
                      type="button"
                      onClick={() => setPicking(true)}
                      className="input flex h-auto w-full items-center justify-between gap-2 py-1.5 text-left"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] text-[var(--text)]">
                          {eventTitle}
                        </span>
                        {trigger.on ? (
                          <span className="block font-mono text-[11px] text-[var(--text-faint)]">
                            {trigger.on}
                          </span>
                        ) : null}
                      </span>
                      <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-faint)]" />
                    </button>
                    {event ? <EventMeta event={event} /> : null}
                  </div>
                  {trigger.on === "" ? <Warning>{t("triggers.noEvent")}</Warning> : null}
                  {missing ? (
                    <Warning>{t("triggers.missingOnServer", { name: trigger.on })}</Warning>
                  ) : null}
                  {unbounded ? <Warning>{t("triggers.frequentWarning")}</Warning> : null}
                  <div>
                    <ConditionListEditor
                      label={t("triggers.onlyIf")}
                      conditions={trigger.conditions}
                      onChange={(conditions) => update({ conditions })}
                      emptyHint={t("triggers.onlyIfEmpty")}
                    />
                    <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                      {t("triggers.onlyIfHint")}
                    </p>
                  </div>
                  <CooldownField
                    value={trigger.cooldownSeconds}
                    onChange={(cooldownSeconds) => update({ cooldownSeconds })}
                  />
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-medium text-[var(--text-mut)]">
                        {t("triggers.enabled")}
                      </span>
                      <Switch
                        checked={trigger.enabled}
                        onCheckedChange={(enabled) => update({ enabled })}
                        aria-label={t("triggers.enabled")}
                      />
                    </div>
                    {trigger.enabled ? null : (
                      <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                        {t("triggers.disabledHint")}
                      </p>
                    )}
                  </div>
                </div>
              </Lane>
            </section>
            <section className="panel rounded-[var(--r-md)] p-4">
              <Lane label={t("triggers.settings")}>
                <TriggerIdField projectId={projectId} id={trigger.id} />
              </Lane>
            </section>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {values.length > 0 ? (
              <section className="panel rounded-[var(--r-md)] p-4">
                <Lane label={t("triggers.values")} hint={t("triggers.valuesHint", { brace: "{" })}>
                  <EventValues paths={values.map((v) => v.path)} />
                </Lane>
              </section>
            ) : null}
            <section className="panel min-w-0 rounded-[var(--r-md)] p-4">
              <Lane label={t("triggers.steps")} hint={t("triggers.stepsHint")}>
                <div className="overflow-x-auto">
                  <ChainEventProvider value={event ?? null}>
                    <ActionScopeProvider value={scope}>
                      <ActionChainEditor
                        projectId={projectId}
                        address={address}
                        steps={trigger.steps}
                      />
                    </ActionScopeProvider>
                  </ChainEventProvider>
                </div>
              </Lane>
            </section>
          </div>
        </div>
      </div>
      <EventPicker
        open={picking}
        onOpenChange={setPicking}
        value={trigger.on}
        onPick={(on) => update({ on })}
      />
    </div>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-1.5 rounded-[var(--r-xs)] border border-[var(--warning)] bg-[var(--warning-soft)] px-2 py-1.5 text-[12px] text-[var(--warning)]">
      <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/** "Rare · annulable · 2 effets possibles": what the trigger can do with its event. */
function EventMeta({ event }: { event: GameEvent }) {
  const { t } = useTranslation();
  const parts = [
    event.frequency === "normal" ? t("triggers.meta.normal") : t("triggers.meta.rare"),
    event.cancellable ? t("triggers.meta.cancellable") : t("triggers.meta.notCancellable"),
    event.effects.length > 0
      ? t("triggers.meta.effects", { count: event.effects.length })
      : t("triggers.meta.noEffects"),
  ];
  return <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">{parts.join(" · ")}</p>;
}

/** `{event.location.x}` chips: a click copies the placeholder. */
function EventValues({ paths }: { paths: string[] }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap gap-1.5">
      {paths.map((path) => {
        const value = `{${path}}`;
        return (
          <button
            key={path}
            type="button"
            className="chip font-mono text-[11.5px]"
            onClick={() => {
              void navigator.clipboard?.writeText(value);
              toast.success(t("triggers.copied", { value }));
            }}
          >
            {value}
          </button>
        );
      })}
    </div>
  );
}

/** Seconds, per player; empty or 0 means none. */
function CooldownField({
  value,
  onChange,
}: {
  value: number | undefined;
  onChange: (seconds: number | undefined) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <FieldLabel>{t("triggers.cooldown")}</FieldLabel>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          step={1}
          value={value ?? ""}
          placeholder={t("triggers.cooldownNone")}
          onChange={(e) => {
            const n = Math.floor(Number(e.target.value));
            onChange(e.target.value.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined);
          }}
          className="h-8 w-28 rounded-[var(--r-xs)] px-2 py-0 font-mono text-xs"
          aria-label={t("triggers.cooldown")}
        />
        <span className="text-[12px] text-[var(--text-faint)]">{t("triggers.secondsUnit")}</span>
      </div>
      <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">{t("triggers.cooldownHint")}</p>
    </div>
  );
}

/** The file's id (`triggers/<id>.yml`): renamed through the host, texts following. */
function TriggerIdField({ projectId, id }: { projectId: ProjectId; id: string }) {
  const { t } = useTranslation();
  const setDocumentId = useProjectsStore((s) => s.setDocumentId);
  const [draft, setDraft] = useState(id);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(id);
    setError(null);
  }, [id]);
  const commit = () => {
    if (draft === id) return;
    try {
      setDocumentId({ projectId, kind: TRIGGER_KIND.kind, oldId: id, newId: draft.trim() });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("menuProperties.renameRejected"));
      setDraft(id);
    }
  };
  return (
    <div>
      <FieldLabel>{t("triggers.id")}</FieldLabel>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(id);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 rounded-[var(--r-xs)] border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 rounded-[var(--r-xs)] px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[12px] text-[var(--danger)]">{error}</div> : null}
    </div>
  );
}

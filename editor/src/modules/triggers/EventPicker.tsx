import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { GameEvent } from "@/lib/api/gameEvents";
import { cx } from "@/lib/cx";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { EVENT_GROUPS, useGameEvents } from "./gameEvents";

/** Lower-case, accents dropped: "évé" finds "Événement". */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

/** The events by domain: the core's in their order, then each module's group by name. */
export function groupEvents(events: readonly GameEvent[]): [string, GameEvent[]][] {
  const byGroup = new Map<string, GameEvent[]>();
  for (const e of events) {
    const list = byGroup.get(e.group) ?? [];
    list.push(e);
    byGroup.set(e.group, list);
  }
  const rank = (g: string) => {
    const i = (EVENT_GROUPS as readonly string[]).indexOf(g);
    return i < 0 ? EVENT_GROUPS.length : i;
  };
  return [...byGroup.entries()].sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b));
}

/**
 * The Game events a Trigger may listen to, grouped by domain and searchable by their
 * phrase or wire name. Each row says what the trigger will be able to do with it
 * (cancel, change) and warns of a frequent event or one the active server does not fire.
 */
export function EventPicker({
  open,
  onOpenChange,
  value,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  onPick: (name: string) => void;
}) {
  const { t } = useTranslation();
  const { events, serverReady, serverNames } = useGameEvents();
  const [query, setQuery] = useState("");
  const title = (e: GameEvent) => t(`triggers.events.${e.name}.title`, { defaultValue: e.name });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `title` derives from `t`
  const groups = useMemo(() => {
    const q = fold(query.trim());
    const shown = q
      ? events.filter((e) =>
          [e.name, title(e), t(`triggers.events.${e.name}.short`, { defaultValue: "" })].some((s) =>
            fold(s).includes(q),
          ),
        )
      : events;
    return groupEvents(shown);
  }, [events, query, t]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[80vh] max-w-xl flex-col gap-3">
        <DialogTitle>{t("triggers.picker.title")}</DialogTitle>
        <DialogDescription className="sr-only">{t("triggers.picker.search")}</DialogDescription>
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("triggers.picker.search")}
          aria-label={t("triggers.picker.search")}
        />
        <div className="-mx-2 min-h-0 flex-1 overflow-y-auto px-2">
          {groups.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-[var(--text-faint)]">
              {t("triggers.picker.empty")}
            </p>
          ) : (
            groups.map(([group, list]) => (
              <section key={group} className="mb-3">
                <div className="eyebrow mb-1">
                  {t(`triggers.groups.${group}`, { defaultValue: group })}
                </div>
                <ul className="flex flex-col gap-0.5">
                  {list.map((e) => {
                    const missing = serverReady && !serverNames.has(e.name);
                    const effects = e.effects
                      .map((f) =>
                        t(`triggers.effects.${f.name}`, { defaultValue: f.label ?? f.name }),
                      )
                      .join(", ");
                    return (
                      <li key={e.name}>
                        <button
                          type="button"
                          onClick={() => {
                            onPick(e.name);
                            setQuery("");
                            onOpenChange(false);
                          }}
                          title={
                            missing
                              ? t("triggers.picker.moduleMissingHint", {
                                  module: e.moduleId ?? "Artisan",
                                })
                              : undefined
                          }
                          className={cx(
                            "flex w-full flex-col gap-0.5 rounded-[var(--r-sm)] px-2.5 py-1.5 text-left hover:bg-[var(--surface-hover)]",
                            e.name === value && "bg-[var(--kind-trigger-soft)]",
                          )}
                        >
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-medium text-[var(--text)]">
                              {title(e)}
                            </span>
                            <span className="font-mono text-[11px] text-[var(--text-faint)]">
                              {e.name}
                            </span>
                            {e.cancellable ? (
                              <Badge variant="sage">{t("triggers.picker.cancellable")}</Badge>
                            ) : null}
                            {e.frequency === "normal" ? (
                              <Badge variant="amber">{t("triggers.picker.frequent")}</Badge>
                            ) : null}
                            {missing ? (
                              <Badge variant="brick">{t("triggers.picker.moduleMissing")}</Badge>
                            ) : null}
                          </span>
                          {effects ? (
                            <span className="text-[11.5px] text-[var(--text-mut)]">
                              {t("triggers.picker.editable", { effects })}
                            </span>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { Switch } from "@/components/ui/switch";
import { TagInput } from "@/components/ui/tag-input";
import { commandsOf, documentsOf, menusOf } from "@/domain/documents";
import type { Command, Condition, Project } from "@/domain/types";
import { cn } from "@/lib/cx";
import type { Trigger } from "@/modules/triggers/trigger";
import { LayoutGrid, Play, SquareTerminal, Trash2, Zap } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { conditionKey } from "./engine/conditions";
import type { PlayLogEntry, PlaySession } from "./engine/session";
import type { TestPlayer } from "./engine/testPlayer";

function Panel({
  title,
  action,
  children,
  testId,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <section className="card flex flex-col gap-3 p-4" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="eyebrow">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A command that cannot run as typed alone: a required argument, or sub-commands only. */
const needsMore = (c: Command) =>
  c.arguments.some((a) => a.required && a.default === undefined) ||
  (c.steps.length === 0 && (c.subcommands?.length ?? 0) > 0);

/**
 * What can be started from outside the game, per Project: its commands (one that needs an
 * argument goes to the chat, typed up to its name), its menus, and its Triggers, fired as
 * if their event happened. The focused Project comes first.
 */
export function PlayLauncher({
  projects,
  focus,
  session,
  onTypeCommand,
}: {
  projects: readonly Project[];
  focus?: string;
  session: PlaySession;
  onTypeCommand: (line: string) => void;
}) {
  const { t } = useTranslation();
  const ordered = [...projects].sort(
    (a, b) => Number(isFocus(b, focus)) - Number(isFocus(a, focus)),
  );
  const row = (
    key: string,
    icon: ReactNode,
    label: ReactNode,
    onRun: () => void,
    runLabel: string,
  ) => (
    <li key={key} className="flex items-center gap-2">
      {icon}
      <span className="mono min-w-0 flex-1 truncate text-[12.5px]">{label}</span>
      <button
        type="button"
        className="btn btn-ghost btn-icon btn-sm"
        aria-label={runLabel}
        title={runLabel}
        onClick={onRun}
      >
        <Play className="size-3.5" />
      </button>
    </li>
  );
  const iconClass = "size-4 shrink-0 text-[var(--text-faint)]";
  const groups = ordered
    .map((project) => ({
      project,
      commands: commandsOf(project).filter((c) => c.enabled !== false),
      menus: menusOf(project),
      triggers: documentsOf(project, "trigger") as unknown as Trigger[],
    }))
    .filter((g) => g.commands.length + g.menus.length + g.triggers.length > 0);
  return (
    <Panel title={t("play.launcher.title")} testId="play-launcher">
      {groups.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-mut)]">{t("play.launcher.empty")}</p>
      ) : (
        groups.map(({ project, commands, menus, triggers }) => (
          <div key={project.id} className="flex flex-col gap-1" data-project={project.id}>
            {groups.length > 1 && (
              <span className="field-label truncate">{project.name || project.id}</span>
            )}
            <ul className="flex flex-col gap-1">
              {commands.map((c) =>
                row(
                  `c/${c.id}`,
                  <SquareTerminal className={iconClass} />,
                  `/${c.name}`,
                  () =>
                    needsMore(c) ? onTypeCommand(`/${c.name} `) : session.runCommand(`/${c.name}`),
                  t("play.launcher.runCommand", { name: c.name }),
                ),
              )}
              {menus.map((m) =>
                row(
                  `m/${m.id}`,
                  <LayoutGrid className={iconClass} />,
                  m.id,
                  () => session.openMenuById(project.id, m.id),
                  t("play.launcher.openMenu", { id: m.id }),
                ),
              )}
              {triggers.map((tr) =>
                row(
                  `t/${tr.id}`,
                  <Zap className={iconClass} />,
                  <>
                    {tr.id}
                    <span className="text-[var(--text-faint)]"> · {tr.on || "?"}</span>
                  </>,
                  () => session.runTrigger(tr),
                  t("play.launcher.fireTrigger", { id: tr.id }),
                ),
              )}
            </ul>
          </div>
        ))
      )}
    </Panel>
  );
}

const isFocus = (p: Project, focus?: string) =>
  focus != null && (p.id === focus || p.diskId === focus);

const placeholdersText = (p: Record<string, string>) =>
  Object.entries(p)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

function parsePlaceholders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const at = line.indexOf("=");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim().replace(/^%|%$/g, "");
    if (name) out[name] = line.slice(at + 1).trim();
  }
  return out;
}

/** A condition the preview could not evaluate, as its wire reads: `has_item: DIAMOND`. */
function conditionLabel(c: Condition): string {
  const wire = JSON.parse(conditionKey(c)) as Record<string, unknown>;
  const [name, value] = Object.entries(wire)[0] ?? ["?", null];
  return value == null
    ? name
    : `${name}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`;
}

/**
 * The test player: who plays, what they hold, and the value of each condition the preview
 * met but cannot evaluate. Saved per server in this browser.
 */
export function TestPlayerPanel({
  player,
  onChange,
  forced,
}: {
  player: TestPlayer;
  onChange: (next: TestPlayer) => void;
  forced: Record<string, Condition>;
}) {
  const { t } = useTranslation();
  const [placeholders, setPlaceholders] = useState(placeholdersText(player.placeholders));
  useEffect(() => setPlaceholders(placeholdersText(player.placeholders)), [player.placeholders]);
  const set = (patch: Partial<TestPlayer>) => onChange({ ...player, ...patch });
  const number = (key: "money" | "xp" | "level") => (
    <label className="field-label flex flex-col gap-1">
      {t(`play.player.${key}`)}
      <input
        type="number"
        className="input"
        value={player[key]}
        onChange={(e) => set({ [key]: Number(e.target.value) || 0 })}
      />
    </label>
  );
  const forcedEntries = Object.entries(forced);
  return (
    <Panel title={t("play.player.title")} testId="play-player">
      <div className="grid grid-cols-2 gap-2">
        <label className="field-label flex flex-col gap-1">
          {t("play.player.name")}
          <input
            className="input"
            value={player.name}
            onChange={(e) => set({ name: e.target.value || "Steve" })}
          />
        </label>
        <label className="field-label flex flex-col gap-1">
          {t("play.player.world")}
          <input
            className="input"
            value={player.world}
            onChange={(e) => set({ world: e.target.value })}
          />
        </label>
        {number("money")}
        {number("level")}
        {number("xp")}
      </div>
      <div className="flex items-center justify-between gap-2 text-[13px]">
        {t("play.player.op")}
        <Switch
          checked={player.op}
          onCheckedChange={(op) => set({ op })}
          aria-label={t("play.player.op")}
        />
      </div>
      <div className="field-label flex flex-col gap-1">
        {t("play.player.permissions")}
        <TagInput
          values={player.permissions}
          mono
          label={t("play.player.permissions")}
          removeLabel={(v) => t("play.player.removePermission", { permission: v })}
          placeholder="shop.vip"
          onAdd={(v) => {
            if (player.permissions.includes(v)) return false;
            set({ permissions: [...player.permissions, v] });
            return undefined;
          }}
          onRemove={(i) => set({ permissions: player.permissions.filter((_, k) => k !== i) })}
        />
      </div>
      <label className="field-label flex flex-col gap-1">
        {t("play.player.placeholders")}
        <textarea
          className="input mono min-h-16 text-[12px]"
          value={placeholders}
          placeholder="vault_eco_balance=1200"
          onChange={(e) => setPlaceholders(e.target.value)}
          onBlur={() => set({ placeholders: parsePlaceholders(placeholders) })}
        />
      </label>
      {forcedEntries.length > 0 && (
        <div className="flex flex-col gap-1.5" data-testid="play-forced">
          <span className="field-label">{t("play.player.forced")}</span>
          <p className="text-[11.5px] text-[var(--text-faint)]">{t("play.player.forcedHint")}</p>
          {forcedEntries.map(([key, condition]) => (
            <div key={key} className="flex items-center justify-between gap-2">
              <span className="mono min-w-0 truncate text-[12px]">{conditionLabel(condition)}</span>
              <Switch
                checked={player.forced[key] ?? true}
                onCheckedChange={(v) => set({ forced: { ...player.forced, [key]: v } })}
                aria-label={conditionLabel(condition)}
              />
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

const KIND_CLASS: Record<PlayLogEntry["kind"], string> = {
  visual: "text-[var(--text)]",
  logged: "text-[var(--text-mut)]",
  sound: "text-[var(--text-mut)]",
  info: "text-[var(--brand)]",
  warn: "text-[var(--warning)]",
};

/** The journal: every action in order, newest first, with where it ran from. */
export function PlayLog({ entries, onClear }: { entries: PlayLogEntry[]; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <Panel
      title={t("play.log.title")}
      testId="play-log"
      action={
        entries.length > 0 ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon btn-sm"
            aria-label={t("play.log.clear")}
            title={t("play.log.clear")}
            onClick={onClear}
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : undefined
      }
    >
      {entries.length === 0 ? (
        <p className="text-[12.5px] text-[var(--text-mut)]">{t("play.log.empty")}</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {[...entries].reverse().map((e) => (
            <li key={e.id} data-kind={e.kind} className="flex flex-col">
              <span className={cn("text-[12.5px]", KIND_CLASS[e.kind])}>
                {e.kind === "logged" ? `→ ${e.text}` : e.text}
              </span>
              <span className="mono truncate text-[11px] text-[var(--text-faint)]">{e.source}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

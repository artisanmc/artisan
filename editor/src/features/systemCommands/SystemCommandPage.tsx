import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { configWrite } from "@/lib/api/configScreens";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import { createProject } from "@/lib/api/servers";
import {
  type OverrideFields,
  type StoredOverride,
  type Texts,
  allCommands,
  commandNamespace,
  overrideFolder,
  overridePath,
  serializeOverride,
} from "@/lib/commandOverride";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

const DEFAULT_LANGS = ["fr", "en"];

/**
 * A module command in the System section (design `framework-commandes` §3.9): the module's
 * values as placeholders, the admin's override as the form's content. Saving writes one
 * `command_override/v1` file per changed command (subcommands included); a form back to the
 * module's values deletes the file.
 */
export function SystemCommandPage({
  serverId,
  commandId,
}: { serverId: string; commandId: string }) {
  const { t } = useTranslation();
  const status = useSystemCommandsStore((s) => s.status);
  const commands = useSystemCommandsStore((s) => s.commands);
  const overrides = useSystemCommandsStore((s) => s.overrides);
  const command = useMemo(
    () => allCommands(commands).find((c) => c.id === commandId),
    [commands, commandId],
  );
  const tree = useMemo(() => (command ? allCommands([command]) : []), [command]);
  const stored = useMemo(() => storedFields(tree, overrides), [tree, overrides]);
  const [drafts, setDrafts] = useState<Record<string, OverrideFields>>(stored);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // What the server holds changed (a save, a reload): the form starts again from it.
  useEffect(() => {
    setDrafts(stored);
  }, [stored]);

  if (!command) {
    return status === "ready" ? (
      <EmptyState icon={Terminal} title={t("systemCommands.notFound")} />
    ) : (
      <EmptyState icon={Terminal} title={t("systemCommands.loading")} />
    );
  }

  const changed = tree.filter(
    (c) => fileFor(c, drafts, overrides) !== fileFor(c, stored, overrides),
  );
  const logic = tree.some((c) => overrides[c.id]?.hasLogic);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { folders } = useSystemCommandsStore.getState();
      const byFolder = new Map<
        string,
        { files: { path: string; content: string }[]; deletes: string[] }
      >();
      for (const c of changed) {
        const existing = overrides[c.id];
        let folder = overrideFolder(c, existing, folders);
        if (!folder) {
          // Its module has no folder on this server: the namespace's folder is created for it.
          const namespace = commandNamespace(c.id);
          folder = byFolder.has(namespace)
            ? namespace
            : ((await createProject(serverId, namespace)).externalId ?? namespace);
        }
        const batch = byFolder.get(folder) ?? { files: [], deletes: [] };
        const content = fileFor(c, drafts, overrides);
        const path = existing?.path ?? overridePath(c.id);
        if (content === null) {
          if (existing) batch.deletes.push(path);
        } else {
          batch.files.push({ path, content });
        }
        byFolder.set(folder, batch);
      }
      for (const [folder, batch] of byFolder) {
        if (batch.files.length === 0 && batch.deletes.length === 0) continue;
        const res = await configWrite(serverId, { projectId: folder, ...batch });
        if (!res.ok) {
          setError(
            t(`systemCommands.errors.${res.error}`, {
              defaultValue: t("systemCommands.errors.write_error"),
            }),
          );
          return;
        }
      }
      setSaved(true);
    } catch {
      setError(t("systemCommands.errors.write_error"));
    } finally {
      setSaving(false);
      const { serverId: loaded, load } = useSystemCommandsStore.getState();
      if (loaded) await load(loaded, true);
    }
  };

  const update = (id: string, fields: OverrideFields) => {
    setSaved(false);
    setDrafts((current) => ({ ...current, [id]: fields }));
  };

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 overflow-y-auto pb-10">
      <header className="flex flex-col gap-1">
        <span className="eyebrow">
          {t("systemCommands.eyebrow", {
            module: command.moduleId ?? commandNamespace(command.id),
          })}
        </span>
        <h1 className="text-[22px] font-semibold text-[var(--text)]">
          /{drafts[command.id]?.name?.trim() || command.name}
        </h1>
        <p className="text-[12.5px] text-[var(--text-mut)]">{t("systemCommands.intro")}</p>
      </header>
      {logic && (
        <div className="card p-3 text-[12.5px] text-[var(--text-mut)]">
          {t("systemCommands.logicKept")}
        </div>
      )}
      {tree.map((c) => (
        <CommandForm
          key={c.id}
          command={c}
          root={c.id === command.id}
          label={c.id === command.id ? null : labelOf(command, c)}
          fields={drafts[c.id] ?? { enabled: true }}
          onChange={(fields) => update(c.id, fields)}
        />
      ))}
      <div className="sticky bottom-0 flex flex-wrap items-center gap-2 border-t border-[var(--border)] bg-[var(--surface)] py-3">
        <Button
          variant="primary"
          disabled={saving || changed.length === 0}
          onClick={() => void save()}
        >
          {saving ? t("systemCommands.saving") : t("systemCommands.save")}
        </Button>
        <Button
          variant="ghost"
          disabled={saving || changed.length === 0}
          onClick={() => setDrafts(stored)}
        >
          {t("systemCommands.discard")}
        </Button>
        <Button
          variant="ghost"
          disabled={saving}
          onClick={() => setDrafts(Object.fromEntries(tree.map((c) => [c.id, { enabled: true }])))}
        >
          {t("systemCommands.resetAll")}
        </Button>
        {error && <span className="text-[12.5px] text-[var(--danger)]">{error}</span>}
        {saved && !error && changed.length === 0 && (
          <span className="text-[12.5px] text-[var(--text-mut)]">{t("systemCommands.saved")}</span>
        )}
      </div>
    </div>
  );
}

function storedFields(
  tree: PlayerCommand[],
  overrides: Record<string, StoredOverride>,
): Record<string, OverrideFields> {
  return Object.fromEntries(tree.map((c) => [c.id, overrides[c.id]?.fields ?? { enabled: true }]));
}

function fileFor(
  command: PlayerCommand,
  fields: Record<string, OverrideFields>,
  overrides: Record<string, StoredOverride>,
): string | null {
  return serializeOverride(
    command.id,
    fields[command.id] ?? { enabled: true },
    overrides[command.id]?.content ?? null,
  );
}

/** `/root child grandchild`, as a player types it. */
function labelOf(root: PlayerCommand, target: PlayerCommand): string {
  const path = (node: PlayerCommand, trail: string[]): string[] | null => {
    if (node.id === target.id) return trail;
    for (const child of node.children) {
      const found = path(child, [...trail, child.name]);
      if (found) return found;
    }
    return null;
  };
  return `/${[root.name, ...(path(root, []) ?? [])].join(" ")}`;
}

function languagesOf(...values: (Texts | undefined)[]): string[] {
  const langs = new Set(DEFAULT_LANGS);
  for (const value of values) for (const lang of Object.keys(value ?? {})) langs.add(lang);
  return [...langs];
}

function CommandForm({
  command,
  root,
  label,
  fields,
  onChange,
}: {
  command: PlayerCommand;
  root: boolean;
  label: string | null;
  fields: OverrideFields;
  onChange: (fields: OverrideFields) => void;
}) {
  const { t } = useTranslation();
  const set = (patch: Partial<OverrideFields>) => onChange({ ...fields, ...patch });
  const noPermission = fields.permission === "";
  const cooldown = fields.cooldown;
  return (
    <section className="card flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          {label && <span className="mono truncate text-[13px] text-[var(--text)]">{label}</span>}
          <span className="mono truncate text-[11px] text-[var(--text-faint)]">{command.id}</span>
        </div>
        <span className="text-[12.5px] text-[var(--text-mut)]">{t("systemCommands.enabled")}</span>
        <Switch
          checked={fields.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          aria-label={t("systemCommands.enabled")}
        />
      </div>
      {root && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("systemCommands.name")} hint={t("systemCommands.moduleValueHint")}>
            <Input
              value={fields.name ?? ""}
              placeholder={command.name}
              onChange={(e) => set({ name: e.target.value || undefined })}
            />
          </FormField>
          <FormField label={t("systemCommands.aliases")} hint={t("systemCommands.aliasesHint")}>
            <Input
              value={fields.aliases?.join(",") ?? ""}
              placeholder={command.aliases.join(", ") || t("systemCommands.none")}
              onChange={(e) =>
                set({
                  aliases: e.target.value.trim() === "" ? undefined : e.target.value.split(","),
                })
              }
            />
          </FormField>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <FormField
          label={t("systemCommands.permission")}
          hint={t("systemCommands.moduleValueHint")}
        >
          <Input
            value={noPermission ? "" : (fields.permission ?? "")}
            disabled={noPermission}
            placeholder={command.permission ?? t("systemCommands.none")}
            onChange={(e) => set({ permission: e.target.value || undefined })}
          />
        </FormField>
        {/* biome-ignore lint/a11y/noLabelWithoutControl: the checkbox is inside the label, which associates it implicitly */}
        <label className="flex items-center gap-2 text-[12.5px] text-[var(--text-mut)]">
          <Checkbox
            aria-label={t("systemCommands.noPermission")}
            checked={noPermission}
            onCheckedChange={(checked) => set({ permission: checked ? "" : undefined })}
          />
          {t("systemCommands.noPermission")}
        </label>
      </div>
      <TextsField
        label={t("systemCommands.description")}
        value={fields.description}
        defaults={command.description}
        onChange={(description) => set({ description })}
      />
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label={t("systemCommands.cooldown")} hint={t("systemCommands.cooldownHint")}>
            <Input
              type="number"
              min={0}
              value={cooldown?.duration ?? ""}
              placeholder="0"
              onChange={(e) => {
                const duration = Number(e.target.value);
                set({
                  cooldown: duration > 0 ? { scope: "player", ...cooldown, duration } : undefined,
                });
              }}
            />
          </FormField>
          {cooldown && (
            <FormField label={t("systemCommands.cooldownScope")}>
              <select
                className="select"
                value={cooldown.scope}
                onChange={(e) =>
                  set({
                    cooldown: {
                      ...cooldown,
                      scope: e.target.value === "global" ? "global" : "player",
                    },
                  })
                }
              >
                <option value="player">{t("systemCommands.scopePlayer")}</option>
                <option value="global">{t("systemCommands.scopeGlobal")}</option>
              </select>
            </FormField>
          )}
        </div>
        {cooldown && (
          <TextsField
            label={t("systemCommands.cooldownMessage")}
            value={cooldown.message}
            defaults={{}}
            onChange={(message) =>
              set({
                cooldown: { ...cooldown, ...(message ? { message } : { message: undefined }) },
              })
            }
          />
        )}
      </div>
    </section>
  );
}

/** One input per language; `*` (a plain string in the file) applies to every language. */
function TextsField({
  label,
  value,
  defaults,
  onChange,
}: {
  label: string;
  value: Texts | undefined;
  defaults: Texts;
  onChange: (value: Texts | undefined) => void;
}) {
  const { t } = useTranslation();
  const langs = languagesOf(value, defaults);
  const write = (lang: string, text: string) => {
    const next = Object.fromEntries(
      Object.entries({ ...(value ?? {}), [lang]: text }).filter(([, entry]) => entry !== ""),
    );
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="field-label !mb-0">{label}</span>
      {langs.map((lang) => (
        <div key={lang} className="flex items-center gap-2">
          <span className="mono w-14 shrink-0 text-[11px] text-[var(--text-faint)]">
            {lang === "*" ? t("systemCommands.allLanguages") : lang}
          </span>
          <Input
            value={value?.[lang] ?? ""}
            placeholder={defaults[lang] ?? defaults["*"] ?? ""}
            onChange={(e) => write(lang, e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}

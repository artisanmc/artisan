import { MiniMessageField } from "@/components/MiniMessageField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EditorHeader } from "@/components/ui/editor-header";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { IconTile } from "@/components/ui/icon-tile";
import { Input } from "@/components/ui/input";
import { ResetButton } from "@/components/ui/reset-button";
import { Switch } from "@/components/ui/switch";
import type { ProjectId, Step } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { configWrite } from "@/lib/api/configScreens";
import type { PlayerCommand } from "@/lib/api/playerCommands";
import { createProject } from "@/lib/api/servers";
import {
  type OverrideFields,
  type StoredOverride,
  type Texts,
  allCommands,
  commandNamespace,
  moduleChanges,
  overrideFolder,
  overridePath,
  serializeOverride,
} from "@/lib/commandOverride";
import { kindAppearance } from "@/lib/documentKindAppearance";
import { stepsFromWire, stepsToWire } from "@/lib/literalSteps";
import { useSystemCommandsStore } from "@/state/systemCommandsStore";
import { useUiStore } from "@/state/uiStore";
import { Terminal } from "lucide-react";
import { type ComponentType, type ReactNode, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * A module command in the System section (design `framework-commandes` §3.9): every field
 * holds the module's value until the admin changes it, and a reset beside it, live only once
 * it differs, puts the module's value back. Saving writes one `command_override/v1` file per
 * changed command (subcommands included); a command back to the module's values keeps its
 * file with those values as comments, as the server writes it.
 */
/** The step chain editor a page edits a command's steps with (the inspector's, given by its caller). */
export type StepsEditor = ComponentType<{
  projectId: ProjectId;
  value: Step[];
  onChange: (steps: Step[]) => void;
}>;

export function SystemCommandPage({
  serverId,
  commandId,
  stepsEditor,
  layout = "page",
}: {
  serverId: string;
  commandId: string;
  stepsEditor: StepsEditor;
  /** `panel`: in the board's Properties panel, full width, no page margins. */
  layout?: "page" | "panel";
}) {
  const { t } = useTranslation();
  const status = useSystemCommandsStore((s) => s.status);
  const folders = useSystemCommandsStore((s) => s.folders);
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
    (c) =>
      fileFor(c, c === command, drafts, overrides) !== fileFor(c, c === command, stored, overrides),
  );
  const logic = tree.some((c) => overrides[c.id]?.hasLogic);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { folders } = useSystemCommandsStore.getState();
      const byFolder = new Map<string, { path: string; content: string }[]>();
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
        const files = byFolder.get(folder) ?? [];
        files.push({
          path: existing?.path ?? overridePath(c.id),
          content: fileFor(c, c === command, drafts, overrides),
        });
        byFolder.set(folder, files);
      }
      for (const [folder, files] of byFolder) {
        const res = await configWrite(serverId, { projectId: folder, files });
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

  const header = (
    <EditorHeader
      kind="command"
      eyebrow={t("systemCommands.eyebrow", {
        module: command.moduleId ?? commandNamespace(command.id),
      })}
      title={`/${drafts[command.id]?.name?.trim() || command.name}`}
    >
      <span className="min-w-0 max-w-full truncate font-mono text-[12.5px] text-[var(--text-faint)]">
        {command.id}
      </span>
    </EditorHeader>
  );
  return (
    <div
      className={
        layout === "panel"
          ? "flex h-full min-h-0 w-full flex-col overflow-y-auto"
          : "mx-auto flex w-full max-w-[760px] flex-col gap-5 overflow-y-auto pb-10"
      }
    >
      {/* As a Document's: flush at the top of the panel, its id under the title. */}
      {layout === "panel" ? (
        header
      ) : (
        <div className="panel overflow-hidden rounded-[var(--r-md)]">{header}</div>
      )}
      <div className={layout === "panel" ? "flex flex-col gap-3 px-3 pt-3" : "contents"}>
        <p className="text-[13px] text-[var(--text-mut)]">{t("systemCommands.intro")}</p>
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
            label={
              c.id === command.id
                ? `/${drafts[command.id]?.name?.trim() || command.name}`
                : labelOf(command, c)
            }
            folder={overrideFolder(c, overrides[c.id], folders) ?? commandNamespace(c.id)}
            stepsEditor={stepsEditor}
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
            onClick={() =>
              setDrafts(Object.fromEntries(tree.map((c) => [c.id, { enabled: true }])))
            }
          >
            {t("systemCommands.resetAll")}
          </Button>
          {error && <span className="text-[12.5px] text-[var(--danger)]">{error}</span>}
          {saved && !error && changed.length === 0 && (
            <span className="text-[12.5px] text-[var(--text-mut)]">
              {t("systemCommands.saved")}
            </span>
          )}
        </div>
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
  root: boolean,
  fields: Record<string, OverrideFields>,
  overrides: Record<string, StoredOverride>,
): string {
  return serializeOverride(
    command,
    fields[command.id] ?? { enabled: true },
    overrides[command.id]?.content ?? null,
    root,
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

function CommandForm({
  command,
  root,
  label,
  folder,
  stepsEditor,
  fields,
  onChange,
}: {
  command: PlayerCommand;
  root: boolean;
  /** `/name` as players type it, a sub-command's in full. */
  label: string;
  /** The module folder its override lives in: the project its steps edit against. */
  folder: string;
  stepsEditor: StepsEditor;
  fields: OverrideFields;
  onChange: (fields: OverrideFields) => void;
}) {
  const { t } = useTranslation();
  const look = kindAppearance("command");
  const set = (patch: Partial<OverrideFields>) => onChange({ ...fields, ...patch });
  const changes = (patch: Partial<OverrideFields>) =>
    moduleChanges(command, { enabled: true, ...patch });
  const name = fields.name ?? command.name;
  const aliases = fields.aliases?.join(",") ?? command.aliases.join(", ");
  const modulePermission = command.permission ?? "";
  const permission = fields.permission ?? modulePermission;
  const description = fields.description ?? command.description;
  const cooldown = fields.cooldown;
  const lang = useUiStore((s) => s.activeLang);
  // The root opens unfolded: its page is about it. A sub-command shows its card until edited.
  const [open, setOpen] = useState(root);
  const state = !fields.enabled
    ? "disabled"
    : Object.keys(moduleChanges(command, fields)).length > 1
      ? "modified"
      : null;
  // Folded, the card says what the command does; open, its fields say it.
  const summary = open ? "" : textIn(description, lang);
  return (
    <section className="panel flex flex-col gap-4 rounded-[var(--r-md)] p-4">
      <div className="flex items-start gap-3">
        <span className="flex shrink-0 pt-0.5" aria-hidden>
          <IconTile icon={look.icon} fg={look.fg} soft={look.soft} size="sm" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={`mono truncate text-[14px] font-medium text-[var(--kind-command)] ${
                state === "disabled" ? "line-through opacity-60" : ""
              }`}
            >
              {label}
            </span>
            {state && (
              <Badge
                variant={state === "disabled" ? "amber" : "terra"}
                className="shrink-0 !h-[17px] !px-1.5 text-[10.5px]"
              >
                {t(`projectPanel.originTag.${state}`)}
              </Badge>
            )}
          </div>
          {summary ? (
            <MiniMessageInline
              source={summary}
              className="truncate text-[12.5px] text-[var(--text-mut)]"
            />
          ) : (
            <span className="mono truncate text-[11px] text-[var(--text-faint)]">{command.id}</span>
          )}
        </div>
        <Switch
          checked={fields.enabled}
          onCheckedChange={(enabled) => set({ enabled })}
          aria-label={t("systemCommands.enabledFor", { command: label })}
        />
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t("systemCommands.collapse") : t("systemCommands.edit")}
        </Button>
      </div>
      {open && (
        <>
          {root && (
            <div className="grid gap-3 sm:grid-cols-2">
              <ResettableField
                label={t("systemCommands.name")}
                modified={name.trim().toLowerCase() !== command.name}
                onReset={() => set({ name: undefined })}
              >
                <Input
                  value={name}
                  onChange={(e) =>
                    set({ name: e.target.value === command.name ? undefined : e.target.value })
                  }
                />
              </ResettableField>
              <ResettableField
                label={t("systemCommands.aliases")}
                hint={t("systemCommands.aliasesHint")}
                modified={changes({ aliases: aliases.split(",") }).aliases !== undefined}
                onReset={() => set({ aliases: undefined })}
              >
                <Input
                  value={aliases}
                  placeholder={t("systemCommands.none")}
                  onChange={(e) => {
                    const next = e.target.value.split(",");
                    set({ aliases: changes({ aliases: next }).aliases ? next : undefined });
                  }}
                />
              </ResettableField>
            </div>
          )}
          <ResettableField
            label={t("systemCommands.permission")}
            hint={t("systemCommands.permissionHint")}
            modified={permission.trim() !== modulePermission}
            onReset={() => set({ permission: undefined })}
          >
            <Input
              value={permission}
              placeholder={t("systemCommands.none")}
              onChange={(e) =>
                set({
                  permission:
                    e.target.value.trim() === modulePermission ? undefined : e.target.value,
                })
              }
            />
          </ResettableField>
          <TextsField
            label={t("systemCommands.description")}
            value={description}
            original={command.description}
            onChange={(next) =>
              set({ description: changes({ description: next }).description ? next : undefined })
            }
          />
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ResettableField
                label={t("systemCommands.cooldown")}
                hint={t("systemCommands.cooldownHint")}
                modified={cooldown !== undefined}
                onReset={() => set({ cooldown: undefined })}
              >
                <Input
                  type="number"
                  min={0}
                  value={cooldown?.duration ?? 0}
                  onChange={(e) => {
                    const duration = Number(e.target.value);
                    set({
                      cooldown:
                        duration > 0 ? { scope: "player", ...cooldown, duration } : undefined,
                    });
                  }}
                />
              </ResettableField>
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
                value={cooldown.message ?? {}}
                original={{}}
                placeholder={t("systemCommands.noMessage")}
                onChange={(next) => {
                  const message = Object.values(next).some((text) => text.trim())
                    ? next
                    : undefined;
                  set({ cooldown: { ...cooldown, message } });
                }}
              />
            )}
          </div>
          <BehaviourField
            command={command}
            folder={folder}
            editor={stepsEditor}
            steps={fields.steps}
            onChange={(steps) => set({ steps })}
          />
        </>
      )}
    </section>
  );
}

/**
 * What the command runs: the module's code, or the admin's steps in its place (design
 * `framework-commandes` Q6). Customising starts from a `module_command` step that calls
 * the module's code, so the admin adds before or after it, or replaces it.
 */
function BehaviourField({
  command,
  folder,
  editor: Editor,
  steps,
  onChange,
}: {
  command: PlayerCommand;
  folder: string;
  editor: StepsEditor;
  steps: unknown;
  onChange: (steps: unknown) => void;
}) {
  const { t } = useTranslation();
  const custom = steps != null;
  // A node with sub-commands only has no code of its own to call back.
  const runnable = command.children.length === 0 || command.opensMenu !== null;
  const customise = () =>
    onChange(
      runnable
        ? [
            {
              module_command: {
                command: command.id,
                ...(command.arguments.length > 0
                  ? {
                      args: Object.fromEntries(
                        command.arguments.map((arg) => [arg.name, `{${arg.name}}`]),
                      ),
                    }
                  : {}),
              },
            },
          ]
        : [],
    );
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="field-label !mb-0 flex-1">{t("systemCommands.behaviour")}</span>
        {custom ? (
          <Button variant="ghost" size="sm" onClick={() => onChange(undefined)}>
            {t("systemCommands.behaviourReset")}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={customise}>
            {t("systemCommands.behaviourCustomise")}
          </Button>
        )}
      </div>
      <p className="text-[12px] text-[var(--text-faint)]">
        {custom
          ? t("systemCommands.behaviourCustomHint")
          : command.opensMenu
            ? t("systemCommands.behaviourMenu", { menu: command.opensMenu })
            : t("systemCommands.behaviourModule")}
      </p>
      {custom && (
        <Editor
          projectId={folder as ProjectId}
          value={stepsFromWire(steps)}
          onChange={(next) => onChange(stepsToWire(next))}
        />
      )}
    </div>
  );
}

/** [texts] in [lang], else in the first language it has: a card's one-line summary. */
function textIn(texts: Texts, lang: string): string {
  return (texts[lang] ?? texts["*"] ?? Object.values(texts)[0] ?? "").trim();
}

/** A field that starts from the module's value, its reset beside it. */
function ResettableField({
  label,
  hint,
  modified,
  onReset,
  children,
}: {
  label: string;
  hint?: string;
  modified: boolean;
  onReset: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <FormField label={label} hint={hint}>
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">{children}</div>
        <ResetButton
          modified={modified}
          onReset={onReset}
          label={t("systemCommands.resetField", { field: label })}
        />
      </div>
    </FormField>
  );
}

/**
 * The text in the topbar's language, as menus edit theirs; the other languages are in
 * the Translations tab. `*` (a plain string in the file) applies to every language, so
 * it shows as the fallback until this language gets its own. [onChange] receives the
 * whole map: an override's texts replace the module's.
 */
function TextsField({
  label,
  value,
  original,
  placeholder,
  onChange,
}: {
  label: string;
  value: Texts;
  original: Texts;
  placeholder?: string;
  onChange: (value: Texts) => void;
}) {
  const { t } = useTranslation();
  const lang = useUiStore((s) => s.activeLang);
  const own = value[lang];
  const fallback = own === undefined ? textIn(value, lang) : "";
  const write = (text: string) => {
    const { [lang]: _, ...rest } = value;
    onChange(text === "" ? rest : { ...rest, [lang]: text });
  };
  return (
    <FormField
      label={label}
      hint={
        own === undefined && fallback !== ""
          ? t("systemCommands.textFallback", { lang })
          : t("systemCommands.textLang", { lang })
      }
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <MiniMessageField
            value={own ?? ""}
            placeholder={fallback || placeholder}
            aria-label={`${label} (${lang})`}
            onChange={write}
          />
        </div>
        <ResetButton
          modified={(own ?? "") !== (original[lang] ?? "")}
          onReset={() => write(original[lang] ?? "")}
          label={t("systemCommands.resetField", { field: `${label} (${lang})` })}
        />
      </div>
    </FormField>
  );
}

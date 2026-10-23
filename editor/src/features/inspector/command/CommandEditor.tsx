import { EditorHeader } from "@/components/ui/editor-header";
import { Input } from "@/components/ui/input";
import type { Command, CommandArg, CommandId, ProjectId } from "@/domain/types";
import { cx } from "@/lib/cx";
import { useProjectsStore } from "@/state/projectsStore";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActionChainEditor } from "../chain/StepTree";
import { FieldLabel, Lane } from "../layout";
import { ActionScopeProvider } from "../properties/ActionEditor";
import { AliasesField } from "../properties/AliasesField";
import { PropertyField } from "../properties/PropertyField";

function CommandIdField({ projectId, commandId }: { projectId: ProjectId; commandId: CommandId }) {
  const { t } = useTranslation();
  const setCommandId = useProjectsStore((s) => s.setCommandId);
  const [draft, setDraft] = useState(commandId as string);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setDraft(commandId);
    setError(null);
  }, [commandId]);

  const commit = () => {
    if (draft === commandId) return;
    try {
      setCommandId({ projectId, oldId: commandId, newId: draft as CommandId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("menuProperties.renameRejected"));
      setDraft(commandId);
    }
  };

  return (
    <div>
      <FieldLabel>{t("flow.elementId")}</FieldLabel>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(commandId);
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

export function CommandEditor({ projectId, command }: { projectId: ProjectId; command: Command }) {
  const setCommandField = useProjectsStore((s) => s.setCommandField);
  const setCommandAliases = useProjectsStore((s) => s.setCommandAliases);
  const { t } = useTranslation();
  const commandScope = useMemo(
    () => ({ kind: "command" as const, commandId: command.id }),
    [command.id],
  );
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <CommandHeader command={command} />
      <div className="@container flex-1 overflow-auto px-4 py-4">
        {/* Wide containers (individual view) split into two columns: settings and
            arguments left, the steps right with the room they need. The narrow right
            pane stays stacked. */}
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(280px,350px)_1fr] @3xl:items-start">
          <div className="flex min-w-0 flex-col gap-4">
            <section className="panel rounded-[var(--r-md)] p-4">
              <Lane label={t("command.settingsLabel")}>
                <div className="flex flex-col gap-3">
                  <PropertyField
                    label={t("command.nameLabel")}
                    value={command.name}
                    onChange={(v) =>
                      setCommandField({ projectId, commandId: command.id, field: "name", value: v })
                    }
                  />
                  <PropertyField
                    label={t("command.permissionLabel")}
                    value={command.permission ?? ""}
                    placeholder={t("command.permissionPlaceholder")}
                    onChange={(v) =>
                      setCommandField({
                        projectId,
                        commandId: command.id,
                        field: "permission",
                        value: v,
                      })
                    }
                  />
                  <PropertyField
                    label={t("command.descriptionLabel")}
                    value={command.description ?? ""}
                    placeholder={t("command.descriptionPlaceholder")}
                    multiline
                    onChange={(v) =>
                      setCommandField({
                        projectId,
                        commandId: command.id,
                        field: "description",
                        value: v,
                      })
                    }
                  />
                  <AliasesField
                    label={t("command.aliasesLabel")}
                    aliases={command.aliases ?? []}
                    onChange={(aliases) =>
                      setCommandAliases({
                        projectId,
                        commandId: command.id,
                        aliases,
                      })
                    }
                  />
                  <CommandIdField projectId={projectId} commandId={command.id} />
                </div>
              </Lane>
            </section>
            <section className="panel rounded-[var(--r-md)] p-4">
              <Lane label={t("command.argumentsLabel")}>
                <CommandArgsEditor projectId={projectId} command={command} />
              </Lane>
            </section>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <section className="panel min-w-0 rounded-[var(--r-md)] p-4">
              <Lane label={t("command.steps")} hint={t("command.stepsHint")}>
                <div className="overflow-x-auto">
                  {/* Args declared above are referenceable as {name} in any text
                    field of the actions inside this step tree. */}
                  <ActionScopeProvider value={commandScope}>
                    <ActionChainEditor
                      projectId={projectId}
                      address={{ kind: "command", commandId: command.id }}
                      steps={command.steps}
                    />
                  </ActionScopeProvider>
                </div>
              </Lane>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The command as players type it, in the command colour of the board: kind tile,
 * `/name` large, then its arguments, permission and aliases.
 */
function CommandHeader({ command }: { command: Command }) {
  const { t } = useTranslation();
  const aliases = command.aliases ?? [];
  return (
    <EditorHeader
      kind="command"
      eyebrow={t("command.kindLabel")}
      title={`/${command.name}`}
      meta={
        <>
          {command.permission ? (
            <span className="chip cursor-default text-[12px]">
              {t("command.permissionLabel")}
              <b className="font-mono font-medium text-[var(--text)]">{command.permission}</b>
            </span>
          ) : null}
          {aliases.length > 0 ? (
            <span className="chip cursor-default text-[12px]">
              {t("command.aliasesLabel")}
              {aliases.map((alias) => (
                <b key={alias} className="font-mono font-medium text-[var(--text)]">
                  /{alias}
                </b>
              ))}
            </span>
          ) : null}
        </>
      }
    >
      {command.arguments.map((arg, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: arg index stable per render
          key={i}
          className={cx(
            "rounded-[var(--r-xs)] px-1.5 py-0.5 font-mono text-[12.5px]",
            arg.required
              ? "bg-[var(--surface-raised-2)] text-[var(--text)]"
              : "bg-[var(--surface-raised)] text-[var(--text-mut)]",
          )}
        >
          {argSignature(arg)}
        </span>
      ))}
    </EditorHeader>
  );
}

const ARG_TYPES: CommandArg["type"][] = ["player", "string", "integer", "number", "boolean"];

/** `<player>`, `[amount=10]`: an argument as the command's usage line writes it. */
function argSignature(arg: CommandArg): string {
  if (arg.required) return `<${arg.name}>`;
  if (arg.default && arg.default !== "{sender}") return `[${arg.name}=${arg.default}]`;
  return `[${arg.name}]`;
}

function CommandArgsEditor({ projectId, command }: { projectId: ProjectId; command: Command }) {
  const addCommandArg = useProjectsStore((s) => s.addCommandArg);
  const setCommandArg = useProjectsStore((s) => s.setCommandArg);
  const removeCommandArg = useProjectsStore((s) => s.removeCommandArg);
  const [orderError, setOrderError] = useState<string | null>(null);
  const { t } = useTranslation();

  const dupNames = new Set<string>();
  const seen = new Set<string>();
  for (const a of command.arguments) {
    if (a.name === "") continue;
    if (seen.has(a.name)) dupNames.add(a.name);
    seen.add(a.name);
  }

  const update = (index: number, patch: Partial<CommandArg>) => {
    const current = command.arguments[index];
    if (!current) return;
    try {
      setCommandArg({ projectId, commandId: command.id, index, arg: { ...current, ...patch } });
      setOrderError(null);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : t("command.argOrderError"));
    }
  };

  const addArg = () => {
    try {
      addCommandArg({ projectId, commandId: command.id });
      setOrderError(null);
    } catch (e) {
      setOrderError(e instanceof Error ? e.message : t("command.argOrderError"));
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-[var(--text-faint)]">
        {t("command.argumentsHint", { tag: "{name}" })}
      </p>
      {orderError && (
        <div className="rounded-[var(--r-xs)] border border-[var(--warning)] bg-[var(--warning-soft)] px-2 py-1.5 text-[12px] text-[var(--warning)]">
          {orderError}
        </div>
      )}
      {command.arguments.length === 0 ? (
        <div className="rounded-[var(--r-sm)] border border-[var(--border-soft)] border-dashed px-3 py-3 text-[12px] text-[var(--text-faint)]">
          {t("command.noArguments", { name: command.name })}
        </div>
      ) : (
        command.arguments.map((arg, i) => {
          const isInvalid = arg.name === "" || dupNames.has(arg.name);
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: arg index stable per render
              key={i}
              className={
                isInvalid
                  ? "flex flex-col gap-1.5 rounded-[var(--r-sm)] border border-[var(--danger)] bg-[var(--danger-soft)] p-2"
                  : "flex flex-col gap-1.5 rounded-[var(--r-sm)] border border-[var(--border-soft)] bg-[var(--surface-raised-2)] p-2"
              }
            >
              {/* Row 1: identity controls + remove button */}
              <div className="flex items-center gap-1.5">
                <Input
                  value={arg.name}
                  placeholder={t("command.argName")}
                  onChange={(e) => update(i, { name: e.target.value })}
                  className={
                    isInvalid
                      ? "h-8 w-28 rounded-[var(--r-xs)] border-[var(--danger)] px-2 py-0 font-mono text-xs"
                      : "h-8 w-28 rounded-[var(--r-xs)] px-2 py-0 font-mono text-xs"
                  }
                />
                <select
                  value={arg.wireType ?? arg.type}
                  onChange={(e) =>
                    update(i, { type: e.target.value as CommandArg["type"], wireType: undefined })
                  }
                  className="select h-8 w-auto rounded-[var(--r-xs)] py-0 pr-7 pl-2 font-mono text-xs"
                >
                  {/* A type written in the file that the editor has no control for: shown, kept until changed. */}
                  {arg.wireType && <option value={arg.wireType}>{arg.wireType}</option>}
                  {ARG_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => update(i, { required: !arg.required })}
                  className={
                    arg.required
                      ? "h-8 rounded-[var(--r-xs)] border border-[var(--border-strong)] bg-[var(--surface-raised)] px-2 text-[12px] font-medium text-[var(--text)]"
                      : "h-8 rounded-[var(--r-xs)] border border-[var(--border)] border-dashed px-2 text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
                  }
                >
                  {arg.required ? t("command.required") : t("command.optional")}
                </button>
                <button
                  type="button"
                  title={t("command.removeArg")}
                  onClick={() => removeCommandArg({ projectId, commandId: command.id, index: i })}
                  className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                >
                  ×
                </button>
              </div>
              {/* Row 2: default value (optional args only) */}
              {!arg.required ? (
                <div className="flex items-center gap-2 pl-0.5">
                  <div className="flex items-center gap-1">
                    <span className="text-[12px] text-[var(--text-faint)]">
                      {t("command.defaultLabel")}:
                    </span>
                    <Input
                      value={arg.default === "{sender}" ? "" : (arg.default ?? "")}
                      placeholder={t("command.defaultPlaceholder")}
                      disabled={arg.default === "{sender}"}
                      onChange={(e) => update(i, { default: e.target.value || undefined })}
                      className="h-7 w-28 rounded-[var(--r-xs)] px-2 py-0 font-mono text-xs disabled:opacity-40"
                    />
                  </div>
                  {arg.type === "player" ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-mut)]">
                      <input
                        type="checkbox"
                        checked={arg.default === "{sender}"}
                        onChange={(e) =>
                          update(i, { default: e.target.checked ? "{sender}" : undefined })
                        }
                        className="h-3.5 w-3.5 accent-[var(--brand)]"
                      />
                      {t("command.senderDefault")}
                    </label>
                  ) : null}
                </div>
              ) : null}
              {isInvalid ? (
                <div className="text-[12px] text-[var(--danger)]">
                  {arg.name === ""
                    ? t("command.argNeedsName")
                    : t("command.argNameDup", { name: arg.name })}
                </div>
              ) : null}
            </div>
          );
        })
      )}
      <button
        type="button"
        onClick={addArg}
        className="self-start rounded-[var(--r-xs)] border border-[var(--border)] border-dashed px-3 py-1.5 text-[12px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        {t("command.addArg")}
      </button>
    </div>
  );
}

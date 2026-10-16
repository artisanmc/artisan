import { Input } from "@/components/ui/input";
import type { Command, CommandArg, CommandId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CommandStepPseudocode } from "../chain/PseudocodeView";
import { FieldLabel, Lane } from "../layout";
import { ActionScopeProvider } from "../properties/ActionEditor";
import { AliasesField } from "../properties/AliasesField";
import { PropertyField } from "../properties/PropertyField";

function CommandIdField({ projectId, commandId }: { projectId: ProjectId; commandId: CommandId }) {
  const { t } = useTranslation();
  const setCommandId = useAccountStore((s) => s.setCommandId);
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
            ? "h-8 border-[var(--danger)] px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-[var(--danger)]">{error}</div> : null}
    </div>
  );
}

export function CommandEditor({ projectId, command }: { projectId: ProjectId; command: Command }) {
  const setCommandField = useAccountStore((s) => s.setCommandField);
  const setCommandAliases = useAccountStore((s) => s.setCommandAliases);
  const { t } = useTranslation();
  const commandScope = useMemo(
    () => ({ kind: "command" as const, commandId: command.id }),
    [command.id],
  );
  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <div className="border-[var(--border-soft)] border-b bg-[var(--surface-raised)] px-3 py-2">
        <div className="font-mono text-xs text-[var(--text)]">{commandSignature(command)}</div>
        <div className="text-[10px] text-[var(--text-faint)]">
          {command.permission ? `perm: ${command.permission} · ` : ""}command
        </div>
      </div>
      <div className="@container flex-1 overflow-auto px-3 py-3">
        {/* Wide containers (individual view) split into two columns: properties
            left, arguments + steps right. The narrow right pane stays stacked. */}
        <div className="grid grid-cols-1 gap-x-6 @2xl:grid-cols-2 @2xl:items-start">
          <div className="min-w-0">
            <Lane label={t("flow.propertiesLabel")}>
              <div className="flex flex-col gap-2">
                <CommandIdField projectId={projectId} commandId={command.id} />
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
              </div>
            </Lane>
          </div>
          <div className="min-w-0">
            <Lane label={t("command.argumentsLabel")}>
              <CommandArgsEditor projectId={projectId} command={command} />
            </Lane>
            <Lane label={t("command.steps")}>
              <div className="overflow-x-auto rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-2">
                {/* Args declared above are referenceable as {name} in any text
                    field of the actions inside this step tree. */}
                <ActionScopeProvider value={commandScope}>
                  <CommandStepPseudocode
                    projectId={projectId}
                    commandId={command.id}
                    steps={command.steps}
                    frames={[]}
                  />
                </ActionScopeProvider>
              </div>
            </Lane>
          </div>
        </div>
      </div>
    </div>
  );
}

const ARG_TYPES: CommandArg["type"][] = ["player", "string", "integer", "number", "boolean"];

/** `/cmd <player> [amount=10]` — Minecraft-y signature for the header. */
function commandSignature(command: Command): string {
  const parts = [`/${command.name}`];
  for (const arg of command.arguments) {
    const piece = arg.required
      ? `<${arg.name}>`
      : arg.default
        ? `[${arg.name}=${arg.default}]`
        : `[${arg.name}]`;
    parts.push(piece);
  }
  return parts.join(" ");
}

function CommandArgsEditor({ projectId, command }: { projectId: ProjectId; command: Command }) {
  const addCommandArg = useAccountStore((s) => s.addCommandArg);
  const setCommandArg = useAccountStore((s) => s.setCommandArg);
  const removeCommandArg = useAccountStore((s) => s.removeCommandArg);
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
      <p className="text-[10px] text-[var(--text-faint)]">
        {t("command.argumentsHint", { tag: "{name}" })}
      </p>
      {orderError && (
        <div className="rounded border border-[var(--warning)] bg-[var(--warning-soft)] px-2 py-1.5 text-[10px] text-[var(--warning)]">
          {orderError}
        </div>
      )}
      {command.arguments.length === 0 ? (
        <div className="rounded border border-[var(--border-soft)] border-dashed bg-[var(--surface-raised)] px-2 py-3 text-[11px] text-[var(--text-faint)]">
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
                  ? "flex flex-col gap-1 rounded border border-[var(--danger)] bg-[var(--danger-soft)] p-1.5"
                  : "flex flex-col gap-1 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
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
                      ? "h-8 w-28 border-[var(--danger)] px-2 py-0 font-mono text-xs"
                      : "h-8 w-28 px-2 py-0 font-mono text-xs"
                  }
                />
                <select
                  value={arg.type}
                  onChange={(e) => update(i, { type: e.target.value as CommandArg["type"] })}
                  className="h-8 rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-1.5 font-mono text-xs text-[var(--text)]"
                >
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
                      ? "h-8 rounded border border-[var(--brand)] bg-[var(--brand-soft)] px-2 font-mono text-[11px] text-[var(--brand)]"
                      : "h-8 rounded border border-[var(--border)] px-2 font-mono text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
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
                    <span className="font-mono text-[10px] text-[var(--text-faint)]">
                      {t("command.defaultLabel")}:
                    </span>
                    <Input
                      value={arg.default === "{sender}" ? "" : (arg.default ?? "")}
                      placeholder={t("command.defaultPlaceholder")}
                      disabled={arg.default === "{sender}"}
                      onChange={(e) => update(i, { default: e.target.value || undefined })}
                      className="h-7 w-28 px-2 py-0 font-mono text-xs disabled:opacity-40"
                    />
                  </div>
                  {arg.type === "player" ? (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-[var(--text-mut)]">
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
                <div className="text-[10px] text-[var(--danger)]">
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
        className="self-start rounded border border-[var(--border)] border-dashed px-3 py-1.5 text-xs text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
      >
        {t("command.addArg")}
      </button>
    </div>
  );
}

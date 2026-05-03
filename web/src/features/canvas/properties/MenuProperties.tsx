import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ContextInput, Menu, MenuId, PackId, SourceRef } from "@/domain/types";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
import { useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { type SampleContextFormat, useUiStore } from "@/state/uiStore";
import { Library as LibraryIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { BackgroundUpload } from "./BackgroundUpload";
import { PropertyField } from "./PropertyField";

interface MenuPropertiesProps {
  packId: PackId;
  menu: Menu;
}

const ROWS_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
const PRIMITIVE_TYPES: Extract<ContextInput, { kind: "primitive" }>["type"][] = [
  "player",
  "string",
  "integer",
  "number",
  "boolean",
];

export function MenuProperties({ packId, menu }: MenuPropertiesProps) {
  const setMenuField = useAccountStore((s) => s.setMenuField);
  const setMenuTitle = useAccountStore((s) => s.setMenuTitle);
  const setEditorTab = useUiStore((s) => s.setEditorTab);
  const [rowsError, setRowsError] = useState<string | null>(null);
  const titleEdit = useTextEdit(packId, menu.title);
  const { t } = useTranslation();

  const elementCount = menu.layers.reduce((sum, layer) => sum + layer.elements.length, 0);

  const onRowsChange = (rows: 1 | 2 | 3 | 4 | 5 | 6) => {
    try {
      setMenuField({ packId, menuId: menu.id, field: "rows", value: rows });
      setRowsError(null);
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : t("menuProperties.rowsChangeRejected"));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {elementCount === 0 ? (
        <div className="flex flex-col gap-2 rounded border border-emerald-600/40 border-dashed bg-emerald-600/5 p-3">
          <div className="font-mono text-[10px] text-emerald-300 uppercase tracking-wide">
            {t("menuProperties.emptyMenuTitle")}
          </div>
          <p className="text-[11px] text-zinc-300">{t("menuProperties.emptyMenuHint")}</p>
          <button
            type="button"
            onClick={() => setEditorTab("library")}
            className="self-start inline-flex items-center gap-1 rounded border border-emerald-600/60 bg-emerald-600/10 px-2.5 py-1.5 text-[11px] text-emerald-200 hover:bg-emerald-600/20"
          >
            <LibraryIcon className="h-3 w-3" />
            {t("menuProperties.openLibrary")}
          </button>
        </div>
      ) : null}
      <MenuIdField packId={packId} menuId={menu.id} />
      <div>
        <PropertyField
          label={t(
            titleEdit.isFallback
              ? "menuProperties.titleLabelFallback"
              : "menuProperties.titleLabel",
            { lang: titleEdit.lang },
          )}
          value={titleEdit.value}
          onChange={(v) =>
            setMenuTitle({ packId, menuId: menu.id, lang: titleEdit.lang, value: v })
          }
        />
        {titleEdit.value.includes("<") && (
          <div className="mt-1 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
            <span className="mr-2 text-[9px] uppercase text-zinc-600">
              {t("menuProperties.preview")}
            </span>
            <MiniMessageInline source={titleEdit.value} className="font-mono text-xs" />
          </div>
        )}
      </div>
      <PropertyField
        label={t("menuProperties.permission")}
        value={menu.permission ?? ""}
        placeholder={t("menuProperties.permissionPlaceholder")}
        onChange={(v) => setMenuField({ packId, menuId: menu.id, field: "permission", value: v })}
      />
      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">{t("menuProperties.rows")}</div>
        <div className="flex gap-1">
          {ROWS_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRowsChange(r)}
              className={
                r === menu.rows
                  ? "rounded border border-emerald-500 bg-emerald-900/40 px-2 py-1 text-xs"
                  : "rounded border border-zinc-700 px-2 py-1 text-xs hover:border-zinc-500"
              }
            >
              {r}
            </button>
          ))}
        </div>
        {rowsError && <div className="mt-1 text-[10px] text-red-400">{rowsError}</div>}
      </div>
      <BackgroundUpload packId={packId} menu={menu} />
      <ContextInputsEditor packId={packId} menu={menu} />
      <SampleContextEditor packId={packId} menu={menu} />
    </div>
  );
}

function MenuIdField({ packId, menuId }: { packId: PackId; menuId: MenuId }) {
  const setMenuId = useAccountStore((s) => s.setMenuId);
  const [draft, setDraft] = useState<string>(menuId);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslation();
  useEffect(() => {
    setDraft(menuId);
    setError(null);
  }, [menuId]);

  const commit = () => {
    if (draft === menuId) {
      setError(null);
      return;
    }
    try {
      setMenuId({ packId, oldId: menuId, newId: draft as MenuId });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("menuProperties.renameRejected"));
      setDraft(menuId);
    }
  };

  return (
    <div>
      <div className="mb-1 text-[10px] uppercase text-zinc-500">{t("menuProperties.id")}</div>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(menuId);
            setError(null);
            e.currentTarget.blur();
          }
        }}
        className={
          error
            ? "h-8 border-red-500/60 px-2 py-0 font-mono text-xs"
            : "h-8 px-2 py-0 font-mono text-xs"
        }
      />
      {error ? <div className="mt-1 text-[10px] text-red-300">{error}</div> : null}
      <div className="mt-1 text-[10px] text-zinc-500">
        {t("menuProperties.idHint", { tag: "open_menu" })}
      </div>
    </div>
  );
}

function ContextInputsEditor({ packId, menu }: { packId: PackId; menu: Menu }) {
  const addInput = useAccountStore((s) => s.addMenuContextInput);
  const setInput = useAccountStore((s) => s.setMenuContextInput);
  const removeInput = useAccountStore((s) => s.removeMenuContextInput);
  const inputs = menu.contextInputs ?? [];
  const { t } = useTranslation();

  // dup/empty validation, same pattern as command args
  const dups = new Set<string>();
  const seen = new Set<string>();
  for (const i of inputs) {
    if (i.name === "") continue;
    if (seen.has(i.name)) dups.add(i.name);
    seen.add(i.name);
  }

  const update = (index: number, patch: Partial<ContextInput>) => {
    const current = inputs[index];
    if (!current) return;
    setInput({ packId, menuId: menu.id, index, input: { ...current, ...patch } as ContextInput });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wide">
        {t("menuProperties.contextInputs")}
      </div>
      <p className="text-[10px] text-zinc-500">
        {t("menuProperties.contextInputsHint", { tag: "{name}" })}
      </p>
      {inputs.length === 0 ? (
        <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/40 px-2 py-2 text-[11px] text-zinc-500">
          {t("menuProperties.contextInputsEmpty")}
        </div>
      ) : (
        inputs.map((input, i) => {
          const isInvalid = input.name === "" || dups.has(input.name);
          return (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: index stable per render
              key={i}
              className={
                isInvalid
                  ? "flex flex-col gap-1 rounded border border-red-500/60 bg-red-500/5 p-1.5"
                  : "flex flex-col gap-1 rounded border border-zinc-800 bg-zinc-900/40 p-1.5"
              }
            >
              {input.kind === "primitive" ? (
                <PrimitiveInputRow
                  input={input}
                  onChange={(patch) => update(i, patch)}
                  onRemove={() => removeInput({ packId, menuId: menu.id, index: i })}
                  isInvalid={isInvalid}
                />
              ) : (
                <SourceRefInputRow
                  input={input}
                  onChange={(patch) => update(i, patch)}
                  onRemove={() => removeInput({ packId, menuId: menu.id, index: i })}
                />
              )}
              {isInvalid ? (
                <div className="text-[10px] text-red-300">
                  {input.name === ""
                    ? t("menuProperties.inputNeedsName")
                    : t("menuProperties.inputNameDup", { name: input.name })}
                </div>
              ) : null}
            </div>
          );
        })
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="self-start rounded border border-zinc-700 border-dashed px-3 py-1.5 text-xs text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
          >
            {t("menuProperties.addInput")}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
          <DropdownMenuItem
            onSelect={() => addInput({ packId, menuId: menu.id, kind: "primitive" })}
            className="cursor-pointer text-[11px] focus:bg-zinc-800"
          >
            Primitive (caller-passed)
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => addInput({ packId, menuId: menu.id, kind: "sourceRef" })}
            className="cursor-pointer text-[11px] focus:bg-zinc-800"
          >
            Source ref (manual for now)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function PrimitiveInputRow({
  input,
  onChange,
  onRemove,
  isInvalid,
}: {
  input: Extract<ContextInput, { kind: "primitive" }>;
  onChange: (patch: Partial<Extract<ContextInput, { kind: "primitive" }>>) => void;
  onRemove: () => void;
  isInvalid: boolean;
}) {
  const { t } = useTranslation();
  return (
    <>
      {/* Row 1: name + type + remove button */}
      <div className="flex items-center gap-1.5">
        <Input
          value={input.name}
          placeholder={t("menuProperties.inputName")}
          onChange={(e) => onChange({ name: e.target.value })}
          className={
            isInvalid
              ? "h-8 w-28 border-red-500/60 px-2 py-0 font-mono text-xs"
              : "h-8 w-28 px-2 py-0 font-mono text-xs"
          }
        />
        <select
          value={input.type}
          onChange={(e) =>
            onChange({
              type: e.target.value as Extract<ContextInput, { kind: "primitive" }>["type"],
            })
          }
          className="h-8 rounded border border-zinc-800 bg-zinc-900 px-1.5 font-mono text-xs text-zinc-200"
        >
          {PRIMITIVE_TYPES.map((typeOption) => (
            <option key={typeOption} value={typeOption}>
              {typeOption}
            </option>
          ))}
        </select>
        <button
          type="button"
          title={t("menuProperties.removeInput")}
          onClick={onRemove}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          ×
        </button>
      </div>
      {/* Row 2: default value */}
      <div className="flex items-center gap-2 pl-0.5">
        <div className="flex items-center gap-1">
          <span className="font-mono text-[10px] text-zinc-500">
            {t("menuProperties.inputDefault")}:
          </span>
          <Input
            value={input.default === "{sender}" ? "" : (input.default ?? "")}
            placeholder={t("menuProperties.inputDefaultPlaceholder")}
            disabled={input.default === "{sender}"}
            onChange={(e) => onChange({ default: e.target.value || undefined })}
            className="h-7 w-28 px-2 py-0 font-mono text-xs disabled:opacity-40"
          />
        </div>
        {input.type === "player" ? (
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-zinc-400">
            <input
              type="checkbox"
              checked={input.default === "{sender}"}
              onChange={(e) => onChange({ default: e.target.checked ? "{sender}" : undefined })}
              className="h-3.5 w-3.5 accent-emerald-500"
            />
            {t("menuProperties.inputSenderDefault")}
          </label>
        ) : null}
      </div>
    </>
  );
}

function SourceRefInputRow({
  input,
  onChange,
  onRemove,
}: {
  input: Extract<ContextInput, { kind: "sourceRef" }>;
  onChange: (patch: Partial<Extract<ContextInput, { kind: "sourceRef" }>>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={input.name}
        placeholder={t("menuProperties.inputName")}
        onChange={(e) => onChange({ name: e.target.value })}
        className="h-8 w-28 px-2 py-0 font-mono text-xs"
      />
      <Input
        value={input.ref}
        placeholder="pack:<id> or chestshop:items"
        onChange={(e) => onChange({ ref: e.target.value as SourceRef })}
        className="h-8 flex-1 px-2 py-0 font-mono text-xs"
      />
      <button
        type="button"
        title={t("menuProperties.removeInput")}
        onClick={onRemove}
        className="ml-auto flex h-7 w-7 items-center justify-center rounded text-[14px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Sample context — purely an editor-preview aid. Lets the user mock the
 * data their menu would receive at runtime so the canvas can resolve
 * `{name}` placeholders + drive iteration mockups. Not persisted to
 * runtime config.
 *
 * Toggle YAML/JSON: the source of truth is the parsed object stored in
 * `menu.sampleContext`. Re-serializing it in the chosen format keeps the
 * two views in sync (formatting / comments are lost on round-trip — the
 * tradeoff for staying decoupled from the user's exact text).
 */
function SampleContextEditor({ packId, menu }: { packId: PackId; menu: Menu }) {
  const setSampleContext = useAccountStore((s) => s.setMenuSampleContext);
  const format = useUiStore((s) => s.sampleContextFormat);
  const setFormat = useUiStore((s) => s.setSampleContextFormat);
  const { t } = useTranslation();

  // Local draft of the textarea contents — re-derived from the stored
  // object whenever (a) the active menu changes or (b) the format flips.
  const [draft, setDraft] = useState(() => serialize(menu.sampleContext, format));
  const [error, setError] = useState<string | null>(null);
  // Track which menu+format the current draft was derived from so we don't
  // overwrite user-in-progress text on unrelated re-renders.
  const lastDerivedRef = useRef({ menuId: menu.id, format });

  useEffect(() => {
    const last = lastDerivedRef.current;
    if (last.menuId === menu.id && last.format === format) return;
    setDraft(serialize(menu.sampleContext, format));
    setError(null);
    lastDerivedRef.current = { menuId: menu.id, format };
  }, [menu.id, menu.sampleContext, format]);

  const commit = () => {
    if (draft.trim() === "") {
      setSampleContext({ packId, menuId: menu.id, value: undefined });
      setError(null);
      return;
    }
    try {
      const parsed = format === "json" ? JSON.parse(draft) : parseYaml(draft);
      setSampleContext({ packId, menuId: menu.id, value: parsed });
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("menuProperties.invalidFormat", { format: format.toUpperCase() }),
      );
    }
  };

  const switchFormat = (next: SampleContextFormat) => {
    if (next === format) return;
    // Try to commit the current draft before flipping so the new view
    // shows the up-to-date object. If parsing fails, flip anyway —
    // re-serialization of the last good stored value will replace the bad
    // draft so the user can keep working.
    if (draft.trim() !== "") {
      try {
        const parsed = format === "json" ? JSON.parse(draft) : parseYaml(draft);
        setSampleContext({ packId, menuId: menu.id, value: parsed });
        setError(null);
      } catch {
        // ignore — fall through to flip
      }
    }
    setFormat(next);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wide">
          {t("menuProperties.sampleContext")}
        </div>
        <div className="flex overflow-hidden rounded border border-zinc-700 text-[10px]">
          <FormatTab active={format === "yaml"} onClick={() => switchFormat("yaml")}>
            YAML
          </FormatTab>
          <FormatTab active={format === "json"} onClick={() => switchFormat("json")}>
            JSON
          </FormatTab>
        </div>
      </div>
      <p className="text-[10px] text-zinc-500">{t("menuProperties.sampleContextHint")}</p>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder={
          format === "yaml"
            ? "player: Steve\nquests:\n  - name: First quest"
            : '{ "player": "Steve", "quests": [{ "name": "First quest" }] }'
        }
        className={
          error
            ? "min-h-[7rem] w-full rounded border border-red-500/60 bg-zinc-900 p-2 font-mono text-xs"
            : "min-h-[7rem] w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
        }
      />
      {error ? (
        <div className="text-[10px] text-red-300">
          {t("menuProperties.parseFailed", { format: format.toUpperCase(), error })}
        </div>
      ) : null}
    </div>
  );
}

function FormatTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "px-2 py-0.5 font-mono uppercase tracking-wide transition-colors",
        active
          ? "bg-emerald-500/20 text-emerald-200"
          : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200",
      )}
    >
      {children}
    </button>
  );
}

function serialize(value: unknown, format: SampleContextFormat): string {
  if (value === undefined || value === null) return "";
  if (format === "json") return JSON.stringify(value, null, 2);
  // `yaml` returns an empty document for primitive values like "" — the
  // `lineWidth: 0` flag disables wrapping so long strings stay readable.
  return stringifyYaml(value, { lineWidth: 0 });
}

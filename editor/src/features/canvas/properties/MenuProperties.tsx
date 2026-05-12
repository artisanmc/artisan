import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ContextInput, Menu, MenuId, Pack, PackId, SourceRef } from "@/domain/types";
import { summarizeFieldType } from "@/features/data/helpers";
import { LayersPanel } from "@/features/canvas/title/composer/LayersPanel";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { Library as LibraryIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const setEditorTab = useUiStore((s) => s.setEditorTab);
  const [rowsError, setRowsError] = useState<string | null>(null);
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
      <div className="flex flex-col gap-1.5" data-testid="menu-properties-title-section">
        <div className="font-mono text-[10px] text-zinc-500 uppercase tracking-wide">
          {t("menuProperties.titleSection")}
        </div>
        <LayersPanel packId={packId} menuId={menu.id} />
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
      <ContextInputsEditor packId={packId} menu={menu} />
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
                  packId={packId}
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
  packId,
  input,
  onChange,
  onRemove,
}: {
  packId: PackId;
  input: Extract<ContextInput, { kind: "sourceRef" }>;
  onChange: (patch: Partial<Extract<ContextInput, { kind: "sourceRef" }>>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));

  const refLabel = (() => {
    if (!input.ref) return null;
    if (input.ref.startsWith("pack:")) {
      const id = input.ref.slice("pack:".length);
      return (pack?.dataSources ?? []).find((d) => d.id === id)?.name ?? input.ref;
    }
    return input.ref;
  })();

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={input.name}
        placeholder={t("menuProperties.inputName")}
        onChange={(e) => onChange({ name: e.target.value })}
        className="h-8 w-28 px-2 py-0 font-mono text-xs"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-8 flex-1 items-center justify-between gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-0 font-mono text-xs text-zinc-200 hover:bg-zinc-800"
          >
            <span className="truncate">{refLabel ?? t("menuProperties.refPickPlaceholder")}</span>
            <span className="text-zinc-500">▾</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
          {pack ? <SourcePickerOptions pack={pack} onPick={(ref) => onChange({ ref })} /> : null}
        </DropdownMenuContent>
      </DropdownMenu>
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

function SourcePickerOptions({
  pack,
  onPick,
}: {
  pack: Pack;
  onPick: (ref: SourceRef) => void;
}) {
  const { t } = useTranslation();
  const hasPackData = (pack.dataSources ?? []).length > 0;
  const hasConnectors = (pack.importedConnectors ?? []).length > 0;
  return (
    <>
      {hasPackData ? (
        <>
          <DropdownMenuLabel className="text-[9px] uppercase text-zinc-500">
            {t("menuProperties.refSectionPackData")}
          </DropdownMenuLabel>
          {(pack.dataSources ?? []).map((d) => (
            <DropdownMenuItem
              key={d.id}
              onSelect={() => onPick(`pack:${d.id}` as SourceRef)}
              title={summarizeFieldType(d.type)}
              className="cursor-pointer text-[11px] focus:bg-zinc-800"
            >
              <span className="mr-1">{d.type.kind === "list" ? "🗂" : "📦"}</span>
              <span className="font-mono">{d.name}</span>
              <span className="ml-auto text-[9px] text-zinc-500">{summarizeFieldType(d.type)}</span>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {hasPackData && hasConnectors ? <DropdownMenuSeparator /> : null}
      {hasConnectors ? (
        <>
          <DropdownMenuLabel className="text-[9px] uppercase text-zinc-500">
            {t("menuProperties.refSectionConnectors")}
          </DropdownMenuLabel>
          {(pack.importedConnectors ?? []).map((c) => (
            <DropdownMenuItem
              key={c.ref}
              onSelect={() => onPick(c.ref as SourceRef)}
              title={summarizeFieldType(c.type)}
              className="cursor-pointer text-[11px] focus:bg-zinc-800"
            >
              <span className="mr-1">🔌</span>
              <span className="font-mono">{c.ref}</span>
              <span className="ml-auto text-[9px] text-zinc-500">{summarizeFieldType(c.type)}</span>
            </DropdownMenuItem>
          ))}
        </>
      ) : null}
      {!hasPackData && !hasConnectors ? (
        <DropdownMenuItem disabled className="cursor-not-allowed text-[11px] text-zinc-500">
          {t("menuProperties.refNoSources")}
        </DropdownMenuItem>
      ) : null}
    </>
  );
}

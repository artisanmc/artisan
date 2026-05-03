import { Input } from "@/components/ui/input";
import type { Action, ElementId, MenuId, PackId } from "@/domain/types";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { itemTextureUrl } from "@/features/canvas/itemTextures";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useGetText, useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { createContext, useContext, useMemo } from "react";
import { useTranslation } from "react-i18next";

interface ActionEditorProps {
  packId: PackId;
  action: Action;
  onChange: (action: Action) => void;
}

const looksLikeMiniMessage = (s: string): boolean => s.includes("<");

/**
 * Source of a placeholder — drives the visual badge color and tooltip in
 * `<ArgInsertBar>` so users can tell where each `{name}` resolves from.
 */
export type PlaceholderSource = "command-arg" | "menu-context" | "click-implicit";

export interface PlaceholderInfo {
  name: string;
  /** Type hint for the tooltip — free-form (e.g. "player", "string"). */
  type?: string;
  source: PlaceholderSource;
}

/**
 * Placeholders available to actions in the current scope. Sources:
 *
 *   - `command-arg`     : declared on the parent command (`CommandEditor`).
 *   - `menu-context`    : declared on the parent menu (`MenuProperties`).
 *   - `click-implicit`  : always available inside element click handlers
 *                         (player, slot, material).
 *
 * Providers stack — the deepest context wins, but each provider should
 * concat its own entries with the parent's via `useParentPlaceholders()`
 * so deeper scopes inherit. Action editors below use `<ArgInsertBar>` to
 * render an "insert {name}" affordance next to text fields.
 */
const PlaceholderContext = createContext<readonly PlaceholderInfo[]>([]);
export const PlaceholderProvider = PlaceholderContext.Provider;

export function usePlaceholders(): readonly PlaceholderInfo[] {
  return useContext(PlaceholderContext);
}

const SOURCE_BADGE: Record<PlaceholderSource, string> = {
  "command-arg":
    "border-blue-500/30 bg-blue-500/10 text-blue-200 hover:border-blue-500 hover:bg-blue-500/20",
  "menu-context":
    "border-purple-500/30 bg-purple-500/10 text-purple-200 hover:border-purple-500 hover:bg-purple-500/20",
  "click-implicit":
    "border-emerald-500/30 bg-emerald-500/10 text-emerald-200 hover:border-emerald-500 hover:bg-emerald-500/20",
};

const SOURCE_KEY: Record<PlaceholderSource, string> = {
  "command-arg": "actionEditor.sourceCommandArg",
  "menu-context": "actionEditor.sourceMenuContext",
  "click-implicit": "actionEditor.sourceClickContext",
};

export function ArgInsertBar({ onInsert }: { onInsert: (name: string) => void }) {
  const { t } = useTranslation();
  const placeholders = usePlaceholders();
  if (placeholders.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className="text-[9px] text-zinc-500 uppercase">{t("actionEditor.insertLabel")}</span>
      {placeholders.map((p) => (
        <button
          key={`${p.source}:${p.name}`}
          type="button"
          onClick={() => onInsert(p.name)}
          title={t("actionEditor.insertHint", {
            name: `{${p.name}}`,
            type: p.type ? ` (${p.type})` : "",
            source: t(SOURCE_KEY[p.source]),
          })}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${SOURCE_BADGE[p.source]}`}
        >
          {`{${p.name}}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Per-type editor for a click/command Action. Render fields specific to the
 * action's discriminator and call back with the new action object on every
 * edit (immer/zundo handles undo on the store side).
 */
export function ActionEditor({ packId, action, onChange }: ActionEditorProps) {
  const { t } = useTranslation();
  switch (action.type) {
    case "open_menu":
      return <OpenMenuEditor packId={packId} action={action} onChange={onChange} />;
    case "close_menu":
      return <div className="text-[11px] text-zinc-500">{t("actionEditor.closeMenuLabel")}</div>;
    case "run_command":
      return <RunCommandEditor action={action} onChange={onChange} />;
    case "send_message":
      return <SendMessageEditor packId={packId} action={action} />;
    case "give_item":
      return <GiveItemEditor action={action} onChange={onChange} />;
    case "take_money":
      return <TakeMoneyEditor action={action} onChange={onChange} />;
    case "paginate":
      return <PaginateEditor packId={packId} action={action} onChange={onChange} />;
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] uppercase text-zinc-500">{children}</div>;
}

function OpenMenuEditor({
  packId,
  action,
  onChange,
}: {
  packId: PackId;
  action: Extract<Action, { type: "open_menu" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const menus = useAccountStore((s) => s.account.packs.find((p) => p.id === packId)?.menus ?? []);
  const targetMenu = menus.find((m) => m.id === action.menuId);
  const targetInputs = targetMenu?.contextInputs ?? [];
  const ctxValues = action.context ?? {};
  const getText = useGetText(packId);

  const setCtxValue = (name: string, value: string) => {
    const next = { ...ctxValues };
    if (value === "") delete next[name];
    else next[name] = value;
    onChange({
      ...action,
      context: Object.keys(next).length > 0 ? next : undefined,
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.targetMenu")}</FieldLabel>
        <select
          value={action.menuId}
          onChange={(e) => onChange({ ...action, menuId: e.target.value as MenuId })}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200"
        >
          {/* Allow keeping a value that no longer exists in the pack so the
              user can see the dangling ref instead of silently flipping to the
              first menu. */}
          {menus.some((m) => m.id === action.menuId) ? null : (
            <option value={action.menuId}>
              {t("actionEditor.menuMissing", { id: action.menuId })}
            </option>
          )}
          {menus.map((m) => (
            <option key={m.id} value={m.id}>
              {m.id} · {getText(m.title)}
            </option>
          ))}
        </select>
      </div>
      {targetInputs.length > 0 ? (
        <div>
          <FieldLabel>{t("actionEditor.contextToPass")}</FieldLabel>
          <div className="flex flex-col gap-1.5">
            {targetInputs.map((input) => (
              <div key={input.name} className="rounded border border-zinc-800 bg-zinc-900/40 p-1.5">
                <div className="mb-1 flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-purple-300">{input.name}</span>
                  <span className="text-zinc-500">: {input.type}</span>
                </div>
                <Input
                  value={ctxValues[input.name] ?? ""}
                  placeholder={t("actionEditor.placeholderOrLiteral", {
                    tag: `{${input.name}}`,
                  })}
                  onChange={(e) => setCtxValue(input.name, e.target.value)}
                  className="h-7 px-2 py-0 font-mono text-xs"
                />
                <ArgInsertBar
                  onInsert={(name) =>
                    setCtxValue(input.name, `${ctxValues[input.name] ?? ""}{${name}}`)
                  }
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={Boolean(action.clearContext)}
          onChange={(e) => onChange({ ...action, clearContext: e.target.checked || undefined })}
        />
        {t("actionEditor.clearContext")}
      </label>
    </div>
  );
}

function RunCommandEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "run_command" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.command")}</FieldLabel>
        <Input
          value={action.command}
          placeholder={t("actionEditor.commandPlaceholder")}
          onChange={(e) => onChange({ ...action, command: e.target.value })}
        />
        <div className="mt-1 text-[10px] text-zinc-500">{t("actionEditor.commandHint")}</div>
        <ArgInsertBar
          onInsert={(name) => onChange({ ...action, command: `${action.command}{${name}}` })}
        />
      </div>
      <div>
        <FieldLabel>{t("actionEditor.runAs")}</FieldLabel>
        <div className="flex gap-2">
          {(["player", "console"] as const).map((mode) => {
            const active = action.as === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onChange({ ...action, as: mode })}
                className={`flex-1 rounded border px-2 py-1 font-mono text-xs ${
                  active
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-100"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {mode === "player" ? t("actionEditor.runAsPlayer") : t("actionEditor.runAsConsole")}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SendMessageEditor({
  packId,
  action,
}: {
  packId: PackId;
  action: Extract<Action, { type: "send_message" }>;
}) {
  const { t } = useTranslation();
  // We don't go through the generic `onChange(action)` callback here:
  // the LText ref must stay stable so its translations in other languages
  // survive the edit. Writing through `setI18nValue` updates the value
  // map under the existing key instead of replacing the action.
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const edit = useTextEdit(packId, action.text);
  const onTextChange = (value: string) =>
    setI18nValue({ packId, lt: action.text, lang: edit.lang, value });
  return (
    <div>
      <FieldLabel>
        {edit.isFallback
          ? t("actionEditor.textLangFallback", { lang: edit.lang })
          : t("actionEditor.textLang", { lang: edit.lang })}
      </FieldLabel>
      <textarea
        className="w-full rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-xs"
        rows={3}
        placeholder={t("actionEditor.textPlaceholder")}
        value={edit.value}
        onChange={(e) => onTextChange(e.target.value)}
      />
      <ArgInsertBar onInsert={(name) => onTextChange(`${edit.value}{${name}}`)} />
      {looksLikeMiniMessage(edit.value) ? (
        <div className="mt-1 rounded border border-zinc-800 bg-[var(--color-bg)] px-2 py-1">
          <span className="mr-2 text-[9px] uppercase text-zinc-600">
            {t("menuProperties.preview")}
          </span>
          <MiniMessageInline source={edit.value} className="font-mono text-xs" />
        </div>
      ) : null}
    </div>
  );
}

function GiveItemEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "give_item" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const url = itemTextureUrl(action.material);
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.material")}</FieldLabel>
        <div className="flex items-center gap-1.5">
          <MaterialPicker
            trigger={
              <button
                type="button"
                title={t("actionEditor.materialPick")}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-zinc-800 bg-zinc-950 hover:border-emerald-500"
              >
                {url ? (
                  <img
                    src={url}
                    alt={action.material}
                    draggable={false}
                    className="h-3/4 w-3/4 object-contain"
                    style={{ imageRendering: "pixelated" }}
                  />
                ) : (
                  <span className="text-[8px] text-zinc-600">
                    {action.material.slice(0, 3) || "—"}
                  </span>
                )}
              </button>
            }
            onPick={(picked) => onChange({ ...action, material: picked })}
          />
          <Input
            value={action.material}
            placeholder={t("actionEditor.materialPlaceholder")}
            onChange={(e) => onChange({ ...action, material: e.target.value.toUpperCase() })}
          />
        </div>
      </div>
      <div>
        <FieldLabel>{t("actionEditor.count")}</FieldLabel>
        <Input
          type="number"
          min={1}
          max={64}
          value={action.count}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (!Number.isNaN(n) && n >= 1 && n <= 64) onChange({ ...action, count: n });
          }}
        />
      </div>
    </div>
  );
}

function TakeMoneyEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "take_money" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <FieldLabel>{t("actionEditor.amount")}</FieldLabel>
      <Input
        type="number"
        min={0}
        value={action.amount}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (!Number.isNaN(n) && n >= 0) onChange({ ...action, amount: n });
        }}
      />
    </div>
  );
}

function PaginateEditor({
  packId,
  action,
  onChange,
}: {
  packId: PackId;
  action: Extract<Action, { type: "paginate" }>;
  onChange: (a: Action) => void;
}) {
  // List every iterating element across the pack so the user can target
  // a specific pager. "All iterables" is the default — fits the common
  // "single list per menu" case.
  //
  // The pack ref itself is stable thanks to immer — selecting it from
  // the store doesn't allocate. Derive `targets` via useMemo so we don't
  // hand zustand a fresh array on every render (that'd loop the identity
  // check, same trap as ItemTooltip's findElementAndMenu).
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const getText = useGetText(packId);
  const targets = useMemo(() => {
    if (!pack) return [];
    const out: { id: ElementId; menuTitle: string; alias: string; source: string }[] = [];
    for (const m of pack.menus) {
      for (const layer of m.layers) {
        for (const el of layer.elements) {
          if (el.iterates) {
            out.push({
              id: el.id,
              menuTitle: getText(m.title) || m.id,
              alias: el.iterates.alias,
              source: el.iterates.source,
            });
          }
        }
      }
    }
    return out;
  }, [pack, getText]);

  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.direction")}</FieldLabel>
        <div className="flex gap-2">
          {(["prev", "next"] as const).map((dir) => {
            const active = action.direction === dir;
            return (
              <button
                key={dir}
                type="button"
                onClick={() => onChange({ ...action, direction: dir })}
                className={`flex-1 rounded border px-2 py-1 font-mono text-xs ${
                  active
                    ? "border-emerald-500 bg-emerald-500/10 text-emerald-100"
                    : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600"
                }`}
              >
                {dir === "prev" ? t("actionEditor.directionPrev") : t("actionEditor.directionNext")}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <FieldLabel>{t("actionEditor.target")}</FieldLabel>
        <select
          value={action.targetElementId ?? ""}
          onChange={(e) =>
            onChange({
              ...action,
              targetElementId: e.target.value === "" ? undefined : (e.target.value as ElementId),
            })
          }
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-200"
        >
          <option value="">{t("actionEditor.targetAllIterables")}</option>
          {targets.map((tgt) => (
            <option key={tgt.id} value={tgt.id}>
              {tgt.id} · {tgt.menuTitle} · {tgt.alias} ∈ {tgt.source}
            </option>
          ))}
        </select>
        <div className="mt-1 text-[10px] text-zinc-500">{t("actionEditor.paginateHint")}</div>
      </div>
    </div>
  );
}

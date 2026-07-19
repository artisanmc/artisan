import { RevealField } from "@/components/RevealField";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import { Input } from "@/components/ui/input";
import { getFirstTitleText } from "@/domain/menuTitle";
import type {
  Action,
  ClickType,
  DialogId,
  ElementId,
  I18nKey,
  MenuId,
  ProjectId,
} from "@/domain/types";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { UNALLOCATED_LTEXT_KEY } from "@/features/flow/defaults";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useGetText, useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { createContext, useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

interface ActionEditorProps {
  projectId: ProjectId;
  action: Action;
  onChange: (action: Action) => void;
  /** Present when the action lives inside an element click handler. Used to
   * compute placeholder entries for the action-scope catalog. */
  menuId?: MenuId;
  elementId?: ElementId;
  clickType?: ClickType;
  /** Literal-text mode (module-data steps): text lives in LText.key verbatim
   *  and edits go through `onChange` — no i18n key, no store write. */
  literalText?: boolean;
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
    "border-[var(--border)] bg-[var(--surface-raised-2)] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-hover)]",
  "menu-context":
    "border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]",
  "click-implicit":
    "border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)] hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]",
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
      <span className="text-[9px] text-[var(--text-faint)] uppercase">{t("actionEditor.insertLabel")}</span>
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
export function ActionEditor({ projectId, action, onChange, menuId, elementId, clickType, literalText }: ActionEditorProps) {
  const { t } = useTranslation();
  switch (action.type) {
    case "open_menu":
      return <OpenMenuEditor projectId={projectId} action={action} onChange={onChange} />;
    case "close_menu":
      return <div className="text-[11px] text-[var(--text-faint)]">{t("actionEditor.closeMenuLabel")}</div>;
    case "run_command":
      return <RunCommandEditor action={action} onChange={onChange} />;
    case "send_message":
    case "broadcast":
      if (literalText) return <LiteralTextEditor action={action} onChange={onChange} />;
      return <SendMessageEditor projectId={projectId} action={action} menuId={menuId} elementId={elementId} clickType={clickType} />;
    case "show_title":
      if (literalText) return <LiteralShowTitleEditor action={action} onChange={onChange} />;
      return <ShowTitleEditor projectId={projectId} action={action} onChange={onChange} menuId={menuId} elementId={elementId} clickType={clickType} />;
    case "give_item":
    case "take_item":
      return <GiveItemEditor action={action} onChange={onChange} />;
    case "take_money":
    case "give_money":
    case "give_xp":
    case "give_level":
      return <AmountEditor action={action} onChange={onChange} />;
    case "play_sound":
      return <PlaySoundEditor action={action} onChange={onChange} />;
    case "teleport":
      return <TeleportEditor action={action} onChange={onChange} />;
    case "paginate":
      return <PaginateEditor projectId={projectId} action={action} onChange={onChange} />;
    case "set_arg":
      return <SetArgEditor action={action} onChange={onChange} />;
    case "set_arg_cycle_next":
    case "set_arg_cycle_prev":
      return <SetArgCycleEditor action={action} onChange={onChange} />;
    case "open_dialog":
      return <OpenDialogEditor projectId={projectId} action={action} onChange={onChange} />;
    case "close_dialog":
      return <div className="text-[11px] text-[var(--text-faint)]">Ferme le dialogue actuel.</div>;
  }
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">{children}</div>;
}

function OpenMenuEditor({
  projectId,
  action,
  onChange,
}: {
  projectId: ProjectId;
  action: Extract<Action, { type: "open_menu" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const menus = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId)?.menus ?? []);
  const targetMenu = menus.find((m) => m.id === action.menuId);
  // Only PRIMITIVE inputs are caller-passed; sourceRef inputs are FETCHED by
  // the target menu itself (ContextBinder) — asking the caller to fill them
  // was a trap ("items: ?").
  const targetInputs = (targetMenu?.contextInputs ?? []).filter((i) => i.kind === "primitive");
  const ctxValues = action.context ?? {};
  const getText = useGetText(projectId);

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
          className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs text-[var(--text)]"
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
              {m.id} · {getText(getFirstTitleText(m))}
            </option>
          ))}
        </select>
      </div>
      {targetInputs.length > 0 || Object.keys(ctxValues).length > 0 ? (
        <div>
          <FieldLabel>{t("actionEditor.contextToPass")}</FieldLabel>
          <div className="flex flex-col gap-1.5">
            {targetInputs.map((input) => (
              <div key={input.name} className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5">
                <div className="mb-1 flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-[var(--brand)]">{input.name}</span>
                  <span className="text-[var(--text-faint)]">
                    : {input.kind === "primitive" ? input.type : "sourceRef"}
                  </span>
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
            {/* Context keys the action already carries but the target menu never
                DECLARED as inputs (menus may consume {args} in filters/titles
                without declaring them) — without these rows the existing
                context is invisible and uneditable. */}
            {Object.keys(ctxValues)
              .filter((k) => !targetInputs.some((i) => i.name === k))
              .map((k) => (
                <div key={k} className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5">
                  <div className="mb-1 flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-[var(--brand)]">{k}</span>
                    <span className="text-[var(--text-faint)]">{t("actionEditor.contextUndeclared")}</span>
                    <button
                      type="button"
                      title={t("actionEditor.contextRemoveKey")}
                      onClick={() => setCtxValue(k, "")}
                      className="ml-auto flex h-5 w-5 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      ×
                    </button>
                  </div>
                  <Input
                    value={ctxValues[k] ?? ""}
                    onChange={(e) => setCtxValue(k, e.target.value)}
                    className="h-7 px-2 py-0 font-mono text-xs"
                  />
                  <ArgInsertBar onInsert={(name) => setCtxValue(k, `${ctxValues[k] ?? ""}{${name}}`)} />
                </div>
              ))}
            <AddContextKey
              existing={new Set([...targetInputs.map((i) => i.name), ...Object.keys(ctxValues)])}
              onAdd={(k) => setCtxValue(k, `{${k}}`)}
            />
          </div>
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-[11px] text-[var(--text-mut)]">
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

/** Small "+ add a context key" row: type a key name, get an editable entry
 *  seeded with `{key}`. Needed for menus consuming undeclared args. */
function AddContextKey({
  existing,
  onAdd,
}: {
  existing: Set<string>;
  onAdd: (key: string) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const valid = /^[a-z][a-z0-9_]*$/.test(draft) && !existing.has(draft);
  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={draft}
        placeholder={t("actionEditor.contextAddPlaceholder")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && valid) {
            onAdd(draft);
            setDraft("");
          }
        }}
        className="h-7 min-w-0 flex-1 px-2 py-0 font-mono text-xs"
      />
      <button
        type="button"
        disabled={!valid}
        onClick={() => {
          onAdd(draft);
          setDraft("");
        }}
        className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[10px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
      >
        {t("actionEditor.contextAdd")}
      </button>
    </div>
  );
}

function OpenDialogEditor({
  projectId,
  action,
  onChange,
}: {
  projectId: ProjectId;
  action: Extract<Action, { type: "open_dialog" }>;
  onChange: (a: Action) => void;
}) {
  const dialogs = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId)?.dialogs ?? []);

  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>Dialogue cible</FieldLabel>
        <select
          value={action.dialogId}
          onChange={(e) => onChange({ ...action, dialogId: e.target.value as DialogId })}
          className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs text-[var(--text)]"
        >
          {dialogs.some((d) => d.id === action.dialogId) ? null : (
            <option value={action.dialogId}>
              {action.dialogId || "— choisir —"}
            </option>
          )}
          {dialogs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-[var(--text-mut)]">
        <input
          type="checkbox"
          checked={Boolean(action.clearContext)}
          onChange={(e) => onChange({ ...action, clearContext: e.target.checked || undefined })}
        />
        Réinitialiser le contexte
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
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">{t("actionEditor.commandHint")}</div>
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
                    ? "border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "border-[var(--border-soft)] bg-[var(--surface-raised)] text-[var(--text-mut)] hover:border-[var(--border-strong)]"
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

/** Literal-text send_message/broadcast editor (module-data steps): the raw
 *  string lives in `text.key` and edits replace the action via onChange. */
function LiteralTextEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "send_message" | "broadcast" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <FieldLabel>{t("actionEditor.textLiteral")}</FieldLabel>
      <textarea
        value={action.text.key}
        rows={2}
        placeholder={t("actionEditor.textPlaceholder")}
        onChange={(e) => onChange({ ...action, text: { key: e.target.value as I18nKey } })}
        className="textarea min-h-0 px-2 py-1 font-mono text-xs"
      />
      {looksLikeMiniMessage(action.text.key) ? (
        <div className="mt-1 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
          <MiniMessageInline source={action.text.key} className="font-mono text-xs" />
        </div>
      ) : null}
    </div>
  );
}

/** Literal-text show_title editor (module-data steps). */
function LiteralShowTitleEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "show_title" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.titleLiteral")}</FieldLabel>
        <input
          value={action.title.key}
          onChange={(e) => onChange({ ...action, title: { key: e.target.value as I18nKey } })}
          className="input h-8 px-2 font-mono text-xs"
        />
      </div>
      <div>
        <FieldLabel>{t("actionEditor.subtitleLiteral")}</FieldLabel>
        <input
          value={action.subtitle?.key ?? ""}
          onChange={(e) =>
            onChange({
              ...action,
              subtitle: e.target.value ? { key: e.target.value as I18nKey } : undefined,
            })
          }
          className="input h-8 px-2 font-mono text-xs"
        />
      </div>
    </div>
  );
}

function SendMessageEditor({
  projectId,
  action,
  menuId,
  elementId,
  clickType,
}: {
  projectId: ProjectId;
  action: Extract<Action, { type: "send_message" | "broadcast" }>;
  menuId?: MenuId;
  elementId?: ElementId;
  clickType?: ClickType;
}) {
  const { t } = useTranslation();
  // We don't go through the generic `onChange(action)` callback here:
  // the LText ref must stay stable so its translations in other languages
  // survive the edit. Writing through `setI18nValue` updates the value
  // map under the existing key instead of replacing the action.
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const edit = useTextEdit(projectId, action.text);
  const onTextChange = (value: string) =>
    setI18nValue({ projectId, lt: action.text, lang: edit.lang, value });

  const placeholderLocation = useMemo(
    () =>
      menuId && elementId && clickType
        ? ({ kind: "action" as const, menuId, elementId, clickType })
        // "" → no pack scope → usePlaceholderEntries returns [] (graceful degradation)
        : ({ kind: "menu" as const, menuId: "" as MenuId }),
    [menuId, elementId, clickType],
  );
  const placeholderEntries = usePlaceholderEntries(
    projectId,
    placeholderLocation,
  );

  return (
    <div>
      <FieldLabel>
        {edit.isFallback
          ? t("actionEditor.textLangFallback", { lang: edit.lang })
          : t("actionEditor.textLang", { lang: edit.lang })}
      </FieldLabel>
      <RevealField
        multiline
        rows={3}
        placeholder={t("actionEditor.textPlaceholder")}
        value={edit.value}
        onChange={onTextChange}
        entries={placeholderEntries}
        facade={<MiniMessageInline source={edit.value} className="font-mono text-xs" />}
        preview={
          looksLikeMiniMessage(edit.value) ? (
            <div className="mt-1 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
              <span className="mr-2 text-[9px] uppercase text-[var(--text-faint)]">
                {t("menuProperties.preview")}
              </span>
              <MiniMessageInline source={edit.value} className="font-mono text-xs" />
            </div>
          ) : null
        }
      />
    </div>
  );
}

function ShowTitleEditor({
  projectId,
  action,
  onChange,
  menuId,
  elementId,
  clickType,
}: {
  projectId: ProjectId;
  action: Extract<Action, { type: "show_title" }>;
  onChange: (a: Action) => void;
  menuId?: MenuId;
  elementId?: ElementId;
  clickType?: ClickType;
}) {
  const { t } = useTranslation();
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const titleEdit = useTextEdit(projectId, action.title);
  const subtitleEdit = useTextEdit(projectId, action.subtitle ?? { key: UNALLOCATED_LTEXT_KEY });
  const hasSubtitle = !!action.subtitle;

  const placeholderLocation = useMemo(
    () =>
      menuId && elementId && clickType
        ? ({ kind: "action" as const, menuId, elementId, clickType })
        // "" → no pack scope → usePlaceholderEntries returns [] (graceful degradation)
        : ({ kind: "menu" as const, menuId: "" as MenuId }),
    [menuId, elementId, clickType],
  );
  const placeholderEntries = usePlaceholderEntries(projectId, placeholderLocation);

  const onTitleChange = (value: string) =>
    setI18nValue({ projectId, lt: action.title, lang: titleEdit.lang, value });
  const onSubtitleChange = (value: string) => {
    if (!action.subtitle) return;
    setI18nValue({ projectId, lt: action.subtitle, lang: subtitleEdit.lang, value });
  };

  const enableSubtitle = () => {
    // Seed with the unallocated sentinel; the next mutator that routes
    // through allocStepLTexts materializes a real key (Task 7 logic).
    onChange({ ...action, subtitle: { key: UNALLOCATED_LTEXT_KEY } });
  };
  const removeSubtitle = () => onChange({ ...action, subtitle: undefined });

  const setNumberField = (field: "fadeIn" | "stay" | "fadeOut", raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      const next = { ...action };
      delete next[field];
      onChange(next);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0) onChange({ ...action, [field]: Math.floor(n) });
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <FieldLabel>
          {titleEdit.isFallback
            ? t("actionEditor.showTitleTitleLabelFallback", { lang: titleEdit.lang })
            : t("actionEditor.showTitleTitleLabel", { lang: titleEdit.lang })}
        </FieldLabel>
        <RevealField
          multiline
          rows={2}
          placeholder={t("actionEditor.showTitleTitlePlaceholder")}
          value={titleEdit.value}
          onChange={onTitleChange}
          entries={placeholderEntries}
          facade={<MiniMessageInline source={titleEdit.value} className="font-mono text-xs" />}
          preview={
            looksLikeMiniMessage(titleEdit.value) ? (
              <div className="mt-1 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
                <span className="mr-2 text-[9px] uppercase text-[var(--text-faint)]">
                  {t("menuProperties.preview")}
                </span>
                <MiniMessageInline source={titleEdit.value} className="font-mono text-xs" />
              </div>
            ) : null
          }
        />
      </div>

      {hasSubtitle ? (
        <div>
          <FieldLabel>
            {subtitleEdit.isFallback
              ? t("actionEditor.showTitleSubtitleLabelFallback", { lang: subtitleEdit.lang })
              : t("actionEditor.showTitleSubtitleLabel", { lang: subtitleEdit.lang })}
          </FieldLabel>
          <RevealField
            multiline
            rows={2}
            placeholder={t("actionEditor.showTitleSubtitlePlaceholder")}
            value={subtitleEdit.value}
            onChange={onSubtitleChange}
            entries={placeholderEntries}
            facade={<MiniMessageInline source={subtitleEdit.value} className="font-mono text-xs" />}
            preview={
              looksLikeMiniMessage(subtitleEdit.value) ? (
                <div className="mt-1 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
                  <span className="mr-2 text-[9px] uppercase text-[var(--text-faint)]">
                    {t("menuProperties.preview")}
                  </span>
                  <MiniMessageInline source={subtitleEdit.value} className="font-mono text-xs" />
                </div>
              ) : null
            }
          />
          <button
            type="button"
            onClick={removeSubtitle}
            className="mt-1 text-[10px] text-[var(--text-faint)] hover:text-[var(--danger)]"
          >
            {t("actionEditor.showTitleSubtitleRemove")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={enableSubtitle}
          className="self-start rounded border border-dashed border-[var(--border)] px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--brand)] hover:text-[var(--brand)]"
        >
          {t("actionEditor.showTitleSubtitleEnable")}
        </button>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div>
          <FieldLabel>{t("actionEditor.showTitleFadeInLabel")}</FieldLabel>
          <Input
            type="number"
            min={0}
            placeholder="10"
            value={action.fadeIn ?? ""}
            onChange={(e) => setNumberField("fadeIn", e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>{t("actionEditor.showTitleStayLabel")}</FieldLabel>
          <Input
            type="number"
            min={0}
            placeholder="70"
            value={action.stay ?? ""}
            onChange={(e) => setNumberField("stay", e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>{t("actionEditor.showTitleFadeOutLabel")}</FieldLabel>
          <Input
            type="number"
            min={0}
            placeholder="20"
            value={action.fadeOut ?? ""}
            onChange={(e) => setNumberField("fadeOut", e.target.value)}
          />
        </div>
      </div>
      <div className="text-[10px] text-[var(--text-faint)]">{t("actionEditor.showTitleTicksHint")}</div>
    </div>
  );
}

function GiveItemEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "give_item" | "take_item" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const url = useTextureUrl(action.material);
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
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-[var(--border-soft)] bg-[var(--surface)] hover:border-[var(--brand)]"
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
                  <span className="text-[8px] text-[var(--text-faint)]">
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

function AmountEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "take_money" | "give_money" | "give_xp" | "give_level" }>;
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

function PlaySoundEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "play_sound" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const setNumber = (field: "volume" | "pitch", raw: string, max: number) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      const next = { ...action };
      delete next[field];
      onChange(next);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0 && n <= max) onChange({ ...action, [field]: n });
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.soundLabel")}</FieldLabel>
        <Input
          value={action.sound}
          placeholder="ENTITY_EXPERIENCE_ORB_PICKUP"
          onChange={(e) => onChange({ ...action, sound: e.target.value.toUpperCase() })}
          className="font-mono"
        />
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">{t("actionEditor.soundHint")}</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>{t("actionEditor.soundVolume")}</FieldLabel>
          <Input
            type="number"
            min={0}
            max={1}
            step={0.1}
            placeholder="1"
            value={action.volume ?? ""}
            onChange={(e) => setNumber("volume", e.target.value, 1)}
          />
        </div>
        <div>
          <FieldLabel>{t("actionEditor.soundPitch")}</FieldLabel>
          <Input
            type="number"
            min={0}
            max={2}
            step={0.1}
            placeholder="1"
            value={action.pitch ?? ""}
            onChange={(e) => setNumber("pitch", e.target.value, 2)}
          />
        </div>
      </div>
    </div>
  );
}

function TeleportEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "teleport" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const setCoord = (field: "x" | "y" | "z", raw: string) => {
    const n = Number(raw);
    if (Number.isFinite(n)) onChange({ ...action, [field]: n });
  };
  const setAngle = (field: "yaw" | "pitch", raw: string) => {
    const trimmed = raw.trim();
    if (trimmed === "") {
      const next = { ...action };
      delete next[field];
      onChange(next);
      return;
    }
    const n = Number(trimmed);
    if (Number.isFinite(n)) onChange({ ...action, [field]: n });
  };
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.teleportWorld")}</FieldLabel>
        <Input
          value={action.world}
          placeholder="world"
          onChange={(e) => onChange({ ...action, world: e.target.value })}
          className="font-mono"
        />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["x", "y", "z"] as const).map((axis) => (
          <div key={axis}>
            <FieldLabel>{axis.toUpperCase()}</FieldLabel>
            <Input
              type="number"
              value={action[axis]}
              onChange={(e) => setCoord(axis, e.target.value)}
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>{t("actionEditor.teleportYaw")}</FieldLabel>
          <Input
            type="number"
            placeholder="0"
            value={action.yaw ?? ""}
            onChange={(e) => setAngle("yaw", e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>{t("actionEditor.teleportPitch")}</FieldLabel>
          <Input
            type="number"
            placeholder="0"
            value={action.pitch ?? ""}
            onChange={(e) => setAngle("pitch", e.target.value)}
          />
        </div>
      </div>
    </div>
  );
}

function PaginateEditor({
  projectId,
  action,
  onChange,
}: {
  projectId: ProjectId;
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
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const getText = useGetText(projectId);
  const targets = useMemo(() => {
    if (!pack) return [];
    const out: { id: ElementId; menuTitle: string; alias: string; source: string }[] = [];
    for (const m of pack.menus) {
      for (const layer of m.layers) {
        for (const el of layer.elements) {
          if (el.iterates) {
            out.push({
              id: el.id,
              menuTitle: getText(getFirstTitleText(m)) || m.id,
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
                    ? "border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)]"
                    : "border-[var(--border-soft)] bg-[var(--surface-raised)] text-[var(--text-mut)] hover:border-[var(--border-strong)]"
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
          className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs text-[var(--text)]"
        >
          <option value="">{t("actionEditor.targetAllIterables")}</option>
          {targets.map((tgt) => (
            <option key={tgt.id} value={tgt.id}>
              {tgt.id} · {tgt.menuTitle} · {tgt.alias} ∈ {tgt.source}
            </option>
          ))}
        </select>
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">{t("actionEditor.paginateHint")}</div>
      </div>
    </div>
  );
}

function SetArgEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "set_arg" }>;
  onChange: (action: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-2">
      <div>
        <FieldLabel>{t("actionEditor.setArgArgLabel")}</FieldLabel>
        <Input
          value={action.arg}
          placeholder={t("actionEditor.setArgArgPlaceholder")}
          onChange={(e) => onChange({ ...action, arg: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
      </div>
      <div>
        <FieldLabel>{t("actionEditor.setArgValueLabel")}</FieldLabel>
        <Input
          value={action.value}
          placeholder={t("actionEditor.setArgValuePlaceholder")}
          onChange={(e) => onChange({ ...action, value: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">{t("actionEditor.setArgValueHint")}</div>
      </div>
    </div>
  );
}

function SetArgCycleEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "set_arg_cycle_next" | "set_arg_cycle_prev" }>;
  onChange: (action: Action) => void;
}) {
  const { t } = useTranslation();
  const directionKey =
    action.type === "set_arg_cycle_next"
      ? "actionEditor.setArgCycleDirectionNext"
      : "actionEditor.setArgCycleDirectionPrev";
  return (
    <div className="space-y-2">
      <div className="text-[10px] uppercase text-[var(--text-faint)]">{t(directionKey)}</div>
      <div>
        <FieldLabel>{t("actionEditor.setArgArgLabel")}</FieldLabel>
        <Input
          value={action.arg}
          placeholder={t("actionEditor.setArgArgPlaceholder")}
          onChange={(e) => onChange({ ...action, arg: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
      </div>
      <div>
        <FieldLabel>{t("actionEditor.setArgCycleListLabel")}</FieldLabel>
        <Input
          value={action.list}
          placeholder={t("actionEditor.setArgCycleListPlaceholder")}
          onChange={(e) => onChange({ ...action, list: e.target.value })}
          className="h-7 text-[11px] font-mono"
        />
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("actionEditor.setArgCycleListHint")}
        </div>
      </div>
    </div>
  );
}

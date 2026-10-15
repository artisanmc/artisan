import { ServerPlaceholderInput as PlaceholderInput } from "@/components/ServerPlaceholderInput";
import { RevealField } from "@/components/RevealField";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { useOtherServerProjects } from "@/features/serverIndex/useOtherServerProjects";
import { getText as libGetText } from "@/lib/i18n";
import { useUiStore } from "@/state/uiStore";
import { Input } from "@/components/ui/input";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import { getFirstTitleText } from "@/domain/menuTitle";
import type {
  Action,
  ClickType,
  DialogId,
  ElementId,
  I18nKey,
  LText,
  MenuId,
  ModelField,
  ProjectId,
} from "@/domain/types";
import { isLTextNode } from "@/domain/actionTextSlots";
import { canonicalModuleValue, normalizeModuleArgs } from "@/lib/actions/moduleActions";
import { useServerActionsStore } from "@/state/serverActionsStore";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { UNALLOCATED_LTEXT_KEY } from "@/features/flow/defaults";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import type { FieldLocation, PlaceholderEntry } from "@/lib/placeholderCatalog";
import { useGetText, useTextEdit } from "@/lib/useText";
import { useAccountStore } from "@/state/accountStore";
import { createContext, useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { dialogsOf, menusOf } from "@/domain/documents";

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
 * Where the edited actions run, for the actions that don't sit in an element
 * click (a command's steps). An element click passes menuId/elementId/clickType
 * directly; without either, only the builtin {player} is offered.
 */
const ActionScopeContext = createContext<FieldLocation | null>(null);
export const ActionScopeProvider = ActionScopeContext.Provider;

/** Placeholders of the edited action — the same catalog as the lore. */
const EntriesContext = createContext<PlaceholderEntry[]>([]);
const useActionEntries = () => useContext(EntriesContext);

const NO_SCOPE: FieldLocation = { kind: "dialog", dialogId: "" as DialogId };

/**
 * Per-type editor for a click/command Action. Render fields specific to the
 * action's discriminator and call back with the new action object on every
 * edit (immer/zundo handles undo on the store side).
 */
export function ActionEditor(props: ActionEditorProps) {
  const { projectId, menuId, elementId, clickType } = props;
  const scope = useContext(ActionScopeContext);
  const location = useMemo<FieldLocation>(
    () =>
      menuId && elementId && clickType
        ? { kind: "action", menuId, elementId, clickType }
        : (scope ?? NO_SCOPE),
    [menuId, elementId, clickType, scope],
  );
  const entries = usePlaceholderEntries(projectId, location);
  return (
    <EntriesContext.Provider value={entries}>
      <ActionFields {...props} />
    </EntriesContext.Provider>
  );
}

function ActionFields({ projectId, action, onChange, literalText }: ActionEditorProps) {
  const { t } = useTranslation();
  switch (action.type) {
    case "open_menu":
      return <OpenMenuEditor projectId={projectId} action={action} onChange={onChange} />;
    case "close_menu":
      return (
        <div className="text-[11px] text-[var(--text-faint)]">
          {t("actionEditor.closeMenuLabel")}
        </div>
      );
    case "open_previous_menu":
      return (
        <div className="text-[11px] text-[var(--text-faint)]">
          {t("actionEditor.openPreviousMenuLabel")}
        </div>
      );
    case "run_command":
      return <RunCommandEditor action={action} onChange={onChange} />;
    case "send_message":
    case "broadcast":
      if (literalText) return <LiteralTextEditor action={action} onChange={onChange} />;
      return <SendMessageEditor projectId={projectId} action={action} />;
    case "show_title":
      if (literalText) return <LiteralShowTitleEditor action={action} onChange={onChange} />;
      return <ShowTitleEditor projectId={projectId} action={action} onChange={onChange} />;
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
    case "run_actions":
      return <RunActionsEditor action={action} onChange={onChange} />;
    case "module":
      return (
        <ModuleActionEditor
          projectId={projectId}
          action={action}
          onChange={onChange}
          literalText={literalText}
        />
      );
  }
}

/**
 * A module's action (ADR `extensible-document-kinds`, R1): its form is rendered from the
 * declaration the connected server reported (`declared_actions`), argument by argument;
 * without a declaration the wire value is edited as JSON, so nothing is lost.
 */
function ModuleActionEditor({
  projectId,
  action,
  onChange,
  literalText,
}: {
  projectId: ProjectId;
  action: Extract<Action, { type: "module" }>;
  onChange: (a: Action) => void;
  literalText?: boolean;
}) {
  const { t } = useTranslation();
  const decl = useServerActionsStore((s) => s.actions.find((a) => a.name === action.name));
  if (!decl) {
    return (
      <div>
        <FieldLabel>{t("actionEditor.moduleValueLabel")}</FieldLabel>
        <JsonValueInput
          value={action.value}
          onChange={(value) => onChange({ type: "module", name: action.name, value })}
          ariaLabel={action.name}
        />
        <p className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("actionEditor.moduleUnknown")}
        </p>
      </div>
    );
  }
  const args = normalizeModuleArgs(decl, action.value);
  const setArg = (name: string, value: unknown) =>
    onChange({
      type: "module",
      name: action.name,
      value: canonicalModuleValue(decl, { ...args, [name]: value }),
    });
  if (decl.args.length === 0) {
    return <div className="text-[11px] text-[var(--text-faint)]">{decl.name}</div>;
  }
  return (
    <div className="space-y-2">
      {decl.args.map((arg) => (
        <div key={arg.name}>
          <FieldLabel>
            {arg.label ?? arg.name}
            {arg.required ? " *" : ""}
          </FieldLabel>
          <ModuleArgInput
            projectId={projectId}
            field={arg}
            value={args[arg.name]}
            onChange={(v) => setArg(arg.name, v)}
            literalText={literalText}
          />
          {arg.help ? (
            <p className="mt-1 text-[10px] text-[var(--text-faint)]">{arg.help}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** One declared argument: scalars get a typed input, structured kinds a JSON field. */
function ModuleArgInput({
  projectId,
  field,
  value,
  onChange,
  literalText,
}: {
  projectId: ProjectId;
  field: ModelField;
  value: unknown;
  onChange: (value: unknown) => void;
  literalText?: boolean;
}) {
  const type = field.type;
  switch (type.kind) {
    case "ltext":
      // A translated text: an LText node edited like a send_message text (its key stays,
      // so the other languages survive the edit). An absent text starts as the unallocated
      // sentinel the store mutator mints at the slot's address. Literal-text mode (module
      // data) and a wire text not adopted yet are edited as the plain string.
      if (literalText) break;
      if (isLTextNode(value)) return <ModuleTextInput projectId={projectId} lt={value} />;
      if (value == null) {
        return <AddTextButton onClick={() => onChange({ key: UNALLOCATED_LTEXT_KEY })} />;
      }
      break;
    default:
      break;
  }
  switch (type.kind) {
    case "string":
    case "document_ref":
    case "minimessage":
    case "minimessage_multiline":
    case "ltext":
      if (typeof value === "string" || value == null) {
        return (
          <Input
            className="h-7 w-full font-mono text-[12px]"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
            aria-label={field.name}
          />
        );
      }
      // A language map or another structured text: edited as is.
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
    case "number":
    case "integer":
      return (
        <Input
          type="number"
          className="h-7 w-32 font-mono text-[12px]"
          value={typeof value === "number" ? value : ""}
          onChange={(e) => {
            const n =
              type.kind === "integer"
                ? Number.parseInt(e.target.value, 10)
                : Number(e.target.value);
            onChange(e.target.value === "" || Number.isNaN(n) ? undefined : n);
          }}
          aria-label={field.name}
        />
      );
    case "boolean":
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
          aria-label={field.name}
        />
      );
    case "enum":
      return (
        <select
          className="input h-7 w-full text-[12px]"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
          aria-label={field.name}
        >
          <option value="">—</option>
          {type.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      );
    default:
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
  }
}

/** The translated text of a module action's argument, in the active language. */
function ModuleTextInput({ projectId, lt }: { projectId: ProjectId; lt: LText }) {
  const { t } = useTranslation();
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const edit = useTextEdit(projectId, lt);
  const placeholderEntries = useActionEntries();
  return (
    <div>
      <p className="mb-1 text-[10px] text-[var(--text-faint)]">
        {edit.isFallback
          ? t("actionEditor.textLangFallback", { lang: edit.lang })
          : t("actionEditor.textLang", { lang: edit.lang })}
      </p>
      <RevealField
        multiline
        rows={2}
        placeholder={t("actionEditor.textPlaceholder")}
        value={edit.value}
        onChange={(value) => setI18nValue({ projectId, lt, lang: edit.lang, value })}
        entries={placeholderEntries}
        facade={<MiniMessageInline source={edit.value} className="font-mono text-xs" />}
      />
    </div>
  );
}

function AddTextButton({ onClick }: { onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <button type="button" className="btn btn-ghost h-7 text-[11px]" onClick={onClick}>
      {t("actionEditor.moduleAddText")}
    </button>
  );
}

/** A JSON-edited value: the draft is parsed on blur, an invalid draft changes nothing. */
function JsonValueInput({
  value,
  onChange,
  ariaLabel,
}: {
  value: unknown;
  onChange: (value: unknown) => void;
  ariaLabel: string;
}) {
  const { t } = useTranslation();
  const printed = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState(printed);
  const [edited, setEdited] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const shown = edited ? draft : printed;
  const commit = () => {
    setEdited(false);
    if (draft.trim() === "") {
      setInvalid(false);
      onChange(undefined);
      return;
    }
    try {
      onChange(JSON.parse(draft));
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };
  return (
    <div>
      <textarea
        className="input min-h-16 w-full font-mono text-[11px]"
        value={shown}
        onChange={(e) => {
          setDraft(e.target.value);
          setEdited(true);
        }}
        onBlur={commit}
        aria-label={ariaLabel}
        aria-invalid={invalid}
      />
      {invalid ? (
        <p className="mt-1 text-[10px] text-[var(--danger)]">
          {t("actionEditor.moduleValueInvalid")}
        </p>
      ) : null}
    </div>
  );
}

function RunActionsEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "run_actions" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  return (
    <div>
      <FieldLabel>{t("actionEditor.runActionsLabel")}</FieldLabel>
      <input
        className="input h-7 w-full font-mono text-[12px]"
        value={action.actions}
        onChange={(e) => onChange({ type: "run_actions", actions: e.target.value })}
        placeholder="item.on_buy"
        aria-label={t("actionEditor.runActionsLabel")}
      />
      <p className="mt-1 text-[10px] text-[var(--text-faint)]">
        {t("actionEditor.runActionsHint")}
      </p>
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] uppercase text-[var(--text-faint)]">{children}</div>;
}

function MenuOptionLabel({ id, title }: { id: string; title: string }) {
  return (
    <span className="truncate">
      {id}
      {title ? (
        <>
          {" · "}
          <MiniMessageInline source={title} />
        </>
      ) : null}
    </span>
  );
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
  const menus = useAccountStore((s) => menusOf(s.account.projects.find((p) => p.id === projectId)));
  const others = useOtherServerProjects(projectId);
  const activeLang = useUiStore((s) => s.activeLang);
  // A qualified target (`boutique:main`) lives in another project: it is read
  // from the server index (published state) for its title and inputs.
  const ref = parseDocRef(action.menuId);
  const remote =
    ref.namespace === null
      ? null
      : (others
          .filter((p) => projectNamespace(p) === ref.namespace)
          .flatMap((p) =>
            menusOf(p)
              .filter((m) => m.id === ref.id)
              .map((m) => ({ project: p, menu: m })),
          )[0] ?? null);
  const targetMenu = remote ? remote.menu : menus.find((m) => m.id === action.menuId);
  const targetTitle = remote
    ? libGetText(remote.project, getFirstTitleText(remote.menu), activeLang)
    : undefined;
  // Only PRIMITIVE inputs are caller-passed; sourceRef inputs are FETCHED by
  // the target menu itself (ContextBinder) — asking the caller to fill them
  // was a trap ("items: ?").
  const targetInputs = (targetMenu?.contextInputs ?? []).filter((i) => i.kind === "primitive");
  const ctxValues = action.context ?? {};
  const getText = useGetText(projectId);
  const entries = useActionEntries();

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-1 truncate rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 text-left font-mono text-xs text-[var(--text)]"
            >
              {targetMenu ? (
                <MenuOptionLabel
                  id={action.menuId}
                  title={targetTitle ?? getText(getFirstTitleText(targetMenu))}
                />
              ) : (
                t("actionEditor.menuMissing", { id: action.menuId })
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
            <DropdownMenuRadioGroup
              value={action.menuId}
              onValueChange={(v) => onChange({ ...action, menuId: v as MenuId })}
            >
              {menus.map((m) => (
                <DropdownMenuRadioItem key={m.id} value={m.id} className="font-mono text-xs">
                  <MenuOptionLabel id={m.id} title={getText(getFirstTitleText(m))} />
                </DropdownMenuRadioItem>
              ))}
              {others
                .filter((p) => menusOf(p).length > 0)
                .map((p) => (
                  <DropdownMenuGroup key={p.id}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-[10px] uppercase text-[var(--text-faint)]">
                      {p.name}
                    </DropdownMenuLabel>
                    {menusOf(p).map((m) => (
                      <DropdownMenuRadioItem
                        key={m.id}
                        value={`${projectNamespace(p)}:${m.id}`}
                        className="font-mono text-xs"
                      >
                        <MenuOptionLabel
                          id={m.id}
                          title={libGetText(p, getFirstTitleText(m), activeLang)}
                        />
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuGroup>
                ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {targetInputs.length > 0 || Object.keys(ctxValues).length > 0 ? (
        <div>
          <FieldLabel>{t("actionEditor.contextToPass")}</FieldLabel>
          <div className="flex flex-col gap-1.5">
            {targetInputs.map((input) => (
              <div
                key={input.name}
                className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
              >
                <div className="mb-1 flex items-center gap-2 font-mono text-[10px]">
                  <span className="text-[var(--brand)]">{input.name}</span>
                  <span className="text-[var(--text-faint)]">
                    : {input.kind === "primitive" ? input.type : "sourceRef"}
                  </span>
                </div>
                <PlaceholderInput
                  value={ctxValues[input.name] ?? ""}
                  placeholder={t("actionEditor.placeholderOrLiteral", {
                    tag: `{${input.name}}`,
                  })}
                  onChange={(value) => setCtxValue(input.name, value)}
                  entries={entries}
                  className="h-7 px-2 py-0 font-mono text-xs"
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
                <div
                  key={k}
                  className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
                >
                  <div className="mb-1 flex items-center gap-2 font-mono text-[10px]">
                    <span className="text-[var(--brand)]">{k}</span>
                    <span className="text-[var(--text-faint)]">
                      {t("actionEditor.contextUndeclared")}
                    </span>
                    <button
                      type="button"
                      title={t("actionEditor.contextRemoveKey")}
                      onClick={() => setCtxValue(k, "")}
                      className="ml-auto flex h-5 w-5 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                    >
                      ×
                    </button>
                  </div>
                  <PlaceholderInput
                    value={ctxValues[k] ?? ""}
                    onChange={(value) => setCtxValue(k, value)}
                    entries={entries}
                    className="h-7 px-2 py-0 font-mono text-xs"
                  />
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
  const { t } = useTranslation();
  const dialogs = useAccountStore((s) =>
    dialogsOf(s.account.projects.find((p) => p.id === projectId)),
  );
  const others = useOtherServerProjects(projectId).filter((p) => dialogsOf(p).length > 0);
  const known =
    dialogs.some((d) => d.id === action.dialogId) ||
    others.some((p) =>
      dialogsOf(p).some((d) => `${projectNamespace(p)}:${d.id}` === action.dialogId),
    );

  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.targetDialog")}</FieldLabel>
        <select
          value={action.dialogId}
          onChange={(e) => onChange({ ...action, dialogId: e.target.value as DialogId })}
          className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs text-[var(--text)]"
        >
          {known ? null : (
            <option value={action.dialogId}>{action.dialogId || t("actionEditor.choose")}</option>
          )}
          {dialogs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id}
            </option>
          ))}
          {others.map((p) => (
            <optgroup key={p.id} label={p.name}>
              {dialogsOf(p).map((d) => (
                <option key={d.id} value={`${projectNamespace(p)}:${d.id}`}>
                  {d.id}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
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

function RunCommandEditor({
  action,
  onChange,
}: {
  action: Extract<Action, { type: "run_command" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const entries = useActionEntries();
  return (
    <div className="flex flex-col gap-2">
      <div>
        <FieldLabel>{t("actionEditor.command")}</FieldLabel>
        <PlaceholderInput
          value={action.command}
          placeholder={t("actionEditor.commandPlaceholder")}
          onChange={(command) => onChange({ ...action, command })}
          entries={entries}
        />
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("actionEditor.commandHint")}
        </div>
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
}: {
  projectId: ProjectId;
  action: Extract<Action, { type: "send_message" | "broadcast" }>;
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

  const placeholderEntries = useActionEntries();

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
}: {
  projectId: ProjectId;
  action: Extract<Action, { type: "show_title" }>;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  const titleEdit = useTextEdit(projectId, action.title);
  const subtitleEdit = useTextEdit(projectId, action.subtitle ?? { key: UNALLOCATED_LTEXT_KEY });
  const hasSubtitle = !!action.subtitle;

  const placeholderEntries = useActionEntries();

  const onTitleChange = (value: string) =>
    setI18nValue({ projectId, lt: action.title, lang: titleEdit.lang, value });
  const onSubtitleChange = (value: string) => {
    if (!action.subtitle) return;
    setI18nValue({ projectId, lt: action.subtitle, lang: subtitleEdit.lang, value });
  };

  const enableSubtitle = () => {
    // Seed with the unallocated sentinel; the next mutator that routes
    // through allocStepLTexts materializes a real key.
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
      <div className="text-[10px] text-[var(--text-faint)]">
        {t("actionEditor.showTitleTicksHint")}
      </div>
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
            onChange={(e) => onChange({ ...action, material: e.target.value })}
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
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("actionEditor.soundHint")}
        </div>
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
  // List every iterating element across the project so the user can target
  // a specific pager. "All iterables" is the default — fits the common
  // "single list per menu" case.
  //
  // The project ref itself is stable thanks to immer — selecting it from
  // the store doesn't allocate. Derive `targets` via useMemo so we don't
  // hand zustand a fresh array on every render (that'd loop the identity
  // check, same trap as ItemTooltip's findElementAndMenu).
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const getText = useGetText(projectId);
  const targets = useMemo(() => {
    if (!project) return [];
    const out: { id: ElementId; menuTitle: string; alias: string; source: string }[] = [];
    for (const m of menusOf(project)) {
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
  }, [project, getText]);

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
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("actionEditor.paginateHint")}
        </div>
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
  const entries = useActionEntries();
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
        <PlaceholderInput
          value={action.value}
          placeholder={t("actionEditor.setArgValuePlaceholder")}
          onChange={(value) => onChange({ ...action, value })}
          entries={entries}
          className="h-7 text-[11px] font-mono"
        />
        <div className="mt-1 text-[10px] text-[var(--text-faint)]">
          {t("actionEditor.setArgValueHint")}
        </div>
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

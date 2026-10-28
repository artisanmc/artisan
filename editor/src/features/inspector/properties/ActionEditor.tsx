import { MiniMessageField } from "@/components/MiniMessageField";
import { RevealField } from "@/components/RevealField";
import { ServerPlaceholderInput as PlaceholderInput } from "@/components/ServerPlaceholderInput";
import { Input } from "@/components/ui/input";
import { usePlaceholderEntries } from "@/components/usePlaceholderEntries";
import { isLTextNode, normalizeActionArgs, withActionArg } from "@/domain/actionArgs";
import { parseDocRef, projectNamespace } from "@/domain/docRef";
import { menusOf } from "@/domain/documents";
import { getFirstTitleText } from "@/domain/menuTitle";
import { fileArgType, findDeclaredCommand } from "@/domain/moduleCommands";
import type {
  Action,
  ClickType,
  DialogId,
  ElementId,
  I18nKey,
  LText,
  MenuId,
  ModelField,
  ModelFieldType,
  ProjectId,
} from "@/domain/types";
import { MaterialField } from "@/features/canvas/MaterialField";
import { useOtherServerProjects } from "@/features/serverIndex/useOtherServerProjects";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { useDeclaredActionOf } from "@/lib/actions/coreActions";
import { isEventAction, setEventArgs, useChainEvent } from "@/lib/actions/eventActions";
import type { DeclaredAction } from "@/lib/api/declaredActions";
import type { DeclaredCommand } from "@/lib/api/playerCommands";
import type { FieldLocation, PlaceholderEntry } from "@/lib/placeholderCatalog";
import { useGetText, useTextEdit } from "@/lib/useText";
import { useProjectsStore } from "@/state/projectsStore";
import { useServerPlayerCommandsStore } from "@/state/serverPlayerCommandsStore";
import { createContext, useContext, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { UNALLOCATED_LTEXT_KEY } from "../chain/defaults";
import { FieldLabel } from "../layout";
import { DocumentRefField } from "./DocumentRefField";

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
 * The form of a click/command/dialog Action, rendered from its declaration (ADR
 * `extensible-document-kinds`, R1/W4): Artisan's own actions from the shared table
 * (`testdata/core-actions.json`), a module's from the server's `declared_actions`, one
 * input per argument chosen by the argument's kind. A few core arguments get a richer
 * widget than their kind alone would give ({@link ARG_WIDGETS}: a material picker, the
 * iterating elements of the project, the context inputs of the target menu). Without a
 * declaration the wire value is edited as JSON, so nothing is lost. Every edit calls back
 * with the new action object (immer/zundo handles undo on the store side).
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
  const declOf = useDeclaredActionOf();
  const decl = declOf(action.name);
  // The event actions are edited from the chain's Game event, not from their declaration.
  if (isEventAction(action.name))
    return <EventActionFields projectId={projectId} action={action} onChange={onChange} />;
  if (!decl) {
    return (
      <div>
        <FieldLabel>{t("actionEditor.moduleValueLabel")}</FieldLabel>
        <JsonValueInput
          value={action.value}
          onChange={(value) => onChange({ name: action.name, value: value ?? null })}
          ariaLabel={action.name}
        />
        <p className="mt-1 text-[11px] text-[var(--text-faint)]">
          {t("actionEditor.moduleUnknown")}
        </p>
      </div>
    );
  }
  if (decl.args.length === 0) {
    return (
      <div className="text-[11px] text-[var(--text-faint)]">
        {t(`actionEditor.hints.${decl.name}`, { defaultValue: decl.name })}
      </div>
    );
  }
  return (
    <DeclaredActionForm
      projectId={projectId}
      decl={decl}
      action={action}
      onChange={onChange}
      literalText={literalText}
    />
  );
}

/**
 * `cancel_event` and `set_event` (ADR `triggers-and-variables` §3 bis), from the Game event of
 * the Trigger whose chain this is: whether it can be cancelled, and the effects it declares,
 * each typed. Outside a Trigger they have no event: a warning, the value kept as is.
 */
function EventActionFields({
  projectId,
  action,
  onChange,
}: {
  projectId: ProjectId;
  action: Action;
  onChange: (a: Action) => void;
}) {
  const { t } = useTranslation();
  const event = useChainEvent();
  const entries = useActionEntries();
  const hint = (text: string, tone: "faint" | "warning" = "faint") => (
    <p
      className={
        tone === "warning"
          ? "text-[11px] text-[var(--warning)]"
          : "text-[11px] text-[var(--text-faint)]"
      }
    >
      {text}
    </p>
  );
  if (!event) return hint(t("triggers.outsideTrigger"), "warning");
  const eventTitle = t(`triggers.events.${event.name}.title`, { defaultValue: event.name });
  if (action.name === "cancel_event") {
    return event.cancellable
      ? hint(t("triggers.cancelHint"))
      : hint(t("triggers.notCancellable", { event: eventTitle }), "warning");
  }
  if (event.effects.length === 0) return hint(t("triggers.noEffectsHere"), "warning");
  const args = setEventArgs(action.value);
  const write = (next: Record<string, unknown>) => onChange({ name: action.name, value: next });
  const effectLabel = (name: string) => {
    const field = event.effects.find((e) => e.name === name);
    return t(`triggers.effects.${name}`, { defaultValue: field?.label ?? name });
  };
  const unused = event.effects.filter((e) => !(e.name in args));
  return (
    <div className="flex flex-col gap-2">
      {Object.entries(args).map(([name, value]) => {
        const field = event.effects.find((e) => e.name === name);
        return (
          <div key={name}>
            <FieldLabel>
              {effectLabel(name)}
              {field ? "" : ` (${t("actionEditor.moduleUnknown")})`}
            </FieldLabel>
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                {isLTextNode(value) ? (
                  // A text players read: translated like any other, one value per language.
                  <TextArgInput projectId={projectId} lt={value} />
                ) : field?.type.kind === "boolean" ? (
                  <select
                    className="select h-7 w-full rounded-[var(--r-xs)] py-0 pr-7 pl-2 text-xs"
                    value={String(value === true || value === "true")}
                    onChange={(e) => write({ ...args, [name]: e.target.value === "true" })}
                    aria-label={name}
                  >
                    <option value="true">{t("triggers.yes")}</option>
                    <option value="false">{t("triggers.no")}</option>
                  </select>
                ) : (
                  <PlaceholderInput
                    value={value == null ? "" : String(value)}
                    onChange={(v) => {
                      const numeric =
                        field?.type.kind === "integer" || field?.type.kind === "number";
                      write({
                        ...args,
                        [name]:
                          numeric && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v,
                      });
                    }}
                    entries={entries}
                    className="h-7 px-2 py-0 font-mono text-xs"
                    aria-label={name}
                  />
                )}
              </div>
              <button
                type="button"
                className="btn btn-ghost h-7 px-2 text-[12px]"
                aria-label={t("triggers.removeEffect")}
                onClick={() => {
                  const { [name]: _, ...rest } = args;
                  write(rest);
                }}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {unused.length > 0 ? (
        <select
          className="select h-7 w-auto self-start rounded-[var(--r-xs)] py-0 pr-7 pl-2 text-xs"
          value=""
          onChange={(e) => {
            const field = event.effects.find((f) => f.name === e.target.value);
            if (field) write({ ...args, [field.name]: defaultEffectValue(field) });
          }}
          aria-label={t("triggers.pickEffect")}
        >
          <option value="">{t("triggers.pickEffect")}</option>
          {unused.map((f) => (
            <option key={f.name} value={f.name}>
              {effectLabel(f.name)}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

/**
 * What a fresh `set_event` entry holds: true for a flag, 0 for a number, a text to translate
 * (minted at `…set_event.<effect>` by the store) for anything players read.
 */
export function defaultEffectValue(field: ModelField): unknown {
  switch (field.type.kind) {
    case "boolean":
      return true;
    case "integer":
    case "number":
      return 0;
    default:
      return { key: UNALLOCATED_LTEXT_KEY };
  }
}

/** One row per declared argument, in the declaration's order. */
function DeclaredActionForm({
  projectId,
  decl,
  action,
  onChange,
  literalText,
}: {
  projectId: ProjectId;
  decl: DeclaredAction;
  action: Action;
  onChange: (a: Action) => void;
  literalText?: boolean;
}) {
  const { t } = useTranslation();
  const args = normalizeActionArgs(decl, action.value);
  const setArg = (name: string, value: unknown) =>
    onChange(withActionArg(action, decl, name, value));
  return (
    <div className="flex flex-col gap-2">
      {decl.args.map((arg) => {
        const help =
          arg.help ?? t(`actionEditor.help.${decl.name}.${arg.name}`, { defaultValue: "" });
        return (
          <div key={arg.name}>
            <FieldLabel>
              {argLabel(decl, arg, t)}
              {arg.required ? " *" : ""}
            </FieldLabel>
            <ArgInput
              projectId={projectId}
              decl={decl}
              field={arg}
              args={args}
              value={args[arg.name]}
              onChange={(v) => setArg(arg.name, v)}
              literalText={literalText}
            />
            {help ? <p className="mt-1 text-[11px] text-[var(--text-faint)]">{help}</p> : null}
          </div>
        );
      })}
    </div>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The label of an argument: the editor's wording for a core argument, else the declaration's. */
function argLabel(decl: DeclaredAction, arg: ModelField, t: Translate): string {
  return t(`actionEditor.args.${decl.name}.${arg.name}`, { defaultValue: arg.label ?? arg.name });
}

// Argument widgets

interface ArgInputProps {
  projectId: ProjectId;
  decl: DeclaredAction;
  field: ModelField;
  /** Every argument of the action, for widgets that read a sibling (the context of a target). */
  args: Record<string, unknown>;
  value: unknown;
  onChange: (value: unknown) => void;
  literalText?: boolean;
}

/** Numeric bounds of a core argument, where the kind alone says nothing. */
const NUMBER_BOUNDS: Record<string, { min?: number; max?: number; step?: number }> = {
  "give_item.count": { min: 1, max: 64 },
  "take_item.count": { min: 1, max: 64 },
  "play_sound.volume": { min: 0, max: 1, step: 0.1 },
  "play_sound.pitch": { min: 0, max: 2, step: 0.1 },
  "show_title.fade_in": { min: 0 },
  "show_title.stay": { min: 0 },
  "show_title.fade_out": { min: 0 },
  "give_money.amount": { min: 0 },
  "take_money.amount": { min: 0 },
  "give_xp.amount": { min: 0 },
  "give_level.amount": { min: 0 },
};

/**
 * A richer widget for a core argument than its kind alone gives: the argument's
 * `<action>.<name>` → the component. Everything else is chosen by kind in {@link ArgInput}.
 */
const ARG_WIDGETS: Record<string, (p: ArgInputProps) => React.ReactElement> = {
  "give_item.material": (p) => <MaterialInput {...p} />,
  "take_item.material": (p) => <MaterialInput {...p} />,
  "play_sound.sound": (p) => <SoundInput {...p} />,
  "pagination_next.element_id": (p) => <IterableTargetSelect {...p} />,
  "pagination_prev.element_id": (p) => <IterableTargetSelect {...p} />,
  "run_command.command": (p) => <ExpressionInput {...p} placeholder="spawn" />,
  "set_arg.value": (p) => <ExpressionInput {...p} placeholder='"weapon"' />,
  "run_actions.actions": (p) => <ExpressionInput {...p} placeholder="item.on_buy" />,
  "set_arg_cycle_next.list": (p) => <ExpressionInput {...p} placeholder="categories" />,
  "set_arg_cycle_prev.list": (p) => <ExpressionInput {...p} placeholder="categories" />,
  "module_command.command": (p) => <ModuleCommandInput {...p} />,
  "module_command.args": (p) => <ModuleCommandArgsInput {...p} />,
};

function ArgInput(p: ArgInputProps) {
  const { decl, field, value, onChange, literalText } = p;
  const widget = ARG_WIDGETS[`${decl.name}.${field.name}`];
  if (widget) return widget(p);
  const type = field.type;
  switch (type.kind) {
    case "ltext":
      // A translated text: an LText node edited like a title (its key stays, so the other
      // languages survive the edit). An absent text starts as the unallocated sentinel the
      // store mutator mints at the slot's address. Literal-text mode (module data) and a
      // wire text not adopted yet are edited as the plain string.
      if (literalText) return <LiteralTextInput {...p} />;
      if (isLTextNode(value))
        return (
          <TextArgInput
            projectId={p.projectId}
            lt={value}
            onRemove={field.required ? undefined : () => onChange(undefined)}
          />
        );
      if (value == null)
        return <AddTextButton onClick={() => onChange({ key: UNALLOCATED_LTEXT_KEY })} />;
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
    case "document_ref":
      return (
        <DocumentRefField
          projectId={p.projectId}
          kind={type.document}
          value={typeof value === "string" ? value : ""}
          onChange={(id) => onChange(id === "" ? undefined : id)}
          aria-label={field.name}
        />
      );
    case "map":
      // The context handed to the Document an action opens, keyed by its context inputs.
      if (type.of.kind === "string" && decl.args.some((a) => a.type.kind === "document_ref"))
        return <ContextMapInput {...p} />;
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
    case "list":
      if (type.of.kind === "ltext" || type.of.kind === "string")
        return <ListArgInput {...p} of={type.of} />;
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
    case "minimessage":
    case "minimessage_multiline":
      if (typeof value === "string" || value == null) {
        return (
          <MiniMessageField
            multiline={type.kind === "minimessage_multiline"}
            value={typeof value === "string" ? value : ""}
            onChange={(next) => onChange(next === "" ? undefined : next)}
            className="h-7 w-full font-mono text-[12px]"
            aria-label={field.name}
          />
        );
      }
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
    case "string":
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
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
    case "number":
    case "integer":
      return <NumberInput {...p} />;
    case "boolean":
      return (
        <label className="flex items-center gap-2 text-[11px] text-[var(--text-mut)]">
          <input
            type="checkbox"
            checked={(value ?? field.default) === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-label={field.name}
          />
          {field.help ?? ""}
        </label>
      );
    case "enum":
      return <EnumInput {...p} values={type.values} />;
    default:
      return <JsonValueInput value={value} onChange={onChange} ariaLabel={field.name} />;
  }
}

function NumberInput({ decl, field, value, onChange }: ArgInputProps) {
  const bounds = NUMBER_BOUNDS[`${decl.name}.${field.name}`] ?? {};
  const min = field.min ?? bounds.min;
  const max = field.max ?? bounds.max;
  const integer = field.type.kind === "integer";
  const shown =
    typeof value === "number" ? value : typeof field.default === "number" ? field.default : "";
  return (
    <Input
      type="number"
      className="h-7 w-32 font-mono text-[12px]"
      min={min}
      max={max}
      step={bounds.step ?? (integer ? 1 : "any")}
      value={shown}
      onChange={(e) => {
        const raw = e.target.value.trim();
        if (raw === "") {
          onChange(undefined);
          return;
        }
        const n = integer ? Number.parseInt(raw, 10) : Number(raw);
        if (!Number.isFinite(n)) return;
        if (min !== undefined && n < min) return;
        if (max !== undefined && n > max) return;
        onChange(n);
      }}
      aria-label={field.name}
    />
  );
}

/** A closed value set: segmented buttons when small, a select otherwise. */
function EnumInput({ field, value, onChange, values }: ArgInputProps & { values: string[] }) {
  const { t } = useTranslation();
  const current =
    typeof value === "string" ? value : typeof field.default === "string" ? field.default : "";
  const label = (v: string) => t(`actionEditor.enum.${v}`, { defaultValue: v });
  if (values.length <= 3) {
    return (
      <div className="flex gap-2">
        {values.map((v) => {
          const active = current === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={`flex-1 rounded border px-2 py-1 font-mono text-xs ${
                active
                  ? "border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)]"
                  : "border-[var(--border-soft)] bg-[var(--surface-raised)] text-[var(--text-mut)] hover:border-[var(--border-strong)]"
              }`}
            >
              {label(v)}
            </button>
          );
        })}
      </div>
    );
  }
  return (
    <select
      className="input h-7 w-full text-[12px]"
      value={current}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      aria-label={field.name}
    >
      <option value="">—</option>
      {values.map((v) => (
        <option key={v} value={v}>
          {label(v)}
        </option>
      ))}
    </select>
  );
}

/** A command or an expression: the placeholder catalog of the edited action is offered. */
function ExpressionInput({
  field,
  value,
  onChange,
  placeholder,
}: ArgInputProps & { placeholder: string }) {
  const entries = useActionEntries();
  return (
    <PlaceholderInput
      value={typeof value === "string" ? value : ""}
      placeholder={placeholder}
      onChange={(v) => onChange(v === "" ? undefined : v)}
      entries={entries}
      className="h-7 px-2 py-0 font-mono text-xs"
      aria-label={field.name}
    />
  );
}

function MaterialInput({ field, value, onChange }: ArgInputProps) {
  return (
    <MaterialField
      value={typeof value === "string" ? value : ""}
      onChange={(material) => onChange(material === "" ? undefined : material)}
      aria-label={field.name}
    />
  );
}

function SoundInput({ field, value, onChange }: ArgInputProps) {
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      placeholder="ENTITY_EXPERIENCE_ORB_PICKUP"
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value.toUpperCase())}
      className="font-mono"
      aria-label={field.name}
    />
  );
}

/** The iterating elements of the project: the pager an action advances, or all of them. */
function IterableTargetSelect({ projectId, field, value, onChange }: ArgInputProps) {
  // The project ref itself is stable thanks to immer — selecting it from the store doesn't
  // allocate. Derive `targets` via useMemo so we don't hand zustand a fresh array on every
  // render (that'd loop the identity check, same trap as ItemTooltip's findElementAndMenu).
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
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
    <select
      value={typeof value === "string" ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      className="w-full rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] px-2 py-1 font-mono text-xs text-[var(--text)]"
      aria-label={field.name}
    >
      <option value="">{t("actionEditor.targetAllIterables")}</option>
      {targets.map((tgt) => (
        <option key={tgt.id} value={tgt.id}>
          {tgt.id} · {tgt.menuTitle} · {tgt.alias} ∈ {tgt.source}
        </option>
      ))}
    </select>
  );
}

/** A `list(ltext | string)` argument: one row per entry, add and remove. */
function ListArgInput({
  projectId,
  field,
  value,
  onChange,
  literalText,
  of,
}: ArgInputProps & { of: ModelFieldType }) {
  const { t } = useTranslation();
  const entries = Array.isArray(value) ? value : [];
  const setEntry = (i: number, v: unknown) => {
    const next = [...entries];
    next[i] = v;
    onChange(next);
  };
  const remove = (i: number) => {
    const next = entries.filter((_, j) => j !== i);
    onChange(next.length === 0 ? undefined : next);
  };
  const add = () =>
    onChange([
      ...entries,
      of.kind === "ltext" && !literalText ? { key: UNALLOCATED_LTEXT_KEY } : "",
    ]);
  return (
    <div className="flex flex-col gap-1.5">
      {entries.map((entry, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: entries have no identity of their own
        <div key={i} className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            {of.kind === "ltext" && !literalText && isLTextNode(entry) ? (
              <TextArgInput projectId={projectId} lt={entry} />
            ) : (
              <Input
                className="h-7 w-full font-mono text-[12px]"
                value={typeof entry === "string" ? entry : isLTextNode(entry) ? entry.key : ""}
                onChange={(e) =>
                  setEntry(
                    i,
                    of.kind === "ltext" ? { key: e.target.value as I18nKey } : e.target.value,
                  )
                }
                aria-label={`${field.name}[${i}]`}
              />
            )}
          </div>
          <button
            type="button"
            title={t("actionEditor.listRemove")}
            onClick={() => remove(i)}
            className="flex h-7 w-6 shrink-0 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-ghost h-7 self-start text-[11px]" onClick={add}>
        {t("actionEditor.listAdd")}
      </button>
    </div>
  );
}

/** A text argument in literal-text mode (module-data steps): the raw string is the key. */
function LiteralTextInput({ field, value, onChange }: ArgInputProps) {
  const { t } = useTranslation();
  const text = isLTextNode(value) ? value.key : typeof value === "string" ? value : "";
  return (
    <MiniMessageField
      multiline
      rows={2}
      value={text}
      placeholder={t("actionEditor.textPlaceholder")}
      onChange={(next) =>
        onChange(next === "" && !field.required ? undefined : { key: next as I18nKey })
      }
      className="min-h-0 px-2 py-1 font-mono text-xs"
      aria-label={field.name}
    />
  );
}

/**
 * The translated text of an argument, in the active language. The LText ref stays stable
 * so its translations in other languages survive the edit: the value map is written under
 * the existing key through `setI18nValue` instead of replacing the action.
 */
function TextArgInput({
  projectId,
  lt,
  onRemove,
}: { projectId: ProjectId; lt: LText; onRemove?: () => void }) {
  const { t } = useTranslation();
  const setI18nValue = useProjectsStore((s) => s.setI18nValue);
  const edit = useTextEdit(projectId, lt);
  const placeholderEntries = useActionEntries();
  return (
    <div>
      <p className="mb-1 text-[11.5px] text-[var(--text-faint)]">
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
        className="min-h-0 rounded-[var(--r-xs)] text-[13px]"
        facade={<MiniMessageInline source={edit.value} className="mc-text" />}
        preview={
          looksLikeMiniMessage(edit.value) ? (
            <div className="mt-1 rounded border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2 py-1">
              <span className="mr-2 text-[11px] font-medium text-[var(--text-faint)]">
                {t("menuProperties.preview")}
              </span>
              <MiniMessageInline source={edit.value} className="mc-text text-[13px]" />
            </div>
          ) : null
        }
      />
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="mt-1 text-[11px] text-[var(--text-faint)] hover:text-[var(--danger)]"
        >
          {t("actionEditor.textRemove")}
        </button>
      ) : null}
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
        <p className="mt-1 text-[11px] text-[var(--danger)]">
          {t("actionEditor.moduleValueInvalid")}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The context an action hands to the Document it opens (`open_menu` / `open_dialog` and
 * any module action with a `document_ref` and a `map(string)`): one row per primitive
 * context input the target menu declares, plus the keys the action already carries that
 * the target never declared (menus may consume `{args}` in filters/titles without
 * declaring them — without these rows that context is invisible and uneditable).
 */
function ContextMapInput({ projectId, decl, args, value, onChange }: ArgInputProps) {
  const { t } = useTranslation();
  const entries = useActionEntries();
  const refArg = decl.args.find((a) => a.type.kind === "document_ref");
  const targetId =
    refArg && typeof args[refArg.name] === "string" ? (args[refArg.name] as string) : "";
  const targetKind = refArg?.type.kind === "document_ref" ? refArg.type.document : "";
  const menus = useProjectsStore((s) =>
    menusOf(s.openProjects.projects.find((p) => p.id === projectId)),
  );
  const others = useOtherServerProjects(projectId);
  const ref = parseDocRef(targetId);
  const targetMenu =
    targetKind !== "menu"
      ? undefined
      : ref.namespace === null
        ? menus.find((m) => m.id === targetId)
        : others
            .filter((p) => projectNamespace(p) === ref.namespace)
            .flatMap((p) => menusOf(p).filter((m) => m.id === ref.id))[0];
  // Only PRIMITIVE inputs are caller-passed; sourceRef inputs are FETCHED by
  // the target menu itself (ContextBinder) — asking the caller to fill them
  // was a trap ("items: ?").
  const targetInputs = (targetMenu?.contextInputs ?? []).filter((i) => i.kind === "primitive");
  const ctxValues: Record<string, string> =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]))
      : {};
  const setCtxValue = (name: string, v: string) => {
    const next = { ...ctxValues };
    if (v === "") delete next[name];
    else next[name] = v;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  if (targetInputs.length === 0 && Object.keys(ctxValues).length === 0) {
    return <AddContextKey existing={new Set<string>()} onAdd={(k) => setCtxValue(k, `{${k}}`)} />;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {targetInputs.map((input) => (
        <div
          key={input.name}
          className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
        >
          <div className="mb-1 flex items-center gap-2 font-mono text-[11px]">
            <span className="text-[var(--brand)]">{input.name}</span>
            <span className="text-[var(--text-faint)]">
              : {input.kind === "primitive" ? input.type : "sourceRef"}
            </span>
          </div>
          <PlaceholderInput
            value={ctxValues[input.name] ?? ""}
            placeholder={t("actionEditor.placeholderOrLiteral", { tag: `{${input.name}}` })}
            onChange={(v) => setCtxValue(input.name, v)}
            entries={entries}
            className="h-7 px-2 py-0 font-mono text-xs"
          />
        </div>
      ))}
      {Object.keys(ctxValues)
        .filter((k) => !targetInputs.some((i) => i.name === k))
        .map((k) => (
          <div
            key={k}
            className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
          >
            <div className="mb-1 flex items-center gap-2 font-mono text-[11px]">
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
              onChange={(v) => setCtxValue(k, v)}
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
  );
}

/** Small "+ add a context key" row: type a key name, get an editable entry
 *  seeded with `{key}`. Needed for menus consuming undeclared args. */
function AddContextKey({
  existing,
  onAdd,
}: { existing: Set<string>; onAdd: (key: string) => void }) {
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
        className="rounded border border-[var(--border)] border-dashed px-2 py-1 text-[11px] text-[var(--text-mut)] hover:border-[var(--border-strong)] hover:text-[var(--text)] disabled:opacity-40"
      >
        {t("actionEditor.contextAdd")}
      </button>
    </div>
  );
}

/** Every declared command, sub-commands included, with the words players type to reach it. */
function flattenCommands(
  commands: DeclaredCommand[],
  prefix = "",
): { id: string; typed: string }[] {
  return commands.flatMap((c) => {
    const typed = prefix === "" ? `/${c.name}` : `${prefix} ${c.name}`;
    return [{ id: c.id, typed }, ...flattenCommands(c.children, typed)];
  });
}

/** The module command to run: picked among those the server's modules declare. */
function ModuleCommandInput(p: ArgInputProps) {
  const { field, value, onChange } = p;
  const { t } = useTranslation();
  const commands = useServerPlayerCommandsStore((s) => s.commands);
  const current = typeof value === "string" ? value : "";
  // Not loaded (no live server) or a value no module declares: the plain text, kept as is.
  if (commands.length === 0 || (current !== "" && !findDeclaredCommand(commands, current)))
    return <ExpressionInput {...p} placeholder="module:command" />;
  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
      className="select h-7 w-full py-0 pr-7 pl-2 font-mono text-xs"
      aria-label={field.name}
    >
      <option value="">{t("actionEditor.choose")}</option>
      {flattenCommands(commands).map((c) => (
        <option key={c.id} value={c.id}>
          {c.typed} ({c.id})
        </option>
      ))}
    </select>
  );
}

/**
 * The values a `module_command` hands to the module's code: one row per argument the command
 * declares. An empty row passes what the player typed for the argument of the same name,
 * which is why the command's own arguments must keep the module's names.
 */
function ModuleCommandArgsInput(p: ArgInputProps) {
  const { args, value, onChange } = p;
  const { t } = useTranslation();
  const entries = useActionEntries();
  const commands = useServerPlayerCommandsStore((s) => s.commands);
  const commandId = typeof args.command === "string" ? args.command : "";
  const declared = commandId === "" ? undefined : findDeclaredCommand(commands, commandId);
  if (!declared) {
    return (
      <div className="flex flex-col gap-1">
        <JsonValueInput value={value} onChange={onChange} ariaLabel={p.field.name} />
        <p className="text-[11px] text-[var(--text-faint)]">
          {t("actionEditor.moduleCommandUnknown")}
        </p>
      </div>
    );
  }
  const values: Record<string, string> =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, String(v)]))
      : {};
  const setValue = (name: string, v: string) => {
    const next = { ...values };
    if (v === "") delete next[name];
    else next[name] = v;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };
  if (declared.arguments.length === 0 && Object.keys(values).length === 0) {
    return (
      <p className="text-[11px] text-[var(--text-faint)]">
        {t("actionEditor.moduleCommandNoArgs")}
      </p>
    );
  }
  const undeclared = Object.keys(values).filter(
    (k) => !declared.arguments.some((a) => a.name === k),
  );
  return (
    <div className="flex flex-col gap-1.5">
      {declared.arguments.map((arg) => (
        <div
          key={arg.name}
          className="rounded border border-[var(--border-soft)] bg-[var(--surface-raised)] p-1.5"
        >
          <div className="mb-1 flex items-center gap-2 font-mono text-[11px]">
            <span className="text-[var(--brand)]">
              {arg.name}
              {arg.required ? " *" : ""}
            </span>
            <span className="text-[var(--text-faint)]">
              : {fileArgType(arg.type)}
              {arg.values.length > 0 ? ` (${arg.values.join(" | ")})` : ""}
            </span>
          </div>
          <PlaceholderInput
            value={values[arg.name] ?? ""}
            placeholder={t("actionEditor.moduleCommandTyped", { tag: `{${arg.name}}` })}
            onChange={(v) => setValue(arg.name, v)}
            entries={entries}
            className="h-7 px-2 py-0 font-mono text-xs"
          />
        </div>
      ))}
      {undeclared.map((k) => (
        <div
          key={k}
          className="rounded border border-[var(--warning)] bg-[var(--warning-soft)] p-1.5"
        >
          <div className="mb-1 flex items-center gap-2 font-mono text-[11px]">
            <span className="text-[var(--warning)]">{k}</span>
            <span className="text-[var(--warning)]">
              {t("actionEditor.moduleCommandUndeclared")}
            </span>
            <button
              type="button"
              title={t("actionEditor.contextRemoveKey")}
              onClick={() => setValue(k, "")}
              className="ml-auto flex h-5 w-5 items-center justify-center rounded text-[12px] text-[var(--text-faint)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              ×
            </button>
          </div>
          <PlaceholderInput
            value={values[k] ?? ""}
            onChange={(v) => setValue(k, v)}
            entries={entries}
            className="h-7 px-2 py-0 font-mono text-xs"
          />
        </div>
      ))}
    </div>
  );
}

import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip } from "@/components/ui/tooltip";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
import {
  type CompareOp,
  RECIPES,
  type Recipe,
  type RecipeInput,
  recipeVariables,
} from "@/lib/expr/recipes";
import { humanizePath } from "@/lib/expr/sampleRender";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import type { TFunction } from "i18next";
import { ArrowLeft, ChevronRight, Search, Variable } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

export interface PlaceholderLibraryProps {
  entries: PlaceholderEntry[];
  /** Writes `source` where the caret is. */
  onInsert: (source: string) => void;
  /** What a source gives for the example player, as MiniMessage. */
  preview: (source: string) => string;
}

const ORIGINS = ["context", "iteration", "pagination", "source"] as const;
const OPS: CompareOp[] = [">=", ">", "<", "<=", "=="];

/**
 * What can be written without knowing the syntax: the variables of the screen, inserted
 * as named pills, and expressions built from a sentence ("show a text if…") with a
 * live preview. Opens from the toolbar.
 */
export function PlaceholderLibrary({ entries, onInsert, preview }: PlaceholderLibraryProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const insert = (source: string) => {
    onInsert(source);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={t("mmEditor.library.hint")}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t("mmEditor.library.open")}
            className="btn btn-ghost btn-icon btn-sm"
          >
            <Variable className="size-4" />
          </button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        align="end"
        className="flex max-h-[min(32rem,70vh)] w-[26rem] flex-col p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Tabs defaultValue="variables" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="shrink-0 border-[var(--border-soft)] border-b p-2">
            <TabsTrigger value="variables">{t("mmEditor.library.variables")}</TabsTrigger>
            <TabsTrigger value="recipes">{t("mmEditor.library.recipes")}</TabsTrigger>
          </TabsList>
          <TabsContent value="variables" className="min-h-0 flex-1 overflow-y-auto">
            <Variables entries={entries} onPick={(path) => insert(`{${path}}`)} />
          </TabsContent>
          <TabsContent value="recipes" className="min-h-0 flex-1 overflow-y-auto">
            <Recipes entries={entries} onInsert={insert} preview={preview} />
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}

function Variables({
  entries,
  onPick,
}: { entries: PlaceholderEntry[]; onPick: (path: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const unique = [...new Map(entries.map((e) => [e.path, e])).values()];
    return q
      ? unique.filter(
          (e) => e.path.toLowerCase().includes(q) || nameOf(e.path, t).toLowerCase().includes(q),
        )
      : unique;
  }, [entries, query, t]);
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="relative">
        <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-[var(--text-faint)]" />
        <Input
          // biome-ignore lint/a11y/noAutofocus: the search is what the tab is opened for
          autoFocus
          aria-label={t("mmEditor.library.search")}
          placeholder={t("mmEditor.library.search")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 pl-8 text-xs"
        />
      </div>
      {ORIGINS.map((origin) => {
        const group = visible.filter((e) => e.origin === origin);
        if (group.length === 0) return null;
        return (
          <section key={origin} className="flex flex-col gap-1">
            <h3 className="eyebrow px-1">{t(`itemContext.${origin}`)}</h3>
            <ul className="flex flex-col">
              {group.map((e) => (
                <li key={e.path}>
                  <button
                    type="button"
                    onClick={() => onPick(e.path)}
                    className="group flex w-full items-center gap-3 rounded-[var(--r-sm)] px-2 py-1.5 text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none"
                  >
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate font-medium text-[12.5px]">
                        {nameOf(e.path, t)}
                      </span>
                      <code className="truncate text-[11px] text-[var(--text-faint)]">
                        {`{${e.path}}`}
                      </code>
                    </span>
                    <span className="max-w-[45%] shrink-0 truncate text-right text-[11.5px] text-[var(--text-mut)]">
                      {sampleLabel(e, t)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {visible.length === 0 && (
        <p className="px-1 text-[12px] text-[var(--text-mut)]">{t("mmEditor.library.empty")}</p>
      )}
    </div>
  );
}

/** A variable's name in words; a method path says what it computes ("Time since Joined"). */
function nameOf(path: string, t: TFunction): string {
  const m = path.match(/^(.+)\.(\w+)\(\)$/);
  if (!m) return humanizePath(path);
  const verb = t(`mmEditor.expr.methods.${m[2]}`, { defaultValue: "" });
  return verb
    ? `${verb[0]!.toUpperCase()}${verb.slice(1)} ${humanizePath(m[1]!)}`
    : humanizePath(path);
}

function sampleLabel(e: PlaceholderEntry, t: (key: string) => string): string {
  if (e.type === "boolean" && (e.sample === "true" || e.sample === "false"))
    return t(e.sample === "true" ? "mmEditor.expr.yes" : "mmEditor.expr.no");
  return e.sample ? (e.sample.split("\n")[0] ?? "") : t(`itemContext.types.${e.type}`);
}

function Recipes({
  entries,
  onInsert,
  preview,
}: {
  entries: PlaceholderEntry[];
  onInsert: (source: string) => void;
  preview: (source: string) => string;
}) {
  const { t } = useTranslation();
  const [picked, setPicked] = useState<Recipe | null>(null);
  if (picked) {
    return (
      <RecipeForm
        recipe={picked}
        variables={recipeVariables(picked, entries)}
        onBack={() => setPicked(null)}
        onInsert={onInsert}
        preview={preview}
      />
    );
  }
  return (
    <ul className="flex flex-col p-2">
      {RECIPES.map((recipe) => {
        return (
          <li key={recipe.id}>
            <button
              type="button"
              onClick={() => setPicked(recipe)}
              className="flex w-full items-center gap-3 rounded-[var(--r-sm)] px-2.5 py-2 text-left hover:bg-[var(--surface-hover)] focus-visible:bg-[var(--surface-hover)] focus-visible:outline-none"
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium text-[12.5px]">
                  {t(`mmEditor.library.recipe.${recipe.id}.name`)}
                </span>
                <span className="text-[11.5px] text-[var(--text-mut)]">
                  {t(`mmEditor.library.recipe.${recipe.id}.desc`)}
                </span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-[var(--text-faint)]" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A recipe's form: new from the library, or opened again on a rule of the text. */
export function RecipeForm({
  recipe,
  variables,
  onBack,
  onInsert,
  preview,
  initial,
  submitLabel,
}: {
  recipe: Recipe;
  variables: PlaceholderEntry[];
  onBack: () => void;
  onInsert: (source: string) => void;
  preview: (source: string) => string;
  /** What the rule being changed was built with. */
  initial?: RecipeInput;
  submitLabel?: string;
}) {
  const { t } = useTranslation();
  const takesDate = recipe.id === "timeAgo" || recipe.id === "timeLeft";
  const [mode, setMode] = useState<VariableMode>(() =>
    initialMode(initial?.path, variables, takesDate),
  );
  const [input, setInput] = useState<RecipeInput>({
    path: variables[0]?.path ?? (takesDate ? String(startOfToday()) : ""),
    op: ">=",
    value: 1,
    separator: ", ",
    text: "",
    otherwise: "",
    ...initial,
  });
  const set = (patch: Partial<RecipeInput>) => setInput((prev) => ({ ...prev, ...patch }));
  const source = recipe.build(input);
  const shown = preview(source);
  const has = (f: Recipe["fields"][number]) => recipe.fields.includes(f);
  const textField = (key: "text" | "otherwise", label: string) => (
    // biome-ignore lint/a11y/noLabelWithoutControl: Input renders an <input>
    <label className="flex flex-col gap-1">
      <span className="field-label">{label}</span>
      <Input
        className="h-8 font-mono text-xs"
        value={input[key] ?? ""}
        placeholder={t("mmEditor.library.textPlaceholder")}
        onChange={(e) => set({ [key]: e.target.value })}
      />
    </label>
  );
  return (
    <div className="flex flex-col gap-3 p-3">
      <button
        type="button"
        onClick={onBack}
        className="btn btn-ghost btn-sm self-start gap-1 px-1.5 text-[var(--text-mut)]"
      >
        <ArrowLeft className="size-3.5" />
        {t(`mmEditor.library.recipe.${recipe.id}.name`)}
      </button>
      <div className="flex flex-col gap-1.5">
        <label className="flex flex-col gap-1">
          <span className="field-label">{t("mmEditor.library.variable")}</span>
          <select
            className="input h-auto py-1.5 text-xs"
            value={mode === "list" ? input.path : mode}
            onChange={(e) => {
              const v = e.target.value;
              if (v === "custom") {
                setMode("custom");
                set({ path: "" });
              } else if (v === "date") {
                setMode("date");
                set({ path: String(startOfToday()) });
              } else {
                setMode("list");
                set({ path: v });
              }
            }}
          >
            {variables.map((v) => (
              <option key={v.path} value={v.path}>
                {humanizePath(v.path)} — {`{${v.path}}`}
              </option>
            ))}
            {takesDate && <option value="date">{t("mmEditor.library.fixedDate")}</option>}
            <option value="custom">{t("mmEditor.library.customVariable")}</option>
          </select>
        </label>
        {mode === "custom" && (
          <Input
            aria-label={t("mmEditor.library.customVariable")}
            className="h-8 font-mono text-xs"
            value={input.path}
            placeholder={t("mmEditor.library.customVariablePlaceholder")}
            // Identifiers are lowercase in the expression language.
            onChange={(e) => set({ path: e.target.value.replace(/[{}\s]/g, "").toLowerCase() })}
          />
        )}
        {mode === "date" && (
          <Input
            type="datetime-local"
            aria-label={t("mmEditor.library.date")}
            className="h-8 text-xs"
            value={toLocalInput(Number(input.path))}
            onChange={(e) => {
              const at = new Date(e.target.value).getTime();
              if (Number.isFinite(at)) set({ path: String(at) });
            }}
          />
        )}
      </div>
      {has("negate") && (
        // biome-ignore lint/a11y/noLabelWithoutControl: the switch is a button inside
        <label className="flex items-center gap-2 text-[12.5px]">
          <Switch checked={!!input.negate} onCheckedChange={(v) => set({ negate: v })} />
          {t("mmEditor.library.negate")}
        </label>
      )}
      {has("compare") && (
        <div className="flex items-end gap-2">
          <label className="flex flex-1 flex-col gap-1">
            <span className="field-label">{t("mmEditor.library.when")}</span>
            <select
              className="input h-auto py-1.5 text-xs"
              value={input.op}
              onChange={(e) => set({ op: e.target.value as CompareOp })}
            >
              {OPS.map((op) => (
                <option key={op} value={op}>
                  {t(`mmEditor.library.ops.${OP_KEYS[op]}`)}
                </option>
              ))}
            </select>
          </label>
          <Input
            type="number"
            aria-label={t("mmEditor.library.number")}
            className="h-8 w-24 text-xs"
            value={String(input.value ?? 0)}
            onChange={(e) => set({ value: Number(e.target.value) })}
          />
        </div>
      )}
      {has("text") &&
        textField(
          "text",
          t(
            recipe.id === "showIf"
              ? "mmEditor.library.textShown"
              : recipe.id === "byNumber"
                ? "mmEditor.library.textWhen"
                : "mmEditor.library.textYes",
          ),
        )}
      {has("otherwise") &&
        textField(
          "otherwise",
          t(recipe.id === "byNumber" ? "mmEditor.library.textElse" : "mmEditor.library.textNo"),
        )}
      {has("separator") && (
        <label className="flex flex-col gap-1">
          <span className="field-label">{t("mmEditor.library.separator")}</span>
          <select
            className="input h-auto py-1.5 text-xs"
            value={input.separator}
            onChange={(e) => set({ separator: e.target.value })}
          >
            <option value=", ">{t("mmEditor.library.separators.comma")}</option>
            <option value=" · ">{t("mmEditor.library.separators.dot")}</option>
            <option value={"\n"}>{t("mmEditor.library.separators.line")}</option>
          </select>
        </label>
      )}
      <div className="flex flex-col gap-1">
        <span className="field-label">{t("mmEditor.library.preview")}</span>
        <div
          className={cx(
            "min-h-8 whitespace-pre-wrap rounded-[var(--r-sm)] bg-[var(--mc-tooltip-bg)] px-2.5 py-1.5 font-mono text-[12.5px]",
            shown === "" && "text-[var(--text-faint)] italic",
          )}
        >
          {shown === "" ? t("mmEditor.library.previewEmpty") : <MiniMessageInline source={shown} />}
        </div>
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm self-end"
        disabled={!PATH.test(input.path)}
        onClick={() => onInsert(source)}
      >
        {submitLabel ?? t("mmEditor.library.insert")}
      </button>
    </div>
  );
}

const OP_KEYS: Record<CompareOp, string> = {
  ">=": "gte",
  ">": "gt",
  "<": "lt",
  "<=": "lte",
  "==": "eq",
};

/** Where the recipe reads from: a listed variable, one typed by hand, or a fixed date. */
type VariableMode = "list" | "custom" | "date";

/** A variable path (`guild.created_at`) or, for a fixed date, its epoch millis. */
const PATH = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)*$|^\d+$/;

function initialMode(
  path: string | undefined,
  variables: PlaceholderEntry[],
  takesDate: boolean,
): VariableMode {
  if (path === undefined) return variables.length > 0 ? "list" : takesDate ? "date" : "custom";
  if (takesDate && /^\d+$/.test(path)) return "date";
  return variables.some((v) => v.path === path) ? "list" : "custom";
}

function startOfToday(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Epoch millis as a `datetime-local` value, in the browser's time zone. */
function toLocalInput(at: number): string {
  if (!Number.isFinite(at)) return "";
  const d = new Date(at);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

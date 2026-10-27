import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
import { toBoolean } from "@/lib/expr/coercion";
import { evaluate } from "@/lib/expr/evaluator";
import {
  type Case,
  type Cond,
  type Part,
  type Value,
  quoteText,
  readExpression,
} from "@/lib/expr/readable";
import { matchRecipe, recipeVariables } from "@/lib/expr/recipes";
import { humanizePath } from "@/lib/expr/sampleRender";
import type { Scope } from "@/lib/expr/scope";
import { splitIntoLines } from "@/lib/expr/splitLines";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { Pencil, Rows3, Settings2 } from "lucide-react";
import { type ReactNode, createContext, useContext, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { RecipeForm } from "./PlaceholderLibrary";

export interface ExpressionRulesProps {
  /** The expression, braces included. */
  source: string;
  /** `value`: a plain placeholder, shown as its name. `logic`: a computed text, read as rules. */
  kind: "value" | "logic";
  /** The example player's values: their case is lit. */
  scope: Scope;
  /** The text's colour in game when it sets none (the profile's). */
  color?: string;
  /** Replaces the string literal at `at` (offsets in `source`) with `literal`. */
  onReplace: (at: { from: number; to: number }, literal: string) => void;
  /** Called once drawn, its size possibly changed. */
  onDrawn?: () => void;
  /** Replaces the whole `{…}` (a rule changed in its form, or split into lines). */
  onSwap?: (source: string) => void;
  /** The text holds several lines: a glued `{…}` can be split into one rule per line. */
  multiline?: boolean;
  /** The variables a rule's form offers. */
  entries?: PlaceholderEntry[];
  /** What a source gives for the example player, for a form's preview. */
  preview?: (source: string) => string;
}

interface Ctx {
  scope: Scope;
  color?: string;
  onText: (at: { from: number; to: number }, text: string) => void;
}

const CardCtx = createContext<Ctx | null>(null);
const useCard = () => useContext(CardCtx)!;

/**
 * A `{…}` of the rich view, read rather than computed: a placeholder is its name
 * ("Rank"); a computed text is its rules, "if Online → En ligne, otherwise → Hors
 * ligne", the case the example player falls in lit. Texts are edited in place; the
 * rest is changed in the Code view.
 */
export function ExpressionRules({
  source,
  kind,
  scope,
  color,
  onReplace,
  onDrawn,
  onSwap,
  multiline,
  entries = [],
  preview = (src) => src,
}: ExpressionRulesProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  useEffect(() => onDrawn?.());
  const inner = source.slice(1, -1);
  const read = readExpression(inner);
  // A string's offsets are inside the braces.
  const onText: Ctx["onText"] = (at, text) => {
    const quote = inner[at.from];
    onReplace({ from: at.from + 1, to: at.to + 1 }, quoteText(text, quote));
  };
  const ctx = { scope, color, onText };
  if (kind === "value") {
    const only = read.ok && read.parts.length === 1 ? read.parts[0] : undefined;
    return (
      <CardCtx.Provider value={ctx}>
        {only?.kind === "value" ? (
          <ValueView value={only.value} />
        ) : (
          <Chip title={source}>{source}</Chip>
        )}
      </CardCtx.Provider>
    );
  }
  if (!read.ok) {
    return (
      <span className="text-[var(--warning)]" title={read.error}>
        {t("mmEditor.expr.invalid", { error: read.error })}
      </span>
    );
  }
  const recipe = onSwap ? matchRecipe(inner) : null;
  const lines = onSwap && multiline ? splitIntoLines(inner) : null;
  if (editing && recipe && onSwap) {
    const variables = recipeVariables(recipe.recipe, entries);
    // The rule's own variable stays offered, known to the catalog or not.
    if (!variables.some((v) => v.path === recipe.input.path))
      variables.unshift({
        path: recipe.input.path,
        type: "boolean",
        sample: null,
        origin: "context",
      });
    return (
      <RecipeForm
        recipe={recipe.recipe}
        variables={variables}
        initial={recipe.input}
        preview={preview}
        submitLabel={t("mmEditor.expr.apply")}
        onBack={() => setEditing(false)}
        onInsert={(next) => {
          setEditing(false);
          onSwap(next);
        }}
      />
    );
  }
  return (
    <CardCtx.Provider value={ctx}>
      {(recipe || lines) && (
        <div className="-mt-1 -mr-1 mb-1 flex justify-end gap-1">
          {lines && (
            <button
              type="button"
              className="btn btn-ghost btn-sm h-6 gap-1 px-1.5 text-[11.5px]"
              title={t("mmEditor.expr.splitHint")}
              onClick={() => onSwap?.(lines.join("\n"))}
            >
              <Rows3 className="size-3.5" />
              {t("mmEditor.expr.split")}
            </button>
          )}
          {recipe && (
            <button
              type="button"
              className="btn btn-ghost btn-sm h-6 gap-1 px-1.5 text-[11.5px]"
              onClick={() => setEditing(true)}
            >
              <Settings2 className="size-3.5" />
              {t("mmEditor.expr.edit")}
            </button>
          )}
        </div>
      )}
      <ul aria-label={t("mmEditor.expr.title")} className="flex flex-col gap-1">
        {read.parts.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity but their order
          <li key={i}>
            {p.kind === "choice" ? (
              <Choice cases={p.cases} otherwise={p.otherwise} />
            ) : (
              <Line keyword={t("mmEditor.expr.always")}>
                <Action parts={[p]} />
              </Line>
            )}
          </li>
        ))}
      </ul>
    </CardCtx.Provider>
  );
}

/** One "if … → …" line per case, then "otherwise → …"; the example player's case lit. */
function Choice({ cases, otherwise }: { cases: Case[]; otherwise: Part[] }) {
  const { t } = useTranslation();
  const { scope } = useCard();
  const hit = cases.findIndex((c) => truthy(c.test, scope));
  return (
    <div className="flex flex-col gap-1">
      {cases.map((c, i) => (
        <Line
          // biome-ignore lint/suspicious/noArrayIndexKey: cases have no identity but their order
          key={i}
          keyword={i === 0 ? t("mmEditor.expr.if") : t("mmEditor.expr.elseIf")}
          active={i === hit}
          condition={<CondView cond={c.when} />}
        >
          <Action parts={c.show} />
        </Line>
      ))}
      {/* "Otherwise nothing" goes without saying. */}
      {otherwise.length > 0 && (
        <Line keyword={t("mmEditor.expr.otherwise")} active={hit === -1}>
          <Action parts={otherwise} />
        </Line>
      )}
    </div>
  );
}

function Line({
  keyword,
  condition,
  active = true,
  children,
}: { keyword: string; condition?: ReactNode; active?: boolean; children: ReactNode }) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-baseline gap-x-2 gap-y-1 transition-opacity",
        !active && "opacity-45",
      )}
    >
      <span className="font-semibold text-[12.5px] text-[var(--fam-logic)]">{keyword}</span>
      {condition}
      <span className="text-[var(--text-faint)]">→</span>
      {children}
    </div>
  );
}

/** What a branch shows, said plainly: a text, "new line: …", "a blank line", "nothing". */
function Action({ parts }: { parts: Part[] }) {
  const { t } = useTranslation();
  if (parts.length === 0) {
    return <span className="text-[var(--text-faint)] italic">{t("mmEditor.expr.nothing")}</span>;
  }
  return (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-1.5">
      {parts.map((p, i) =>
        p.kind === "text" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity but their order
          <TextPart key={i} text={p.text} at={p.at} />
        ) : p.kind === "value" ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity but their order
          <ValueView key={i} value={p.value} />
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity but their order
          <Choice key={i} cases={p.cases} otherwise={p.otherwise} />
        ),
      )}
    </span>
  );
}

const LEADING_BREAKS = /^(?:<newline>|<br\/?>|\n)+/i;

/** A text of the expression: line breaks it opens with said in words, the rest as in game. */
function TextPart({ text, at }: { text: string; at: { from: number; to: number } }) {
  const { t } = useTranslation();
  const { color, onText } = useCard();
  // The input keeps its own text while typed: the source catches up a moment later.
  const [draft, setDraft] = useState<string | null>(null);
  const lead = text.match(LEADING_BREAKS)?.[0] ?? "";
  const breaks = lead.match(/<newline>|<br\/?>|\n/gi)?.length ?? 0;
  const rest = text.slice(lead.length);
  const breakWord =
    breaks === 0 ? null : (
      <span className="text-[12px] text-[var(--text-mut)]">
        {rest === ""
          ? t("mmEditor.expr.blankLines", { count: breaks })
          : t("mmEditor.expr.onNewLine")}
      </span>
    );
  if (rest === "") return breakWord;
  if (draft !== null) {
    return (
      <>
        {breakWord}
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by the user's click on the text
          autoFocus
          className="input h-7 min-w-48 flex-1 font-mono text-[12px]"
          aria-label={t("mmEditor.expr.editText")}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onText(at, lead + e.target.value);
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") setDraft(null);
          }}
        />
      </>
    );
  }
  return (
    <>
      {breakWord}
      <button
        type="button"
        title={t("mmEditor.expr.editText")}
        onClick={() => setDraft(rest)}
        style={{ color }}
        className="group inline-flex max-w-full items-baseline gap-1.5 rounded-[4px] bg-[var(--mc-tooltip-bg)] px-1.5 py-0.5 text-left font-mono text-[12.5px] hover:outline hover:outline-1 hover:outline-[var(--border-strong)]"
      >
        <MiniMessageInline source={rest} />
        <Pencil size={11} className="shrink-0 opacity-40 group-hover:opacity-100" />
      </button>
    </>
  );
}

function CondView({ cond }: { cond: Cond }) {
  const { t } = useTranslation();
  switch (cond.kind) {
    case "is":
      return <ValueView value={cond.value} />;
    case "not":
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <Word>{t("mmEditor.expr.not")}</Word>
          <CondView cond={cond.cond} />
        </span>
      );
    case "all":
    case "any":
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          {cond.conds.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: conditions have no identity but their order
            <span key={i} className="inline-flex items-baseline gap-1.5">
              {i > 0 && <Word>{t(`mmEditor.expr.${cond.kind === "all" ? "and" : "or"}`)}</Word>}
              <CondView cond={c} />
            </span>
          ))}
        </span>
      );
    case "compare": {
      const empty = cond.right.kind === "text" && cond.right.text === "";
      if (empty && (cond.op === "==" || cond.op === "!=")) {
        return (
          <span className="inline-flex flex-wrap items-baseline gap-1.5">
            <ValueView value={cond.left} />
            <Word>{t(`mmEditor.expr.${cond.op === "==" ? "isEmpty" : "isNotEmpty"}`)}</Word>
          </span>
        );
      }
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <ValueView value={cond.left} />
          <Word>{t(`mmEditor.expr.ops.${OP_KEYS[cond.op]}`)}</Word>
          <ValueView value={cond.right} />
        </span>
      );
    }
  }
}

const OP_KEYS = { "==": "eq", "!=": "neq", "<": "lt", "<=": "lte", ">": "gt", ">=": "gte" };

const KNOWN_METHODS = [
  "ago",
  "until",
  "duration",
  "length",
  "join",
  "first",
  "last",
  "at",
  "contains",
  "pluck",
];

function ValueView({ value }: { value: Value }) {
  const { t } = useTranslation();
  switch (value.kind) {
    case "var":
      return <Chip title={value.path}>{humanizePath(value.path)}</Chip>;
    case "papi":
      return <Chip title={`%${value.name}%`}>{humanizePath(value.name)}</Chip>;
    case "text":
      return <span className="font-mono text-[12px]">« {value.text} »</span>;
    case "literal":
      return (
        <span className="font-mono text-[12px]">
          {value.value === true
            ? t("mmEditor.expr.yes")
            : value.value === false
              ? t("mmEditor.expr.no")
              : value.value === null
                ? t("mmEditor.expr.empty")
                : String(value.value)}
        </span>
      );
    case "math":
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <ValueView value={value.left} />
          <Word>{value.op === "+" ? "+" : "−"}</Word>
          <ValueView value={value.right} />
        </span>
      );
    case "cond":
      return <CondView cond={value.cond} />;
    case "choice":
      return <Choice cases={value.cases} otherwise={value.otherwise} />;
    case "method": {
      const target = <ValueView value={value.target} />;
      if (!KNOWN_METHODS.includes(value.method)) {
        return (
          <span className="inline-flex items-baseline gap-1">
            {target}
            <span className="font-mono text-[12px]">.{value.method}(…)</span>
          </span>
        );
      }
      const arg = value.args[0] ? <ValueView value={value.args[0]} /> : null;
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <Word>{t(`mmEditor.expr.methods.${value.method}`)}</Word>
          {target}
          {arg && (
            <>
              <Word>{t(`mmEditor.expr.methodArgs.${value.method}`, { defaultValue: "" })}</Word>
              {arg}
            </>
          )}
        </span>
      );
    }
  }
}

function Chip({ title, children }: { title: string; children: ReactNode }) {
  return (
    <span
      title={title}
      className="inline-flex items-baseline gap-1 rounded-[4px] bg-[var(--surface-raised-2)] px-1.5 font-medium text-[12.5px]"
    >
      {children}
    </span>
  );
}

function Word({ children }: { children: ReactNode }) {
  return <span className="text-[12px] text-[var(--text-mut)]">{children}</span>;
}

function truthy(test: Case["test"], scope: Scope): boolean {
  try {
    return toBoolean(evaluate(test, scope));
  } catch {
    return false;
  }
}

import { Switch } from "@/components/ui/switch";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { cx } from "@/lib/cx";
import { toBoolean } from "@/lib/expr/coercion";
import { evaluate } from "@/lib/expr/evaluator";
import { parse } from "@/lib/expr/parser";
import {
  type Case,
  type Cond,
  type Part,
  type Value,
  quoteText,
  readExpression,
  switchablePaths,
} from "@/lib/expr/readable";
import { humanizePath } from "@/lib/expr/sampleRender";
import type { Scope } from "@/lib/expr/scope";
import { templateSpans } from "@/lib/expr/template/tokenizer";
import { Code2, Pencil, X } from "lucide-react";
import { type ReactNode, createContext, useContext, useState } from "react";
import { useTranslation } from "react-i18next";

export interface ExpressionCardProps {
  /** The whole MiniMessage text. */
  value: string;
  /** Where the expression's `{` is in `value`. */
  from: number;
  onChange: (value: string) => void;
  /** The example player's values, switches applied. */
  scope: Scope;
  /** Value of each switch the user flipped, by path. */
  overrides: Record<string, boolean>;
  onOverride: (path: string, value: boolean) => void;
  onShowCode: () => void;
  onClose: () => void;
  /** The text's colour in game when it sets none (the profile's). */
  textColor?: string;
}

interface Ctx {
  scope: Scope;
  color?: string;
  onText: (at: { from: number; to: number }, text: string) => void;
}

const CardCtx = createContext<Ctx | null>(null);
const useCard = () => useContext(CardCtx)!;

/**
 * A computed text read as sentences: "if Online → En ligne, otherwise → Hors ligne",
 * the case the example player falls in lit, the others faded. Texts are edited in
 * place; the rest is read here and changed in the Code view.
 */
export function ExpressionCard({
  value,
  from,
  onChange,
  scope,
  overrides,
  onOverride,
  onShowCode,
  onClose,
  textColor,
}: ExpressionCardProps) {
  const { t } = useTranslation();
  const span = templateSpans(value).find((s) => s.from === from);
  if (!span) return null;
  const source = value.slice(span.from + 1, span.to - 1);
  const read = readExpression(source);
  // A string's offsets are inside the braces.
  const base = span.from + 1;
  const onText: Ctx["onText"] = (at, text) => {
    const quote = value[base + at.from];
    onChange(value.slice(0, base + at.from) + quoteText(text, quote) + value.slice(base + at.to));
  };
  const switches = read.ok ? switchablePaths(read.parts) : [];

  return (
    <section
      aria-label={t("mmEditor.expr.title")}
      className="flex flex-col gap-3 border-[var(--fam-logic-line)] border-t bg-[var(--surface-raised)] px-3 py-3 text-[13px] text-[var(--text)]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="font-semibold">{t("mmEditor.expr.title")}</span>
          <span className="text-[12px] text-[var(--text-mut)]">{t("mmEditor.expr.intro")}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" className="btn btn-ghost btn-sm" onClick={onShowCode}>
            <Code2 size={14} />
            {t("mmEditor.expr.showCode")}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            aria-label={t("mmEditor.expr.close")}
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {switches.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-[var(--r-sm)] bg-[var(--surface-inset)] px-2.5 py-2">
          <span className="text-[12px] text-[var(--text-mut)]">{t("mmEditor.expr.simulate")}</span>
          {switches.map((path) => (
            // biome-ignore lint/a11y/noLabelWithoutControl: the switch is a button inside
            <label key={path} className="flex items-center gap-1.5 text-[12.5px]" title={path}>
              <Switch
                checked={overrides[path] ?? sample(path, scope) === true}
                onCheckedChange={(v) => onOverride(path, v)}
              />
              {humanizePath(path)}
            </label>
          ))}
        </div>
      )}

      {read.ok ? (
        <CardCtx.Provider value={{ scope, color: textColor, onText }}>
          <ul className="flex flex-col divide-y divide-[var(--border-soft)]">
            {read.parts.map((p, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity but their order
              <li key={i} className="py-2 first:pt-0 last:pb-0">
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
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-[var(--warning)]">
            {t("mmEditor.expr.invalid", { error: read.error })}
          </span>
          <code className="break-all font-mono text-[12px] text-[var(--text-mut)]">{source}</code>
        </div>
      )}
    </section>
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
  const [editing, setEditing] = useState(false);
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
  if (editing) {
    return (
      <>
        {breakWord}
        <input
          // biome-ignore lint/a11y/noAutofocus: opened by the user's click on the text
          autoFocus
          className="input h-7 min-w-48 flex-1 font-mono text-[12px]"
          aria-label={t("mmEditor.expr.editText")}
          value={rest}
          onChange={(e) => onText(at, lead + e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === "Escape") setEditing(false);
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
        onClick={() => setEditing(true)}
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
      return <ValueView value={cond.value} asCondition />;
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

function ValueView({ value, asCondition }: { value: Value; asCondition?: boolean }) {
  const { t } = useTranslation();
  const { scope } = useCard();
  switch (value.kind) {
    case "var":
      return (
        <VarChip path={value.path} sample={asCondition ? undefined : sample(value.path, scope)} />
      );
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

function VarChip({ path, sample: value }: { path: string; sample?: unknown }) {
  const shown =
    value === undefined || value === null || typeof value === "object" || typeof value === "boolean"
      ? ""
      : String(value);
  return (
    <Chip title={path}>
      {humanizePath(path)}
      {shown && <span className="text-[11px] text-[var(--text-faint)]">({shown})</span>}
    </Chip>
  );
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

function sample(path: string, scope: Scope): unknown {
  try {
    return evaluate(parse(path), scope);
  } catch {
    return undefined;
  }
}

function truthy(test: Case["test"], scope: Scope): boolean {
  try {
    return toBoolean(evaluate(test, scope));
  } catch {
    return false;
  }
}

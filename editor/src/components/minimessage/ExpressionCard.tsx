import { Switch } from "@/components/ui/switch";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import { evaluate } from "@/lib/expr/evaluator";
import { parse } from "@/lib/expr/parser";
import {
  type Cond,
  type Part,
  type Value,
  quoteText,
  readExpression,
  switchablePaths,
} from "@/lib/expr/readable";
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

/**
 * An expression of the text read as rules: "if … show … otherwise …". Texts are edited
 * in place; the rest is read here and changed in the Code view.
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
  const replace = (at: { from: number; to: number }, text: string) => {
    const quote = value[base + at.from];
    onChange(value.slice(0, base + at.from) + quoteText(text, quote) + value.slice(base + at.to));
  };
  const switches = read.ok ? switchablePaths(read.parts) : [];

  return (
    <section
      aria-label={t("mmEditor.expr.title")}
      className="flex flex-col gap-3 border-[var(--fam-logic-line)] border-t bg-[var(--surface-raised)] px-3 py-3 text-[13px] text-[var(--text)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="font-semibold">{t("mmEditor.expr.title")}</span>
          <span className="text-[12px] text-[var(--text-mut)]">{t("mmEditor.expr.intro")}</span>
        </div>
        <div className="flex items-center gap-1">
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
        <div className="flex flex-col gap-1.5">
          <span className="field-label">{t("mmEditor.expr.simulate")}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {switches.map((path) => {
              const checked = overrides[path] ?? sample(path, scope) === true;
              return (
                // biome-ignore lint/a11y/noLabelWithoutControl: the switch is a button inside
                <label key={path} className="flex items-center gap-1.5 text-[12px]">
                  <Switch checked={checked} onCheckedChange={(v) => onOverride(path, v)} />
                  <VarChip path={path} />
                </label>
              );
            })}
          </div>
        </div>
      )}

      {read.ok ? (
        <TextColor.Provider value={textColor}>
          <Parts parts={read.parts} scope={scope} onText={replace} top />
        </TextColor.Provider>
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

const TextColor = createContext<string | undefined>(undefined);

type OnText = (at: { from: number; to: number }, text: string) => void;

function Parts({
  parts,
  scope,
  onText,
  top,
}: { parts: Part[]; scope: Scope; onText: OnText; top?: boolean }) {
  const { t } = useTranslation();
  if (parts.length === 0) {
    return <span className="text-[var(--text-faint)] italic">{t("mmEditor.expr.nothing")}</span>;
  }
  if (!top) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-1.5">
        {parts.map((p, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity but their order
          <PartView key={i} part={p} scope={scope} onText={onText} />
        ))}
      </span>
    );
  }
  return (
    <ol className="flex flex-col gap-2">
      {parts.map((p, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: parts have no identity but their order
          key={i}
          className="flex gap-2 rounded-[var(--r-sm)] border border-[var(--border-soft)] bg-[var(--surface-inset)] px-2.5 py-2"
        >
          <span className="pt-0.5 font-mono text-[11px] text-[var(--text-faint)]">{i + 1}</span>
          <div className="min-w-0 flex-1">
            {p.kind === "choice" ? (
              <PartView part={p} scope={scope} onText={onText} />
            ) : (
              <Rule keyword={t("mmEditor.expr.always")}>
                <PartView part={p} scope={scope} onText={onText} />
              </Rule>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Rule({ keyword, children }: { keyword: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-baseline gap-x-2">
      <span className="font-semibold text-[11px] text-[var(--fam-logic)] uppercase tracking-wide">
        {keyword}
      </span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PartView({ part, scope, onText }: { part: Part; scope: Scope; onText: OnText }) {
  const { t } = useTranslation();
  switch (part.kind) {
    case "text":
      return <TextPart text={part.text} onChange={(text) => onText(part.at, text)} />;
    case "value":
      return <ValueView value={part.value} scope={scope} />;
    case "choice":
      return (
        <div className="flex flex-col gap-1">
          {part.cases.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: cases have no identity but their order
            <div key={i} className="flex flex-col gap-1">
              <Rule keyword={i === 0 ? t("mmEditor.expr.if") : t("mmEditor.expr.elseIf")}>
                <CondView cond={c.when} scope={scope} />
              </Rule>
              <Rule keyword={t("mmEditor.expr.show")}>
                <Parts parts={c.show} scope={scope} onText={onText} />
              </Rule>
            </div>
          ))}
          {part.otherwise.length > 0 && (
            <Rule keyword={t("mmEditor.expr.otherwise")}>
              <Parts parts={part.otherwise} scope={scope} onText={onText} />
            </Rule>
          )}
        </div>
      );
  }
}

/** A text of the expression: shown as in game, edited as MiniMessage. */
function TextPart({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const color = useContext(TextColor);
  const shown = text.replace(/\n/g, "<newline>");
  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by the user's click on the text
        autoFocus
        className="input h-7 w-full font-mono text-[12px]"
        aria-label={t("mmEditor.expr.editText")}
        value={text}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setEditing(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "Escape") setEditing(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      title={t("mmEditor.expr.editText")}
      onClick={() => setEditing(true)}
      style={{ color }}
      className="group inline-flex max-w-full items-baseline gap-1.5 rounded-[4px] bg-[var(--mc-tooltip-bg)] px-1.5 py-0.5 text-left font-mono text-[12.5px] hover:outline hover:outline-1 hover:outline-[var(--border-strong)]"
    >
      <MiniMessageInline source={newlinesShown(shown, t("mmEditor.expr.newline"))} />
      <Pencil size={11} className="shrink-0 opacity-40 group-hover:opacity-100" />
    </button>
  );
}

/** `<newline>` drawn as a visible mark: a line break inside a pill reads as nothing. */
const newlinesShown = (mm: string, label: string) =>
  mm.replace(/<(newline|br)>/g, `<gray>↵ ${label}</gray> `);

function CondView({ cond, scope }: { cond: Cond; scope: Scope }) {
  const { t } = useTranslation();
  switch (cond.kind) {
    case "is":
      return <ValueView value={cond.value} scope={scope} />;
    case "not":
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <Word>{t("mmEditor.expr.not")}</Word>
          <CondView cond={cond.cond} scope={scope} />
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
              <CondView cond={c} scope={scope} />
            </span>
          ))}
        </span>
      );
    case "compare": {
      const empty = cond.right.kind === "text" && cond.right.text === "";
      if (empty && (cond.op === "==" || cond.op === "!=")) {
        return (
          <span className="inline-flex flex-wrap items-baseline gap-1.5">
            <ValueView value={cond.left} scope={scope} />
            <Word>{t(`mmEditor.expr.${cond.op === "==" ? "isEmpty" : "isNotEmpty"}`)}</Word>
          </span>
        );
      }
      return (
        <span className="inline-flex flex-wrap items-baseline gap-1.5">
          <ValueView value={cond.left} scope={scope} />
          <Word>{t(`mmEditor.expr.ops.${OP_KEYS[cond.op]}`)}</Word>
          <ValueView value={cond.right} scope={scope} />
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

function ValueView({ value, scope }: { value: Value; scope: Scope }) {
  const { t } = useTranslation();
  switch (value.kind) {
    case "var":
      return <VarChip path={value.path} sample={sample(value.path, scope)} />;
    case "papi":
      return (
        <span className="rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised-2)] px-1.5 font-mono text-[12px]">
          %{value.name}%
        </span>
      );
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
          <ValueView value={value.left} scope={scope} />
          <Word>{value.op === "+" ? "+" : "−"}</Word>
          <ValueView value={value.right} scope={scope} />
        </span>
      );
    case "cond":
      return <CondView cond={value.cond} scope={scope} />;
    case "choice":
      return (
        <PartView part={{ ...value, kind: "choice" }} scope={scope} onText={() => undefined} />
      );
    case "method": {
      const target = <ValueView value={value.target} scope={scope} />;
      const arg = value.args[0] ? <ValueView value={value.args[0]} scope={scope} /> : null;
      if (!KNOWN_METHODS.includes(value.method)) {
        return (
          <span className="inline-flex items-baseline gap-1">
            {target}
            <span className="font-mono text-[12px]">.{value.method}(…)</span>
          </span>
        );
      }
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
  const { t } = useTranslation();
  const shown =
    value === undefined
      ? null
      : typeof value === "boolean"
        ? t(value ? "mmEditor.expr.yes" : "mmEditor.expr.no")
        : typeof value === "object"
          ? null
          : String(value);
  return (
    <span className="inline-flex items-baseline gap-1 rounded-[4px] border border-[var(--border)] bg-[var(--surface-raised-2)] px-1.5 text-[12px]">
      <span className="font-mono">{path}</span>
      {shown !== null && shown !== "" && (
        <span className="text-[11px] text-[var(--text-faint)]">= {shown}</span>
      )}
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

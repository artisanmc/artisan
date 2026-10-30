import { toStringValue } from "@/lib/expr/coercion";
import { ParseError } from "@/lib/expr/errors";
import { evaluate } from "@/lib/expr/evaluator";
import { formatParseError } from "@/lib/expr/formatParseError";
import { parse } from "@/lib/expr/parser";
import { Scope } from "@/lib/expr/scope";
import { useTranslation } from "react-i18next";

export type PreviewState =
  | { kind: "ok"; display: string }
  | { kind: "parseError"; message: string };

/**
 * Pure helper exposed for testing. Returns null for empty/whitespace
 * input (caller should render nothing). Otherwise returns either an
 * "ok" state with the evaluated value as a display string, or a
 * "parseError" with the parser's message.
 *
 * Evaluation runs against an empty Scope — unbound identifiers resolve
 * to undefined and propagate per the coercion rules.
 */
export function computeExpressionPreview(expr: string): PreviewState | null {
  const trimmed = expr.trim();
  if (trimmed === "") return null;
  try {
    const ast = parse(trimmed);
    const value = evaluate(ast, new Scope({}));
    return { kind: "ok", display: toStringValue(value) };
  } catch (e) {
    if (e instanceof ParseError) {
      return { kind: "parseError", message: e.message };
    }
    return { kind: "parseError", message: (e as Error).message };
  }
}

interface ExpressionPreviewProps {
  expr: string;
}

export function ExpressionPreview({ expr }: ExpressionPreviewProps) {
  const { t } = useTranslation();
  const state = computeExpressionPreview(expr);
  if (state === null) return null;
  if (state.kind === "parseError") {
    const { key, params } = formatParseError(state.message);
    return <div className="text-[11px] text-rose-300">{t(key, params)}</div>;
  }
  return (
    <div className="font-mono text-[11px] text-[var(--brand)]">
      {t("conditions.exprPreviewValid", { display: state.display || '""' })}
    </div>
  );
}

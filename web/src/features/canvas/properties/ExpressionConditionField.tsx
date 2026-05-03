import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  COMPARISON_OPS,
  type Comparison,
  type ComparisonOp,
  serializeComparison,
  tryParseAsComparison,
} from "@/lib/expr/tryParseAsComparison";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface ExpressionConditionFieldProps {
  expr: string;
  onChange: (expr: string) => void;
}

type Mode = "form" | "freetext";

/**
 * Inline editor for an `expression` condition's `expr` field. Two modes:
 *
 *  - "form"     : 3 inputs (left / op dropdown / right). Default when
 *                 the current `expr` parses cleanly as a comparison.
 *                 Edits serialize back to a string immediately.
 *  - "freetext" : a single monospace input (same UX as Plan B1). Used
 *                 when the user picks complex shapes (ternary, &&, etc.)
 *                 or explicitly toggles. Auto-detected from `expr`.
 *
 * The mode toggle is a small button rendered next to the form. Switching
 * mode never destroys content — going from form to freetext keeps the
 * serialized comparison; going from freetext to form re-runs detection
 * and falls back to form's empty defaults if the freetext doesn't fit.
 */
export function ExpressionConditionField({ expr, onChange }: ExpressionConditionFieldProps) {
  const { t } = useTranslation();
  const detected = tryParseAsComparison(expr);
  const [mode, setMode] = useState<Mode>(detected ? "form" : "freetext");
  const [parts, setParts] = useState<Comparison>(detected ?? { left: "", op: "==", right: "" });

  // When the upstream `expr` changes (e.g. another field edit somewhere
  // updates the parent state), re-detect and reset our local form parts.
  useEffect(() => {
    const d = tryParseAsComparison(expr);
    if (d && mode === "form") setParts(d);
  }, [expr, mode]);

  const updateParts = (next: Comparison) => {
    setParts(next);
    onChange(serializeComparison(next));
  };

  const switchToFreetext = () => setMode("freetext");
  const switchToForm = () => {
    const d = tryParseAsComparison(expr);
    if (d) setParts(d);
    else setParts({ left: "", op: "==", right: "" });
    setMode("form");
    if (!d) onChange("");
  };

  if (mode === "freetext") {
    return (
      <div className="flex items-center gap-1">
        <Input
          placeholder={t("conditions.exprPlaceholder")}
          value={expr}
          onChange={(e) => onChange(e.target.value)}
          className="h-6 w-[200px] px-1.5 py-0 font-mono text-[11px]"
        />
        <button
          type="button"
          onClick={switchToForm}
          title={t("conditions.exprFormMode")}
          className="rounded px-1 text-[9px] uppercase text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
        >
          {t("conditions.exprFormModeShort")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Input
        placeholder={t("conditions.exprFormLeftPlaceholder")}
        value={parts.left}
        onChange={(e) => updateParts({ ...parts, left: e.target.value })}
        className="h-6 w-[100px] px-1.5 py-0 font-mono text-[11px]"
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-200 hover:bg-zinc-700"
          >
            {parts.op}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="border-zinc-700 bg-zinc-900 text-zinc-200">
          {COMPARISON_OPS.map((op) => (
            <DropdownMenuItem
              key={op}
              onSelect={() => updateParts({ ...parts, op: op as ComparisonOp })}
              className="cursor-pointer font-mono text-[11px] focus:bg-zinc-800"
            >
              {op}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Input
        placeholder={t("conditions.exprFormRightPlaceholder")}
        value={parts.right}
        onChange={(e) => updateParts({ ...parts, right: e.target.value })}
        className="h-6 w-[100px] px-1.5 py-0 font-mono text-[11px]"
      />
      <button
        type="button"
        onClick={switchToFreetext}
        title={t("conditions.exprFreeTextMode")}
        className="rounded px-1 text-[9px] uppercase text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
      >
        {t("conditions.exprFreeTextModeShort")}
      </button>
    </div>
  );
}

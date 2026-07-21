import type { ProjectId } from "@/domain/types";
import { ControlledStepsEditor } from "@/features/flow/ControlledStepsEditor";
import { DslParseError, parseToSteps, printFromSteps } from "@/lib/actionDsl";
import { cx } from "@/lib/cx";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Value editor for an `actions` field (an Action chain stored as an Action DSL
 * string). Cf. ADR `action-dsl`. Two modes over the SAME underlying DSL string:
 *  - **Visual** — the shared `ControlledStepsEditor` (pseudocode), via the
 *    DSL↔domain-steps adapter. Reuses the existing element/command step editor.
 *  - **Code** — the raw DSL textarea, i.e. exactly the on-disk YAML form.
 * A parse error falls back to the textarea so a hand-broken chain stays fixable.
 */
export function ActionFieldEditor({
  projectId,
  value,
  onChange,
}: {
  projectId: ProjectId;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"visual" | "code">("visual");

  const parsed = useMemo(() => {
    try {
      return { steps: parseToSteps(value), error: null as string | null };
    } catch (e) {
      return { steps: null, error: e instanceof DslParseError ? e.message : String(e) };
    }
  }, [value]);

  const tab = (m: "visual" | "code", label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className={cx(
        "rounded px-1.5 py-0.5 text-[10px]",
        mode === m
          ? "bg-[var(--surface-raised-2)] text-[var(--text)]"
          : "text-[var(--text-faint)] hover:text-[var(--text)]",
      )}
      aria-pressed={mode === m}
    >
      {label}
    </button>
  );

  const showVisual = mode === "visual" && parsed.steps !== null;

  return (
    <div className="flex min-w-64 flex-col gap-1" data-testid="action-field-editor">
      <div className="flex gap-1 self-end">
        {tab("visual", t("dataSources.actionsVisual"))}
        {tab("code", t("dataSources.actionsCode"))}
      </div>
      {showVisual ? (
        <ControlledStepsEditor
          projectId={projectId}
          value={parsed.steps!}
          onChange={(steps) => onChange(printFromSteps(steps))}
        />
      ) : (
        <>
          {mode === "visual" && parsed.error ? (
            <p className="text-[10px] text-[var(--danger)]">
              {t("dataSources.actionsParseFallback")}
            </p>
          ) : null}
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="input min-h-24 w-full resize-y font-mono text-[11px] leading-snug"
            spellCheck={false}
            placeholder={t("dataSources.actionsPlaceholder")}
            aria-label={t("dataSources.actionsCode")}
          />
          {parsed.error ? (
            <p className="font-mono text-[10px] text-[var(--danger)]">{parsed.error}</p>
          ) : null}
        </>
      )}
    </div>
  );
}

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cx } from "@/lib/cx";
import { evaluate } from "@/lib/expr/evaluator";
import { parse } from "@/lib/expr/parser";
import { variablesOf } from "@/lib/expr/readable";
import { humanizePath } from "@/lib/expr/sampleRender";
import type { Scope } from "@/lib/expr/scope";
import { RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Simulation } from "./useSimulation";

export interface SimulationPanelProps {
  /** The texts whose `{…}` the example player is set for (an item's name and lore). */
  sources: string[];
  simulation: Simulation;
  className?: string;
}

type Field = { path: string } & (
  | { kind: "boolean"; value: boolean }
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
);

/**
 * The example player, set by hand: one control per value the texts read (a switch for
 * yes/no, a field otherwise). The preview and the lit rules follow it.
 */
export function SimulationPanel({ sources, simulation, className }: SimulationPanelProps) {
  const { t } = useTranslation();
  const { scope, overrides, setOverride, reset } = simulation;
  const paths = useMemo(() => [...new Set(sources.flatMap(variablesOf))], [sources]);
  const fields = paths.flatMap((path) => fieldOf(path, scope));
  if (fields.length === 0) return null;
  return (
    <section
      aria-label={t("mmEditor.simulation.title")}
      className={cx("flex flex-col gap-2.5", className)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col">
          <span className="field-label">{t("mmEditor.simulation.title")}</span>
          <span className="text-[11.5px] text-[var(--text-mut)]">
            {t("mmEditor.simulation.intro")}
          </span>
        </div>
        {Object.keys(overrides).length > 0 && (
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0"
            title={t("mmEditor.simulation.reset")}
            aria-label={t("mmEditor.simulation.reset")}
            onClick={reset}
          >
            <RotateCcw size={13} />
          </button>
        )}
      </div>
      <ul className="flex flex-col gap-1.5">
        {fields.map((f) => (
          <li key={f.path} className="flex min-h-7 items-center justify-between gap-3">
            <span className="min-w-0 truncate text-[12.5px]" title={`{${f.path}}`}>
              {humanizePath(f.path)}
            </span>
            {f.kind === "boolean" ? (
              <Switch
                checked={f.value}
                aria-label={humanizePath(f.path)}
                onCheckedChange={(v) => setOverride(f.path, v)}
              />
            ) : (
              <Input
                type={f.kind === "number" ? "number" : "text"}
                aria-label={humanizePath(f.path)}
                className="h-7 w-40 shrink-0 px-2 text-xs"
                value={String(f.value)}
                onChange={(e) => {
                  if (f.kind === "string") setOverride(f.path, e.target.value);
                  else if (e.target.value !== "" && Number.isFinite(Number(e.target.value)))
                    setOverride(f.path, Number(e.target.value));
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A value typed by hand: yes/no, a number, a one-line text; the rest (lists, dates) is not. */
function fieldOf(path: string, scope: Scope): Field[] {
  // `base.*` is the item it builds on, not the player; an index cannot be set by path.
  if (path.startsWith("base.") || path === "base" || /[[\]]/.test(path)) return [];
  let value: unknown;
  try {
    value = evaluate(parse(path), scope);
  } catch {
    return [];
  }
  if (typeof value === "boolean") return [{ path, kind: "boolean", value }];
  if (typeof value === "number") return [{ path, kind: "number", value }];
  if (typeof value === "string" && !value.includes("\n")) return [{ path, kind: "string", value }];
  return [];
}

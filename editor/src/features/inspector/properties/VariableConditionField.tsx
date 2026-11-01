import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ModuleVariable } from "@/lib/api/moduleVariables";
import { cx } from "@/lib/cx";
import { COMPARISON_OPS } from "@/lib/expr/tryParseAsComparison";
import {
  type VariableCondition,
  parseVariableCondition,
  serializeVariableCondition,
} from "@/lib/expr/variableCondition";
import { useServerVariablesStore } from "@/state/serverVariablesStore";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** The operators a variable of that type offers; an unknown one (module missing) gets them all. */
function opsFor(v: ModuleVariable | undefined): VariableCondition["op"][] {
  if (v?.type === "boolean") return ["is", "is_not"];
  if (v?.type === "string") return ["==", "!="];
  if (v?.type === "number") return [...COMPARISON_OPS];
  return ["is", "is_not", ...COMPARISON_OPS];
}

/** A criterion on `v` with its first operator and a value of its type. */
export function criterionFor(v: ModuleVariable): VariableCondition {
  const key = v.key ? "" : null;
  if (v.type === "boolean") return { name: v.name, key, op: "is", value: null };
  if (v.type === "number") return { name: v.name, key, op: ">=", value: 1 };
  return { name: v.name, key, op: "==", value: v.values[0] ?? "" };
}

/**
 * A criterion on a module Variable (ADR `triggers-and-variables` §10): variable → key →
 * operator → value, picked from what the active server declares. It writes a plain
 * `expression` (`var.guilds.has_guild`, `var.guilds.level >= 3`). A variable the server does
 * not declare stays as written and is flagged: its module is not installed there.
 */
export function VariableConditionField({
  expr,
  onChange,
}: {
  expr: string;
  onChange: (expr: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const variables = useServerVariablesStore((s) => s.variables);
  const ready = useServerVariablesStore((s) => s.status === "ready");
  const c = parseVariableCondition(expr);
  if (!c) return null;
  const variable = variables.find((v) => v.name === c.name);
  const missing = c.name !== "" && ready && !variable;
  const write = (next: VariableCondition) => onChange(serializeVariableCondition(next));
  const describe = (v: ModuleVariable) =>
    v.description[i18n.language] ?? v.description.en ?? Object.values(v.description)[0] ?? "";
  const opLabel = (op: VariableCondition["op"]) =>
    op === "is"
      ? t("conditions.variable.isTrue")
      : op === "is_not"
        ? t("conditions.variable.isFalse")
        : op;

  return (
    <>
      <Picker
        label={
          <span className={cx("font-mono", missing && "text-[var(--danger)] line-through")}>
            {c.name || t("conditions.variable.pick")}
          </span>
        }
        title={
          missing
            ? t("conditions.variable.missing", { name: c.name })
            : variable
              ? describe(variable)
              : undefined
        }
      >
        {variables.length === 0 ? (
          <div className="px-2 py-1 text-[11px] text-[var(--text-faint)]">
            {t("conditions.variable.none")}
          </div>
        ) : (
          variables.map((v) => (
            <DropdownMenuItem
              key={v.name}
              onSelect={() => write(criterionFor(v))}
              className="cursor-pointer flex-col items-start text-[11px] focus:bg-[var(--surface-raised-2)]"
            >
              <span className="font-mono">{v.name}</span>
              {describe(v) ? (
                <span className="text-[10.5px] text-[var(--text-faint)]">{describe(v)}</span>
              ) : null}
            </DropdownMenuItem>
          ))
        )}
      </Picker>
      {c.key !== null || variable?.key ? (
        <Input
          aria-label={t("conditions.variable.key")}
          placeholder={variable?.key?.name ?? t("conditions.variable.key")}
          value={c.key ?? ""}
          onChange={(e) => write({ ...c, key: e.target.value })}
          className="h-6 w-[110px] px-1.5 py-0 font-mono text-[11px]"
        />
      ) : null}
      {c.name ? (
        <Picker label={<span className="font-mono">{opLabel(c.op)}</span>}>
          {opsFor(variable).map((op) => (
            <DropdownMenuItem
              key={op}
              onSelect={() =>
                write({
                  ...c,
                  op,
                  value:
                    op === "is" || op === "is_not"
                      ? null
                      : (c.value ?? (variable?.type === "number" ? 0 : "")),
                })
              }
              className="cursor-pointer font-mono text-[11px] focus:bg-[var(--surface-raised-2)]"
            >
              {opLabel(op)}
            </DropdownMenuItem>
          ))}
        </Picker>
      ) : null}
      {c.name && c.op !== "is" && c.op !== "is_not" ? (
        variable?.values.length ? (
          <Picker label={<span className="font-mono">{String(c.value ?? "")}</span>}>
            {variable.values.map((value) => (
              <DropdownMenuItem
                key={value}
                onSelect={() => write({ ...c, value })}
                className="cursor-pointer font-mono text-[11px] focus:bg-[var(--surface-raised-2)]"
              >
                {value}
              </DropdownMenuItem>
            ))}
          </Picker>
        ) : (
          <Input
            aria-label={t("conditions.variable.value")}
            type={variable?.type === "number" ? "number" : "text"}
            value={String(c.value ?? "")}
            onChange={(e) => {
              const raw = e.target.value;
              const n = Number(raw);
              write({
                ...c,
                value: variable?.type === "number" ? (Number.isNaN(n) ? 0 : n) : raw,
              });
            }}
            className="h-6 w-[90px] px-1.5 py-0 font-mono text-[11px]"
          />
        )
      ) : null}
    </>
  );
}

function Picker({
  label,
  title,
  children,
}: {
  label: ReactNode;
  title?: string;
  children: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={title}
          className="h-6 rounded border border-[var(--border)] bg-[var(--surface)] px-1.5 text-[11px] text-[var(--text)] hover:border-[var(--border-strong)]"
        >
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="border-[var(--border)] bg-[var(--surface-raised)] text-[var(--text)]"
      >
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

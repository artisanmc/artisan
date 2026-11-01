import { EditorHeader } from "@/components/ui/editor-header";
import { Input } from "@/components/ui/input";
import type { ProjectId } from "@/domain/types";
import { FieldLabel, Lane } from "@/features/inspector/layout";
import { cx } from "@/lib/cx";
import { useProjectsStore } from "@/state/projectsStore";
import { useTranslation } from "react-i18next";
import {
  VARIABLE_KIND,
  VARIABLE_TYPES,
  type Variable,
  type VariableScope,
  type VariableType,
  acceptsValue,
} from "./variable";

/**
 * A Variable's page: its type and scope as two rows of choices, its default and its lifetime,
 * then how it is read and written, with the exact forms to copy (`{var.<id>}`, `has_var`).
 */
export function VariableEditor({
  projectId,
  variable,
}: { projectId: ProjectId; variable: Variable }) {
  const { t } = useTranslation();
  const updateDocument = useProjectsStore((s) => s.updateDocument);
  const update = (patch: Partial<Variable>) => {
    // A default of the previous type would no longer load: it goes with the type.
    const retyped = patch.type !== undefined && patch.type !== variable.type;
    const { default: previous, ...rest } = { ...variable, ...patch };
    const next: Variable = retyped ? rest : { ...rest, default: previous };
    updateDocument({ projectId, kind: VARIABLE_KIND.kind, id: variable.id, doc: next });
  };
  const badDefault =
    variable.default !== undefined && !acceptsValue(variable.type, variable.default);

  return (
    <div className="flex h-full flex-col bg-[var(--surface)]">
      <EditorHeader
        kind={VARIABLE_KIND.kind}
        eyebrow={t("variables.kindLabel")}
        title={<span className="font-mono text-[20px]">{variable.id}</span>}
        details={
          <span className="text-[13px] text-[var(--text-mut)]">
            {t("variables.summary", {
              type: t(`variables.types.${variable.type}`),
              scope: t(`variables.scopes.${variable.scope}`),
            })}
          </span>
        }
      />
      <div className="@container page-inset-x flex-1 overflow-auto py-[var(--page-pad)]">
        <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-[minmax(280px,420px)_1fr] @3xl:items-start">
          <section className="panel rounded-[var(--r-md)] p-4">
            <Lane label={t("variables.value")}>
              <div className="flex flex-col gap-3">
                <div>
                  <FieldLabel>{t("variables.type")}</FieldLabel>
                  <Choices
                    value={variable.type}
                    options={VARIABLE_TYPES.map((v) => ({
                      value: v,
                      label: t(`variables.types.${v}`),
                    }))}
                    onChange={(type) => update({ type: type as VariableType })}
                  />
                </div>
                <div>
                  <FieldLabel>{t("variables.scope")}</FieldLabel>
                  <Choices
                    value={variable.scope}
                    options={(["player", "server"] as const).map((v) => ({
                      value: v,
                      label: t(`variables.scopes.${v}`),
                    }))}
                    onChange={(scope) => update({ scope: scope as VariableScope })}
                  />
                  <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                    {t(`variables.scopeHint.${variable.scope}`)}
                  </p>
                </div>
                <div>
                  <FieldLabel>{t("variables.default")}</FieldLabel>
                  <DefaultInput
                    variable={variable}
                    onChange={(value) => update({ default: value })}
                  />
                  {badDefault ? (
                    <p className="mt-1 text-[11.5px] text-[var(--danger)]">
                      {t("variables.badDefault", { type: t(`variables.types.${variable.type}`) })}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11.5px] text-[var(--text-faint)]">
                      {t("variables.defaultHint")}
                    </p>
                  )}
                </div>
                <div>
                  <FieldLabel>{t("variables.expires")}</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={0}
                      aria-label={t("variables.expires")}
                      value={variable.expiresSeconds ?? ""}
                      placeholder={t("variables.never")}
                      onChange={(e) => {
                        const n = Math.floor(Number(e.target.value));
                        update({ expiresSeconds: Number.isFinite(n) && n > 0 ? n : undefined });
                      }}
                      className="h-7 w-[120px] text-[12px]"
                    />
                    <span className="text-[12px] text-[var(--text-mut)]">
                      {t("variables.seconds")}
                    </span>
                  </div>
                </div>
              </div>
            </Lane>
          </section>
          <section className="panel rounded-[var(--r-md)] p-4">
            <Lane label={t("variables.usage")}>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[12.5px]">
                <Usage term={t("variables.usageText")} code={`{var.${variable.id}}`} />
                <Usage term={t("variables.usageSet")} code={`has_var: ${variable.id}`} />
                {variable.type === "boolean" ? (
                  <Usage term={t("variables.usageTrue")} code={`expression: var.${variable.id}`} />
                ) : null}
                <Usage
                  term={t("variables.usageWrite")}
                  code={`set_var: { var: ${variable.id}, value: … }`}
                />
                {variable.type === "number" ? (
                  <Usage term={t("variables.usageAdd")} code={`add_var: ${variable.id}`} />
                ) : null}
                {variable.type === "location" ? (
                  <Usage
                    term={t("variables.usageTeleport")}
                    code={`teleport: "{var.${variable.id}}"`}
                  />
                ) : null}
                <Usage term={t("variables.usageClear")} code={`clear_var: ${variable.id}`} />
                <Usage term={t("variables.usagePapi")} code={`%artisan_var_${variable.id}%`} />
              </dl>
            </Lane>
          </section>
        </div>
      </div>
    </div>
  );
}

function Usage({ term, code }: { term: string; code: string }) {
  return (
    <>
      <dt className="text-[var(--text-mut)]">{term}</dt>
      <dd className="min-w-0">
        <code className="font-mono text-[12px] text-[var(--text)] [overflow-wrap:anywhere]">
          {code}
        </code>
      </dd>
    </>
  );
}

function Choices({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx("chip text-[12px]", o.value === value && "is-active")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** The default, edited as its type: a switch for a boolean, a number, a text, `world x y z` for a place. */
function DefaultInput({
  variable,
  onChange,
}: { variable: Variable; onChange: (value: unknown) => void }) {
  const { t } = useTranslation();
  const value = variable.default;
  if (variable.type === "boolean") {
    return (
      <Choices
        value={value === undefined ? "" : String(value)}
        options={[
          { value: "", label: t("variables.none") },
          { value: "true", label: t("variables.true") },
          { value: "false", label: t("variables.false") },
        ]}
        onChange={(v) => onChange(v === "" ? undefined : v === "true")}
      />
    );
  }
  const text =
    value === undefined
      ? ""
      : variable.type === "location" && value && typeof value === "object"
        ? ["world", "x", "y", "z"]
            .map((k) => String((value as Record<string, unknown>)[k] ?? ""))
            .join(" ")
        : String(value);
  return (
    <Input
      aria-label={t("variables.default")}
      type={variable.type === "number" ? "number" : "text"}
      value={text}
      placeholder={variable.type === "location" ? "world 0 64 0" : t("variables.none")}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === "") return onChange(undefined);
        if (variable.type === "number") {
          const n = Number(raw);
          return onChange(Number.isFinite(n) ? n : raw);
        }
        onChange(raw);
      }}
      className="h-7 w-full font-mono text-[12px]"
    />
  );
}

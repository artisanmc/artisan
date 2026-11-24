import { FormField } from "@/components/ui/form-field";
import { Switch } from "@/components/ui/switch";
import {
  BUILTIN_VARIANTS,
  type ServerVariant,
  serverVariantProblems,
} from "@/lib/variants/serverVariants";
import { Plus, X } from "lucide-react";
import type { ComponentType } from "react";
import { useTranslation } from "react-i18next";

/**
 * The editor of an `if:` list (the inspector's `ConditionsField`), given by the page: a
 * feature does not import another one (`check:boundaries`).
 */
export type ConditionsEditor = ComponentType<{
  value: unknown;
  onChange: (conditions: unknown[]) => void;
  label?: string;
  emptyHint?: string;
}>;

/**
 * The server's menu variants (`menu-variants` of `config.yml`): the three built in, shown for
 * what they do, and the server's own, each with its parent, its conditions and whether players
 * may choose it. The plugin refuses the whole list while one entry is wrong: each is said here.
 */
export function MenuVariantsFields({
  value,
  onChange,
  conditionsField: ConditionsField,
}: {
  value: ServerVariant[];
  onChange: (next: ServerVariant[]) => void;
  conditionsField: ConditionsEditor;
}) {
  const { t } = useTranslation();
  const problems = serverVariantProblems(value);
  const set = (i: number, patch: Partial<ServerVariant>) =>
    onChange(value.map((v, k) => (k === i ? { ...v, ...patch } : v)));
  const add = () => {
    let n = value.length + 1;
    while (value.some((v) => v.name === `variant-${n}`)) n++;
    onChange([...value, { name: `variant-${n}`, parent: "default", if: [], selectable: true }]);
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {BUILTIN_VARIANTS.map((name) => (
          <li key={name} className="flex items-baseline gap-3 text-[13px]">
            <span className="chip shrink-0 font-mono">{name}</span>
            <span className="text-[var(--text-mut)]">
              {t(`serverConfig.variants.builtin.${name}`)}
            </span>
          </li>
        ))}
      </ul>
      {value.map((v, i) => {
        const problem = problems.get(i);
        const parents = [
          ...BUILTIN_VARIANTS,
          ...value.map((o) => o.name).filter((n, k) => k !== i && n),
        ];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are positional, their name is being edited
          <div key={i} className="card flex flex-col gap-3 p-4">
            <div className="flex items-start gap-2">
              <FormField
                className="min-w-0 flex-1"
                label={t("serverConfig.variants.name")}
                hint={
                  problem ? (
                    <span className="text-[var(--danger)]">
                      {t(`serverConfig.variants.problems.${problem}`)}
                    </span>
                  ) : undefined
                }
              >
                <input
                  className="input font-mono"
                  value={v.name}
                  onChange={(e) => set(i, { name: e.target.value.trim() })}
                />
              </FormField>
              <FormField className="min-w-0 flex-1" label={t("serverConfig.variants.parent")}>
                <select
                  className="input"
                  value={v.parent}
                  onChange={(e) => set(i, { parent: e.target.value })}
                >
                  {[...new Set([...parents, v.parent])].map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </FormField>
              <button
                type="button"
                className="btn btn-ghost btn-sm mt-6"
                title={t("serverConfig.variants.remove")}
                aria-label={t("serverConfig.variants.remove")}
                onClick={() => onChange(value.filter((_, k) => k !== i))}
              >
                <X className="size-4" />
              </button>
            </div>
            <ConditionsField
              label={t("serverConfig.variants.conditions")}
              value={v.if}
              emptyHint={t("serverConfig.variants.noConditions")}
              onChange={(conditions) => set(i, { if: conditions })}
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-[var(--text)]">
                {t("serverConfig.variants.selectable")}
              </span>
              <Switch
                aria-label={t("serverConfig.variants.selectable")}
                checked={v.selectable}
                onCheckedChange={(selectable) => set(i, { selectable })}
              />
            </div>
          </div>
        );
      })}
      <button type="button" className="btn btn-ghost btn-sm self-start" onClick={add}>
        <Plus className="size-4" /> {t("serverConfig.variants.add")}
      </button>
    </div>
  );
}

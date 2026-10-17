import { Checkbox } from "@/components/ui/checkbox";
import { readAdvanced, writeAdvanced } from "@/domain/itemAdvanced";
import {
  ITEM_COMPARISONS,
  type ItemComparison,
  defaultItemMatch,
  itemSpecMaterial,
  readItemMatch,
} from "@/domain/itemMatch";
import type { ProjectId } from "@/domain/types";
import { MaterialField } from "@/features/canvas/MaterialField";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { ItemEditor } from "../ItemEditor";
import { resolveItem } from "../resolveItem";

const ADVANCED_KEYS = [
  "enchants",
  "enchanted",
  "custom_model_data",
  "unbreakable",
  "hide",
  "color",
  "nbt",
];

/**
 * An item spec held in a module's Document (SDK `ItemInput`): the item form of menus on a
 * controlled value, the material picked among vanilla items, custom items and the Project's
 * captured items, text kept literal (MiniMessage). With `onMatchChange`, the criteria a player's
 * stack is compared on (`api.items.matches`), ticked by default from the item itself.
 */
export function ItemSpecField({
  projectId,
  value,
  onChange,
  match,
  onMatchChange,
}: {
  projectId: string;
  value: Record<string, unknown>;
  onChange: (spec: Record<string, unknown>) => void;
  match?: string[];
  onMatchChange?: (match: string[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const project = useProjectsStore((s) => s.openProjects.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  const material = itemSpecMaterial(value);
  const patch = (fields: Record<string, unknown>) => {
    const next: Record<string, unknown> = { ...value, ...fields };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  const picker = (
    <MaterialField
      value={material}
      projectId={projectId as ProjectId}
      aria-label={t("itemSpec.material")}
      onChange={(next) =>
        patch({ material: next || undefined, item: undefined, extends: undefined })
      }
    />
  );
  if (!project) return picker;
  const lang = activeLang || project.defaultLang;
  const inherited = resolveItem(material, {}, project, lang);
  let preview = inherited;
  try {
    preview = resolveItem({ ...value, material }, {}, project, lang);
  } catch {
    // An unreadable spec previews as its material alone.
  }
  const advanced = readAdvanced(value);
  const lore = Array.isArray(value.lore)
    ? value.lore.map(String).join("\n")
    : typeof value.lore === "string"
      ? value.lore
      : undefined;
  const chosen = readItemMatch(match);
  const ticked = new Set<ItemComparison>(chosen ?? defaultItemMatch(project, value));
  const toggle = (criterion: ItemComparison, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(criterion);
    else next.delete(criterion);
    onMatchChange?.(ITEM_COMPARISONS.filter((c) => next.has(c)));
  };
  return (
    <ItemEditor
      project={project}
      appearance={{
        ...advanced,
        count: typeof value.count === "number" ? value.count : undefined,
      }}
      title={typeof value.title === "string" ? value.title : undefined}
      lore={lore}
      inherited={inherited}
      preview={preview}
      source={picker}
      onText={(field, text) =>
        patch({
          [field]: text === undefined ? undefined : field === "lore" ? text.split("\n") : text,
        })
      }
      onCount={(count) => patch({ count })}
      onAdvanced={(fields) => {
        const next = { ...value };
        for (const key of ADVANCED_KEYS) delete next[key];
        writeAdvanced({ ...advanced, ...fields }, next);
        onChange(next);
      }}
      details={
        onMatchChange && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="field-label mb-1">{t("itemSpec.matchTitle")}</legend>
            <p className="text-xs text-[var(--text-mut)]">
              {t(chosen ? "itemSpec.matchHint" : "itemSpec.matchDefaultHint")}
            </p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1">
              {ITEM_COMPARISONS.map((criterion) => (
                <label
                  key={criterion}
                  htmlFor={`${uid}-${criterion}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <Checkbox
                    id={`${uid}-${criterion}`}
                    checked={ticked.has(criterion)}
                    onCheckedChange={(on) => toggle(criterion, on)}
                  />
                  <span title={t(`itemSpec.matchHelp.${criterion}`)}>
                    {t(`itemSpec.match.${criterion}`)}
                  </span>
                </label>
              ))}
            </div>
            {chosen && (
              <button
                type="button"
                className="btn btn-ghost h-6 self-start px-1 text-xs"
                onClick={() => onMatchChange(undefined)}
              >
                {t("itemSpec.matchReset")}
              </button>
            )}
          </fieldset>
        )
      }
    />
  );
}

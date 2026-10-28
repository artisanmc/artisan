import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatEnchant, readAdvanced, writeAdvanced } from "@/domain/itemAdvanced";
import {
  ITEM_COMPARISONS,
  type ItemComparison,
  type ItemMatchFacts,
  defaultItemMatch,
  identityComparison,
  itemMatchFacts,
  itemSpecMaterial,
  readItemMatch,
} from "@/domain/itemMatch";
import type { ProjectId } from "@/domain/types";
import { MaterialField } from "@/features/canvas/MaterialField";
import { useProjectsStore } from "@/state/projectsStore";
import { useUiStore } from "@/state/uiStore";
import { Check } from "lucide-react";
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
 * stack is compared on (`api.items.matches`): a copy of the item, or the criteria it carries.
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
  const details = onMatchChange && (
    <MatchCriteria
      facts={itemMatchFacts(project, value)}
      chosen={readItemMatch(match)}
      fallback={defaultItemMatch(project, value)}
      onChange={onMatchChange}
    />
  );
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
      details={details}
    />
  );
}

type Row = { criterion: ItemComparison; label: string; value?: string };

/**
 * The `match` of an item spec: "exact copy" (`[exact]`, which every other criterion falls under)
 * or a list of criteria. The list shows what the item carries, each with the value it compares;
 * the criteria with nothing to compare on (no name: a renamed item does not count) sit folded
 * below. The item's identity, once ticked, is always compared: it shows as a mark, not a box. Untouched, the module's default applies.
 */
function MatchCriteria({
  facts,
  chosen,
  fallback,
  onChange,
}: {
  facts: ItemMatchFacts;
  chosen: ItemComparison[] | undefined;
  fallback: ItemComparison[];
  onChange: (match: string[] | undefined) => void;
}) {
  const { t } = useTranslation();
  const uid = useId();
  const ticked = new Set<ItemComparison>(chosen ?? fallback);
  const exact = ticked.has("exact");
  const identity = identityComparison(facts);
  const write = (next: Set<ItemComparison>) =>
    onChange(next.size > 0 ? ITEM_COMPARISONS.filter((c) => next.has(c)) : undefined);
  const toggle = (criterion: ItemComparison, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(criterion);
    else next.delete(criterion);
    write(next);
  };
  const setMode = (mode: string) => {
    if (mode === "exact") return onChange(["exact"]);
    const next = new Set(ticked);
    next.delete("exact");
    write(next);
  };

  const main: Row[] = [
    {
      criterion: identity,
      label: t(facts.custom ? "itemSpec.match.custom_item" : "itemSpec.match.material"),
      value: facts.base,
    },
  ];
  const more: Row[] = [];
  if (facts.custom) more.push({ criterion: "material", label: t("itemSpec.match.base_material") });
  else
    main.push({
      criterion: "custom_item",
      label: t("itemSpec.match.vanilla_only"),
      value: t("itemSpec.matchValue.vanilla_only"),
    });
  if (facts.name)
    main.push({ criterion: "name", label: t("itemSpec.match.name"), value: facts.name });
  else more.push({ criterion: "name", label: t("itemSpec.match.no_name") });
  if (facts.lore)
    main.push({
      criterion: "lore",
      label: t("itemSpec.match.lore"),
      value: facts.lore.join(" · "),
    });
  else more.push({ criterion: "lore", label: t("itemSpec.match.no_lore") });
  if (facts.enchants)
    main.push({
      criterion: "enchants",
      label: t("itemSpec.match.enchants"),
      value: facts.enchants.map(formatEnchant).join(", "),
    });
  else if (ticked.has("enchants"))
    more.push({ criterion: "enchants", label: t("itemSpec.match.no_enchants") });
  if (facts.customModelData)
    main.push({
      criterion: "custom_model_data",
      label: t("itemSpec.match.custom_model_data"),
      value: facts.customModelData,
    });
  else
    more.push({ criterion: "custom_model_data", label: t("itemSpec.match.no_custom_model_data") });
  main.push({
    criterion: "damage",
    label: t("itemSpec.match.damage"),
    value: t("itemSpec.matchValue.damage"),
  });
  const moreTicked = more.filter((r) => ticked.has(r.criterion)).length;

  const row = ({ criterion, label, value }: Row) => {
    const id = `${uid}-${criterion}`;
    const locked = criterion === identity && ticked.has(criterion);
    return (
      <div key={criterion} className="flex items-start gap-2">
        {locked ? (
          <Check size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" aria-hidden />
        ) : (
          <Checkbox
            id={id}
            className="mt-0.5"
            checked={ticked.has(criterion)}
            onCheckedChange={(on) => toggle(criterion, on)}
          />
        )}
        <label htmlFor={locked ? undefined : id} className="flex min-w-0 flex-col text-sm">
          <span>{label}</span>
          {value && (
            <span className="truncate text-xs text-[var(--text-mut)]" title={value}>
              {value}
            </span>
          )}
        </label>
      </div>
    );
  };

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="field-label mb-1">{t("itemSpec.matchTitle")}</legend>
      <Tabs value={exact ? "exact" : "criteria"} onValueChange={setMode}>
        <TabsList aria-label={t("itemSpec.matchTitle")}>
          <TabsTrigger value="criteria">{t("itemSpec.matchMode.criteria")}</TabsTrigger>
          <TabsTrigger value="exact">{t("itemSpec.matchMode.exact")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <p className="text-xs text-[var(--text-mut)]">
        {t(
          exact
            ? "itemSpec.matchExactHint"
            : chosen
              ? "itemSpec.matchHint"
              : "itemSpec.matchDefaultHint",
        )}
      </p>
      {!exact && (
        <>
          <div className="flex flex-col gap-1.5">{main.map(row)}</div>
          <Collapsible
            title={t("itemSpec.matchMore")}
            meta={moreTicked > 0 ? <span className="badge">{moreTicked}</span> : undefined}
            defaultOpen={moreTicked > 0}
          >
            <div className="flex flex-col gap-1.5">{more.map(row)}</div>
          </Collapsible>
        </>
      )}
      {chosen && (
        <button
          type="button"
          className="btn btn-ghost h-6 self-start px-1 text-xs"
          onClick={() => onChange(undefined)}
        >
          {t("itemSpec.matchReset")}
        </button>
      )}
    </fieldset>
  );
}

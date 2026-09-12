import { Input } from "@/components/ui/input";
import { readAdvanced, writeAdvanced } from "@/domain/itemAdvanced";
import type { Appearance, LText, ProjectId } from "@/domain/types";
import { ItemBindingEditor } from "@/features/flow/ItemBindingEditor";
import { isScreenScratchId } from "@/features/screens/screenScratch";
import { getText } from "@/lib/i18n";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";
import { ItemEditor } from "./ItemEditor";
import { resolveItem } from "./resolveItem";

export function ItemValueField({
  projectId,
  value,
  onChange,
  scope = {},
}: {
  projectId: ProjectId;
  value: unknown;
  onChange: (value: unknown) => void;
  scope?: Record<string, unknown>;
}) {
  const { t } = useTranslation();
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const activeLang = useUiStore((s) => s.activeLang);
  const setI18nValue = useAccountStore((s) => s.setI18nValue);
  if (!project) return null;
  const lang = isScreenScratchId(projectId)
    ? project.defaultLang
    : activeLang || project.defaultLang;
  const item =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : { material: typeof value === "string" ? value : "" };
  const source = item.extends ?? item.item ?? item.material;
  const inherited = resolveItem(source, scope, project, lang);
  const preview = resolveItem(item, scope, project, lang);
  const advanced = readAdvanced(item);
  if (Array.isArray(item.enchants))
    advanced.enchants = item.enchants as NonNullable<typeof advanced.enchants>;
  const text = (v: unknown): string =>
    typeof v === "string"
      ? v
      : Array.isArray(v)
        ? v.map(text).join("\n")
        : v && typeof v === "object" && "key" in v
          ? getText(project, v as LText, lang)
          : "";
  const normalized = () => {
    const next: Record<string, unknown> = { ...item, extends: source };
    Reflect.deleteProperty(next, "material");
    Reflect.deleteProperty(next, "item");
    if (item.extends === undefined && item.lore !== undefined) {
      next.lore = ["{base.lore}", ...(Array.isArray(item.lore) ? item.lore : [item.lore])];
    }
    return next;
  };
  const patch = (fields: Record<string, unknown>) => {
    const next = { ...normalized(), ...fields };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    onChange(next);
  };
  const current =
    scope.item && typeof scope.item === "object" ? (scope.item as Record<string, unknown>) : {};
  const entries: PlaceholderEntry[] = Object.entries(current)
    .filter(([key, v]) => key !== "icon" && (typeof v !== "object" || v === null))
    .map(([key, v]) => ({
      path: `item.${key}`,
      type: typeof v === "number" ? "number" : "string",
      origin: "context",
      sample: String(v ?? ""),
    }));
  return (
    <ItemEditor
      project={project}
      appearance={{
        ...advanced,
        count: typeof item.count === "number" ? item.count : undefined,
        head: typeof item.head === "string" ? item.head : undefined,
      }}
      onHead={(head) => patch({ head })}
      titleLabel={t("flow.titleLabel", { lang })}
      loreLabel={t("flow.loreLabel", { lang })}
      title={item.title === undefined ? undefined : text(item.title)}
      lore={
        item.lore === undefined
          ? undefined
          : (item.extends === undefined ? "{base.lore}\n" : "") + text(item.lore)
      }
      inherited={inherited}
      preview={preview}
      entries={entries}
      source={
        <ItemBindingEditor
          project={project}
          appearance={
            { ...item, item: typeof source === "string" ? source : undefined } as Appearance
          }
          scope={scope}
          lang={lang}
          onSource={(_field, value) => patch({ extends: value })}
        >
          <Input
            value={typeof source === "string" ? source : ""}
            onChange={(e) => patch({ extends: e.target.value })}
            className="font-mono text-xs"
          />
        </ItemBindingEditor>
      }
      onCount={(count) => patch({ count })}
      onText={(field, value) => {
        if (value === undefined) {
          patch({ [field]: undefined, ...(field === "lore" ? { lore_mode: undefined } : {}) });
          return;
        }
        const existing = item[field];
        const lt =
          existing && typeof existing === "object" && !Array.isArray(existing) && "key" in existing
            ? (existing as LText)
            : ({ key: `items.${crypto.randomUUID()}.${field}` } as LText);
        patch({ [field]: lt, ...(field === "lore" ? { lore_mode: "replace" } : {}) });
        setI18nValue({ projectId, lt, lang, value });
      }}
      onAdvanced={(fields) => {
        const next = normalized();
        for (const key of [
          "enchants",
          "enchanted",
          "custom_model_data",
          "unbreakable",
          "hide",
          "color",
          "nbt",
        ])
          delete next[key];
        writeAdvanced({ ...advanced, ...fields }, next);
        if (fields.enchants?.some((e) => !e.id.trim())) next.enchants = fields.enchants;
        onChange(next);
      }}
    />
  );
}

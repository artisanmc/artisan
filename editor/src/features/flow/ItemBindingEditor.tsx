import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatEnchant } from "@/domain/itemAdvanced";
import type { Appearance, Element, Menu, Project } from "@/domain/types";
import { previewItem } from "@/features/canvas/itemValuePreview";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { itemBindingOptions } from "./itemBindingOptions";

export function ItemBindingEditor({
  project,
  menu,
  element,
  appearance,
  scope,
  lang,
  onSource,
  onCount,
  children,
}: {
  project: Project;
  menu: Menu;
  element: Element;
  appearance: Appearance;
  scope: Record<string, unknown>;
  lang: string;
  onSource: (field: "material" | "item", value: string) => void;
  onCount: (count: number | undefined) => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const sources = useServerDataSourcesStore((s) => s.sources);
  const options = itemBindingOptions(project, menu, element, sources);
  const legacy = appearance.material?.startsWith("{") ? appearance.material : undefined;
  const binding = appearance.item ?? legacy;
  const linked = binding !== undefined;
  const resolved = previewItem(appearance, scope, project, lang);
  const base = previewItem({ item: binding }, scope, project, lang);
  const texture = useTextureUrl(resolved.material ?? "");
  const icon = useHeadPreviewUrl(resolved.head) ?? texture;
  const selected = binding?.replace(/^\{|\}$/g, "") ?? "";
  return (
    <section
      className="flex flex-col gap-2 rounded border border-[var(--border-soft)] p-2.5"
      aria-label={t("itemBinding.title")}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{t("itemBinding.title")}</span>
        {linked && <Badge variant="sage">{t("itemBinding.linked")}</Badge>}
      </div>
      <select
        className="input text-xs"
        aria-label={t("itemBinding.mode")}
        value={linked ? "data" : "define"}
        onChange={(e) =>
          e.target.value === "data"
            ? onSource("item", options[0] ? `{${options[0]}}` : "")
            : onSource(
                "material",
                resolved.material && !resolved.material.includes("{") ? resolved.material : "STONE",
              )
        }
      >
        <option value="define">{t("itemBinding.define")}</option>
        <option value="data">{t("itemBinding.data")}</option>
      </select>
      {linked ? (
        <>
          <select
            className="input text-xs"
            aria-label={t("itemBinding.source")}
            value={selected}
            onChange={(e) => onSource("item", e.target.value ? `{${e.target.value}}` : "")}
          >
            <option value="">{t("itemBinding.choose")}</option>
            {selected && !options.includes(selected) && (
              <option value={selected}>
                {selected.split(".").join(" → ")} ({t("itemBinding.custom")})
              </option>
            )}
            {options.map((path) => (
              <option key={path} value={path}>
                {path.split(".").join(" → ")}
              </option>
            ))}
          </select>
          {options.length === 0 && (
            <p className="text-xs text-[var(--text-mut)]">{t("itemBinding.empty")}</p>
          )}
          <div className="flex flex-col gap-1 text-xs" aria-live="polite">
            <span className="text-[var(--text-mut)]">{t("itemBinding.sample")}</span>
            {icon && (
              <img
                src={icon}
                alt=""
                className="h-8 w-8 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            )}
            <span>
              {resolved.material && !resolved.material.includes("{")
                ? resolved.material
                : t("itemBinding.unresolved")}
            </span>
            <div className="flex items-center justify-between gap-2">
              <span>
                {t("flow.countLabel")} : {resolved.count ?? 1} ·{" "}
                {t(
                  appearance.count === undefined
                    ? "itemBinding.inherited"
                    : "itemBinding.customized",
                )}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  onCount(appearance.count === undefined ? (base.count ?? 1) : undefined)
                }
              >
                {t(appearance.count === undefined ? "itemBinding.customize" : "itemBinding.reset")}
              </Button>
            </div>
            {base.enchants.length > 0 && (
              <span>
                {t("itemBinding.inheritedEnchants")} : {base.enchants.map(formatEnchant).join(", ")}
              </span>
            )}
          </div>
          <details className="text-xs text-[var(--text-mut)]">
            <summary className="cursor-pointer">{t("itemBinding.expression")}</summary>
            <Input
              aria-label={t("itemBinding.expression")}
              value={binding ?? ""}
              onChange={(e) => onSource("item", e.target.value)}
              className="mt-2 font-mono text-xs"
            />
          </details>
          <p className="text-xs text-[var(--text-mut)]">{t("itemBinding.presentation")}</p>
        </>
      ) : (
        children
      )}
    </section>
  );
}

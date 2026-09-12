import { Input } from "@/components/ui/input";
import { resolveDisplayRef } from "@/domain/capturedItems";
import type { Appearance, Element, Menu, Project } from "@/domain/types";
import { MaterialPicker } from "@/features/canvas/MaterialPicker";
import { previewItem } from "@/features/canvas/itemValuePreview";
import { useTextureUrl } from "@/features/canvas/textureStore";
import { useHeadPreviewUrl } from "@/features/canvas/useHeadPreviewUrl";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { listModules } from "@artisan/editor-sdk";
import { ChevronDown, ImageIcon } from "lucide-react";
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
  children,
}: {
  project: Project;
  menu?: Menu;
  element?: Element;
  appearance: Appearance;
  scope: Record<string, unknown>;
  lang: string;
  onSource: (field: "material" | "item", value: string) => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const sources = useServerDataSourcesStore((s) => s.sources);
  const models = Object.assign({}, ...listModules().map((m) => m.dataSourceModels ?? {}));
  const options = menu && element ? itemBindingOptions(project, menu, element, sources, models) : [];
  const binding =
    appearance.item ?? (appearance.material?.startsWith("{") ? appearance.material : undefined);
  const resolved = previewItem(appearance, scope, project, lang);
  const display = resolveDisplayRef(project, resolved.material ?? "");
  const texture = useTextureUrl(display.material);
  const icon = useHeadPreviewUrl(resolved.head ?? display.head) ?? texture;
  const label = (path: string) =>
    path === "item.icon"
      ? t("itemBinding.productIcon")
      : path === "cat.icon"
        ? t("itemBinding.categoryIcon")
        : path.split(".").join(" → ");
  const selected = binding?.replace(/^\{|\}$/g, "");
  return (
    <div className="flex flex-col gap-1.5">
      <span className="field-label">{t("itemBinding.title")}</span>
      <MaterialPicker
        projectId={project.id}
        dataItems={options.map((path) => ({ value: path, label: label(path) }))}
        onPickData={(path) => onSource("item", `{${path}}`)}
        onPick={(material) => onSource("material", material)}
        trigger={
          <button
            type="button"
            aria-label={t("itemBinding.title")}
            className="input flex h-11 w-full items-center gap-2 text-left text-sm"
          >
            {icon ? (
              <img
                src={icon}
                alt=""
                className="h-7 w-7 object-contain"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <ImageIcon size={20} className="shrink-0 text-[var(--text-faint)]" />
            )}
            <span className="min-w-0 flex-1 truncate">
              {selected ? label(selected) : appearance.material || t("itemBinding.choose")}
            </span>
            <ChevronDown size={14} className="shrink-0 text-[var(--text-mut)]" />
          </button>
        }
      />
      <details className="text-xs text-[var(--text-faint)]">
        <summary className="cursor-pointer">{t("itemBinding.expression")}</summary>
        <div className="mt-2">
          {binding !== undefined ? (
            <Input
              aria-label={t("itemBinding.expression")}
              value={binding}
              onChange={(e) => onSource("item", e.target.value)}
              className="font-mono text-xs"
            />
          ) : (
            children
          )}
        </div>
      </details>
    </div>
  );
}

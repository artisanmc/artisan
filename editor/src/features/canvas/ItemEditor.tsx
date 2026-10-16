import { RevealField } from "@/components/RevealField";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { resolveDisplayRef } from "@/domain/capturedItems";
import type { AdvancedFields } from "@/domain/itemAdvanced";
import { formatEnchant } from "@/domain/itemAdvanced";
import type { Project } from "@/domain/types";
import { AdvancedItemSection } from "@/features/canvas/item/AdvancedItemSection";
import { HeadField } from "@/features/canvas/item/ItemHeadField";
import { MiniMessageInline } from "@/lib/MiniMessageInline";
import type { PlaceholderEntry } from "@/lib/placeholderCatalog";
import { ImageIcon, Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ItemContextSidebar } from "./ItemContextSidebar";
import type { ResolvedItem } from "./resolveItem";
import { useTextureUrl } from "./textureStore";
import { useHeadPreviewUrl } from "./useHeadPreviewUrl";

export interface ItemEditorProps {
  project?: Project;
  details?: ReactNode;
  source: ReactNode;
  appearance: AdvancedFields & { count?: number; head?: string };
  onHead?: (value: string) => void;
  title?: string;
  lore?: string;
  titleLabel?: string;
  loreLabel?: string;
  inherited: ResolvedItem;
  preview: ResolvedItem;
  entries?: PlaceholderEntry[];
  /** `"replace"` = the base item's lore is dropped; absent = it is kept. */
  loreMode?: "replace";
  onLoreMode?: (value: "replace" | undefined) => void;
  onText: (field: "title" | "lore", value: string | undefined) => void;
  onCount: (value: number | undefined) => void;
  onAdvanced: (patch: AdvancedFields) => void;
  onFocus?: () => void;
}

/** Same item form in a source cell and a menu state; owners supply persistence. */
export function ItemEditor({
  project,
  details,
  source,
  appearance,
  title,
  lore,
  titleLabel,
  loreLabel,
  inherited,
  preview,
  entries = [],
  loreMode,
  onLoreMode,
  onText,
  onCount,
  onAdvanced,
  onHead,
  onFocus,
}: ItemEditorProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const display = project
    ? resolveDisplayRef(project, preview.material ?? "")
    : { material: preview.material, head: preview.head };
  const texture = useTextureUrl(display.material ?? "");
  const image = useHeadPreviewUrl(preview.head ?? display.head) ?? texture;
  const hasInherited = (field: "title" | "lore" | "count") =>
    field === "lore"
      ? inherited.lore.some((line) => line !== "")
      : field === "title"
        ? Boolean(inherited.title)
        : inherited.count !== undefined;
  const suggestions: PlaceholderEntry[] = [
    ...entries,
    ...["title", "lore", "count", "material"].map((field) => ({
      path: `base.${field}`,
      type: field === "count" ? ("integer" as const) : ("string" as const),
      origin: "context" as const,
      sample:
        field === "lore"
          ? inherited.lore.join("\n")
          : String(inherited[field as keyof ResolvedItem] ?? ""),
    })),
  ];
  const reset = (field: "title" | "lore" | "count", customized: boolean) =>
    customized ? (
      <button
        type="button"
        className="text-xs text-[var(--text-mut)] hover:text-[var(--text)]"
        aria-label={`${t(hasInherited(field) ? "itemBinding.reset" : "itemBinding.clearValue")} (${field})`}
        title={t(hasInherited(field) ? "itemBinding.reset" : "itemBinding.clearValue")}
        onClick={() => (field === "count" ? onCount(undefined) : onText(field, undefined))}
      >
        ↺
      </button>
    ) : hasInherited(field) ? (
      <span className="text-[10px] text-[var(--text-faint)]">{t("itemBinding.inherited")}</span>
    ) : null;
  function textField(field: "title" | "lore", own: string | undefined, label: string) {
    // The base lore already applies without writing anything: prefilling the
    // field with `{base.lore}` suggested it had to be asked for.
    const raw = own ?? (field === "title" && hasInherited(field) ? "{base.title}" : "");
    const shown = field === "title" ? (preview.title ?? "") : preview.lore.join("\n");
    return (
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center justify-between gap-2">
          <span className="field-label">{label}</span>
          {reset(field, own !== undefined)}
        </div>
        <RevealField
          value={raw}
          entries={suggestions}
          multiline={field === "lore"}
          rows={4}
          onChange={(value) => onText(field, value)}
          onActivate={onFocus}
          placeholder={field === "title" ? t("flow.titlePlaceholder") : t("flow.lorePlaceholder")}
          className={field === "title" ? "h-8 px-2 text-xs" : "min-h-16 px-2 py-1 text-xs"}
          facade={
            shown ? (
              <MiniMessageInline source={shown} className="whitespace-pre-wrap font-mono text-xs" />
            ) : (
              <span className="text-[var(--text-faint)]">
                {field === "title" ? t("flow.titlePlaceholder") : t("flow.lorePlaceholder")}
              </span>
            )
          }
          preview={
            <MiniMessageInline
              source={shown}
              className="mt-1 block whitespace-pre-wrap text-xs text-[var(--text-mut)]"
            />
          }
        />
        {field === "lore" && hasInherited("lore") && onLoreMode && (
          <label className="mt-1 flex items-center gap-2 text-xs text-[var(--text-mut)]">
            <input
              type="checkbox"
              checked={loreMode === "replace"}
              onChange={(e) => {
                onFocus?.();
                onLoreMode(e.target.checked ? "replace" : undefined);
              }}
            />
            {t("itemBinding.replaceLore")}
          </label>
        )}
        {field === "lore" && hasInherited("lore") && (
          <button
            type="button"
            className="btn btn-ghost mt-1 h-6 px-1 text-xs"
            onClick={() =>
              onText(
                "lore",
                own === undefined || own === "" ? "{base.lore}" : `${own}\n{base.lore}`,
              )
            }
          >
            {t("itemBinding.insertLore")}
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-w-56 flex-col gap-3" data-testid="item-editor">
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogTrigger asChild>
          <button
            type="button"
            aria-label={t("itemBinding.editItem")}
            className="card flex w-full items-start gap-3 p-3 text-left hover:border-[var(--border-strong)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand)]"
            onClick={() => {
              onFocus?.();
            }}
          >
            <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded bg-[var(--surface-inset)]">
              {image ? (
                <img
                  src={image}
                  alt=""
                  className="h-10 w-10 object-contain"
                  style={{ imageRendering: "pixelated" }}
                />
              ) : (
                <ImageIcon size={24} className="text-[var(--text-faint)]" />
              )}
              {(preview.count ?? 1) > 1 && (
                <span className="absolute bottom-0 right-1 font-mono text-xs">{preview.count}</span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <MiniMessageInline
                source={preview.title || display.material || t("itemBinding.choose")}
                className="block truncate text-sm font-medium"
              />
              {preview.title && (
                <span className="block truncate font-mono text-[10px] text-[var(--text-faint)]">
                  {display.material}
                </span>
              )}
              {preview.lore.length > 0 && (
                <MiniMessageInline
                  source={preview.lore.join("\n")}
                  className="mt-1 block line-clamp-3 whitespace-pre-wrap text-xs text-[var(--text-mut)]"
                />
              )}
              {(preview.enchants?.length ?? 0) > 0 && (
                <span className="mt-1 block truncate text-xs text-[var(--text-mut)]">
                  {preview.enchants?.map(formatEnchant).join(" · ")}
                </span>
              )}
              {preview.error && (
                <span role="alert" className="block text-xs text-[var(--danger)]">
                  {preview.error}
                </span>
              )}
            </span>
            <Pencil size={14} className="mt-1 shrink-0 text-[var(--text-faint)]" />
          </button>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
          className="flex h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden"
        >
          <DialogHeader className="shrink-0 pr-6">
            <DialogTitle>{t("itemBinding.editItem")}</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_17rem] md:grid-rows-[minmax(0,1fr)] md:overflow-hidden">
            <div className="flex min-h-0 min-w-0 shrink-0 flex-col gap-4 md:overflow-y-auto md:overscroll-contain">
              {source}
              {preview.error && (
                <p role="alert" className="text-xs text-[var(--danger)]">
                  {preview.error}
                </p>
              )}
              <div className="flex items-start gap-2">
                {textField("title", title, titleLabel ?? t("flow.titleLabel", { lang: "" }))}
                <div className="w-28 shrink-0">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="field-label">{t("flow.countLabel")}</span>
                    {reset("count", appearance.count !== undefined)}
                  </div>
                  <Input
                    type="number"
                    min={1}
                    max={64}
                    value={appearance.count ?? ""}
                    placeholder={String(inherited.count ?? 1)}
                    aria-label={t("flow.countLabel")}
                    className="h-8 px-2 text-xs"
                    onFocus={onFocus}
                    onChange={(e) => {
                      if (e.target.value === "") onCount(undefined);
                      else {
                        const n = Number(e.target.value);
                        if (Number.isInteger(n) && n >= 1 && n <= 64) onCount(n);
                      }
                    }}
                  />
                </div>
              </div>
              {textField("lore", lore, loreLabel ?? t("flow.loreLabel", { lang: "" }))}
              <AdvancedItemSection
                appearance={appearance}
                material={preview.material}
                inheritedEnchants={inherited.enchants}
                onChange={onAdvanced}
                onFocus={onFocus}
              />
              {details}
              {display.material?.toLowerCase() === "player_head" && onHead && (
                <HeadField head={appearance.head ?? ""} onChange={onHead} />
              )}
            </div>
            <ItemContextSidebar entries={suggestions} />
          </div>
          <DialogFooter className="shrink-0">
            <DialogClose asChild>
              <Button variant="secondary" size="sm" className="self-end">
                {t("itemBinding.done")}
              </Button>
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { useAssetInit } from "@/features/assets/useAssetInit";
import { CapturedItemsSection } from "@/features/canvas/CapturedItemsSection";
import { Library } from "@/features/canvas/Library";
import { useTextureInit } from "@/features/canvas/useTextureInit";
import { Library as LibraryIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type LibraryCategory, useProjectLibraryStore } from "./projectLibraryStore";

export function ProjectLibraryButton({
  projectId,
  onOpen,
  active = true,
}: { projectId: ProjectId; onOpen?: () => void; active?: boolean }) {
  const { t } = useTranslation();
  const open = useProjectLibraryStore((s) => s.projectId === projectId);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label={t("projectLibrary.title")}
      title={t("projectLibrary.title")}
      aria-expanded={open && active}
      onClick={() => {
        if (open && active) useProjectLibraryStore.getState().close();
        else {
          if (!open) useProjectLibraryStore.getState().open(projectId);
          onOpen?.();
        }
      }}
    >
      <LibraryIcon className="size-4" />
      <span className="hidden xl:inline">{t("projectLibrary.title")}</span>
    </Button>
  );
}

/** One catalogue host, shared by the board and document routes. */
export function ProjectLibraryWorkspace({
  projectId,
  children,
  active = true,
}: { projectId: ProjectId; children: ReactNode; active?: boolean }) {
  useTextureInit(projectId);
  useAssetInit(projectId);
  const open = useProjectLibraryStore((s) => s.projectId === projectId);
  const close = useProjectLibraryStore((s) => s.close);

  useEffect(() => {
    if (!open || !active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches?.("input, textarea, select") || target?.isContentEditable) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, active, close]);

  return (
    <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col lg:flex-row">
      <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
      {open && (
        <aside className="order-last flex h-[45%] min-h-0 shrink-0 flex-col border-t border-[var(--border)] bg-[var(--surface-raised)] lg:order-first lg:h-full lg:w-[340px] lg:border-t-0 lg:border-r">
          <ProjectLibraryPanel projectId={projectId} />
        </aside>
      )}
    </div>
  );
}

function ProjectLibraryPanel({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const category = useProjectLibraryStore((s) => s.category);
  const setCategory = useProjectLibraryStore((s) => s.setCategory);
  const close = useProjectLibraryStore((s) => s.close);
  const [itemsTab, setItemsTab] = useState<"items" | "captured">("items");

  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t("projectLibrary.title")}>
      <div className="flex h-12 shrink-0 items-center justify-between px-3">
        <h2 className="text-sm font-medium">{t("projectLibrary.title")}</h2>
        <Button variant="ghost" size="icon" onClick={close} aria-label={t("projectLibrary.close")}>
          <X className="size-4" />
        </Button>
      </div>
      <Tabs
        value={category}
        onValueChange={(v) => setCategory(v as LibraryCategory)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <TabsList className="shrink-0 px-3">
          <TabsTrigger value="items">{t("projectLibrary.items")}</TabsTrigger>
          <TabsTrigger value="graphics">{t("projectLibrary.graphics")}</TabsTrigger>
        </TabsList>
        <TabsContent
          value="items"
          className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3"
        >
          <div className="flex shrink-0 gap-1">
            <Button
              variant={itemsTab === "items" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={itemsTab === "items"}
              onClick={() => setItemsTab("items")}
            >
              {t("projectLibrary.catalogue")}
            </Button>
            <Button
              variant={itemsTab === "captured" ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={itemsTab === "captured"}
              onClick={() => setItemsTab("captured")}
            >
              {t("editorPane.subCaptured")}
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {itemsTab === "items" ? <Library /> : <CapturedItemsSection projectId={projectId} />}
          </div>
        </TabsContent>
        <TabsContent value="graphics" className="min-h-0 flex-1 overflow-hidden">
          <AssetsTab projectId={projectId} compact />
        </TabsContent>
      </Tabs>
    </section>
  );
}

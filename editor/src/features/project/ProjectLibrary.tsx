import { SplitPane } from "@/components/SplitPane";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { useAssetInit } from "@/features/assets/useAssetInit";
import { CapturedItemsSection } from "@/features/canvas/CapturedItemsSection";
import { ImageButtonLibrary } from "@/features/canvas/ImageButtonLibrary";
import { Library } from "@/features/canvas/Library";
import { useTextureInit } from "@/features/canvas/useTextureInit";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { useSelectionStore } from "@/state/selectionStore";
import { useUiStore } from "@/state/uiStore";
import { Library as LibraryIcon, Map as MapIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
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
      variant={open && active ? "secondary" : "ghost"}
      size="sm"
      className="min-h-11 lg:min-h-0"
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
      <span>{t("projectLibrary.title")}</span>
    </Button>
  );
}

/** One catalogue host, shared by the board and document routes. */
export function ProjectLibraryWorkspace({
  projectId,
  children,
  active = true,
  showMinimapToggle = true,
}: { projectId: ProjectId; children: ReactNode; active?: boolean; showMinimapToggle?: boolean }) {
  const { t } = useTranslation();
  const minimapVisible = useUiStore((s) => s.minimapVisible);
  useTextureInit(projectId);
  useAssetInit(projectId);
  const open = useProjectLibraryStore((s) => s.projectId === projectId);
  const close = useProjectLibraryStore((s) => s.close);
  const desktop = useIsDesktop();
  const width = useProjectLibraryStore((s) => s.width);
  const height = useProjectLibraryStore((s) => s.height);
  const setWidth = useProjectLibraryStore((s) => s.setWidth);
  const setHeight = useProjectLibraryStore((s) => s.setHeight);
  const frame = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState({ width: 1000, height: 600 });
  const horizontal = desktop && available.width >= 600;
  useEffect(() => {
    if (desktop || !open || !active) return;
    return useSelectionStore.subscribe((state, previous) => {
      if (state.ids !== previous.ids || state.menuId !== previous.menuId) close();
    });
  }, [desktop, open, active, close]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailable({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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
    <div ref={frame} className="absolute inset-0 min-h-0 min-w-0">
      <SplitPane
        animatePresence
        orientation={horizontal ? "horizontal" : "vertical"}
        secondaryPosition={horizontal ? "start" : "end"}
        primary={
          <div className="relative h-full min-h-0 min-w-0">
            {children}
            {active && (!open || (showMinimapToggle && !minimapVisible)) && (
              <div className="absolute right-3 top-3 z-30 flex items-center gap-1 rounded-[var(--r-md)] bg-[var(--surface)] p-1 shadow-[var(--shadow-sm)]">
                {!open && <ProjectLibraryButton projectId={projectId} />}
                {showMinimapToggle && !minimapVisible && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 lg:min-h-0"
                    aria-pressed={minimapVisible}
                    title={t("canvas.minimap")}
                    onClick={() => useUiStore.getState().setMinimapVisible(true)}
                  >
                    <MapIcon className="size-4" /> {t("canvas.minimap")}
                  </Button>
                )}
              </div>
            )}
          </div>
        }
        secondary={
          active && open ? (
            <aside className="h-full min-h-0 bg-[var(--surface-raised)]">
              <ProjectLibraryPanel projectId={projectId} />
            </aside>
          ) : null
        }
        secondarySize={
          horizontal
            ? Math.min(width, Math.max(0, available.width - 240))
            : Math.min(height, Math.max(0, available.height - 200))
        }
        onSecondarySizeChange={horizontal ? setWidth : setHeight}
        minPrimary={horizontal ? 240 : 200}
        minSecondary={horizontal ? 260 : 160}
      />
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
      <Tabs
        value={category}
        onValueChange={(v) => setCategory(v as LibraryCategory)}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex shrink-0 items-center gap-1 px-2 pt-2">
          <TabsList className="min-w-0 flex-1">
            <TabsTrigger value="items" className="px-2">
              {t("projectLibrary.items")}
            </TabsTrigger>
            <TabsTrigger value="graphics" className="px-2">
              {t("projectLibrary.graphics")}
            </TabsTrigger>
            <TabsTrigger value="image-buttons" className="px-2">
              {t("imageButton.library")}
            </TabsTrigger>
          </TabsList>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 shrink-0 lg:size-8"
            onClick={close}
            aria-label={t("projectLibrary.close")}
          >
            <X className="size-4" />
          </Button>
        </div>
        <TabsContent
          value="items"
          className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden px-2 pb-2 pt-1"
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
        <TabsContent value="image-buttons" className="min-h-0 flex-1 overflow-hidden">
          <ImageButtonLibrary projectId={projectId} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

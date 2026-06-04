import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PackId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { useAssetInit } from "@/features/assets/useAssetInit";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { type EditorTab, useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";
import { Library } from "./Library";
import { useTextureInit } from "./useTextureInit";

interface EditorPaneProps {
  packId: PackId;
}

/**
 * Resizable editor pane. Three tabs (Edit / Library / Assets). Tab labels are
 * flat with a sage underline on the active one — the editor pane background
 * uses the raised surface to feel slightly lifted from the canvas.
 */
export function EditorPane({ packId }: EditorPaneProps) {
  useTextureInit();
  useAssetInit(packId);
  const tab = useUiStore((s) => s.editorTab);
  const setTab = useUiStore((s) => s.setEditorTab);
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--surface-raised)]">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as EditorTab)}
        className="flex h-full min-h-0 flex-col"
      >
        <TabsList className="flex h-[42px] shrink-0 items-center justify-start gap-5 border-b border-[var(--border-soft)] px-4">
          <TabsTrigger value="edit">{t("editorPane.tabEdit")}</TabsTrigger>
          <TabsTrigger value="library">{t("editorPane.tabLibrary")}</TabsTrigger>
          <TabsTrigger value="assets">{t("editorPane.tabAssets")}</TabsTrigger>
        </TabsList>
        <TabsContent value="edit" className="min-h-0 flex-1 overflow-hidden">
          <FlowCanvas packId={packId} />
        </TabsContent>
        <TabsContent value="library" className="min-h-0 flex-1 p-3">
          <Library />
        </TabsContent>
        <TabsContent value="assets" className="h-full m-0 p-0">
          <AssetsTab packId={packId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

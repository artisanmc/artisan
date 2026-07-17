import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ProjectId } from "@/domain/types";
import { AssetsTab } from "@/features/assets/AssetsTab";
import { useAssetInit } from "@/features/assets/useAssetInit";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { type EditorTab, useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";
import { ItemSetsLibrary } from "./ItemSetsLibrary";
import { Library } from "./Library";
import { useTextureInit } from "./useTextureInit";

interface EditorPaneProps {
  projectId: ProjectId;
}

/**
 * Resizable editor pane. Three tabs (Edit / Library / Assets). Tab labels are
 * flat with a sage underline on the active one — the editor pane background
 * uses the raised surface to feel slightly lifted from the canvas.
 */
export function EditorPane({ projectId }: EditorPaneProps) {
  useTextureInit();
  useAssetInit(projectId);
  const tab = useUiStore((s) => s.editorTab);
  const setTab = useUiStore((s) => s.setEditorTab);
  const { t } = useTranslation();

  return (
    // No own border — the SplitPane separator hairline provides the visual edge.
    <div className="flex h-full min-h-0 flex-col">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as EditorTab)}
        className="flex h-full min-h-0 flex-col"
      >
        <TabsList className="flex h-[48px] shrink-0 items-center justify-start gap-1 px-3">
          <TabsTrigger value="edit">{t("editorPane.tabEdit")}</TabsTrigger>
          <TabsTrigger value="library">{t("editorPane.tabLibrary")}</TabsTrigger>
          <TabsTrigger value="sets">{t("editorPane.tabSets")}</TabsTrigger>
          <TabsTrigger value="assets">{t("editorPane.tabAssets")}</TabsTrigger>
        </TabsList>
        <TabsContent value="edit" className="min-h-0 flex-1 overflow-hidden">
          <FlowCanvas projectId={projectId} />
        </TabsContent>
        <TabsContent value="library" className="min-h-0 flex-1 p-3">
          <Library />
        </TabsContent>
        <TabsContent value="sets" className="min-h-0 flex-1 overflow-y-auto p-3">
          {/* Item sets — data-backed, template-rendered tiles; same
              drag-onto-slot gesture as the material library. */}
          <ItemSetsLibrary projectId={projectId} />
        </TabsContent>
        <TabsContent value="assets" className="h-full m-0 p-0">
          <AssetsTab projectId={projectId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

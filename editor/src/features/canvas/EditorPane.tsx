import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PackId } from "@/domain/types";
import { FlowCanvas } from "@/features/flow/FlowCanvas";
import { type EditorTab, useUiStore } from "@/state/uiStore";
import { useTranslation } from "react-i18next";
import { Library } from "./Library";
import { useTextureInit } from "./useTextureInit";

interface EditorPaneProps {
  packId: PackId;
}

const tabClass =
  // Flat underline-style tab — no rounded pill, no background. Active state
  // is just an emerald accent line under the label, mirroring the project's
  // accent color used elsewhere (selection, focus, expanded state). Several
  // `data-[state=active]:*` classes here exist only to cancel the default
  // shadcn TabsTrigger styling (background, shadow) applied by the primitive.
  "relative flex h-full items-center rounded-none px-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500 shadow-none transition-colors hover:text-zinc-200 data-[state=active]:bg-transparent data-[state=active]:text-zinc-100 data-[state=active]:shadow-none after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-transparent data-[state=active]:after:bg-emerald-500";

/**
 * Resizable editor pane. Two tabs (Edit / Library). Tab labels are flat
 * with an emerald underline on the active one — keeps the pane title-sized
 * row visually quiet so the editor body owns the eye.
 */
export function EditorPane({ packId }: EditorPaneProps) {
  useTextureInit();
  const tab = useUiStore((s) => s.editorTab);
  const setTab = useUiStore((s) => s.setEditorTab);
  const { t } = useTranslation();

  return (
    <div className="flex h-full min-h-0 flex-col bg-zinc-950">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as EditorTab)}
        className="flex h-full min-h-0 flex-col"
      >
        <TabsList className="flex h-9 shrink-0 items-center justify-start gap-5 border-zinc-800 border-b bg-transparent px-3">
          <TabsTrigger value="edit" className={tabClass}>
            {t("editorPane.tabEdit")}
          </TabsTrigger>
          <TabsTrigger value="library" className={tabClass}>
            {t("editorPane.tabLibrary")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="edit" className="min-h-0 flex-1 overflow-hidden">
          <FlowCanvas packId={packId} />
        </TabsContent>
        <TabsContent value="library" className="min-h-0 flex-1 p-3">
          <Library />
        </TabsContent>
      </Tabs>
    </div>
  );
}

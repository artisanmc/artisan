import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { PackId } from "@/domain/types";
import { useState } from "react";
import { Library } from "./Library";
import { PropertiesPane } from "./PropertiesPane";

interface RightSidebarProps {
  packId: PackId;
}

/**
 * Right-side combined panel: Properties (selection-driven) and Library
 * (vanilla MC item palette as drag sources). Wider than the v1 properties-only
 * pane so the item grid has room to breathe.
 */
export function RightSidebar({ packId }: RightSidebarProps) {
  const [tab, setTab] = useState<"properties" | "library">("properties");

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "properties" | "library")}
        className="flex h-full flex-col"
      >
        <TabsList className="mx-3 mt-3 grid grid-cols-2">
          <TabsTrigger value="properties">Properties</TabsTrigger>
          <TabsTrigger value="library">Library</TabsTrigger>
        </TabsList>
        <TabsContent value="properties" className="flex-1 overflow-y-auto p-3 pt-2">
          <PropertiesPane packId={packId} embedded />
        </TabsContent>
        <TabsContent value="library" className="min-h-0 flex-1 p-3 pt-2">
          <Library />
        </TabsContent>
      </Tabs>
    </aside>
  );
}

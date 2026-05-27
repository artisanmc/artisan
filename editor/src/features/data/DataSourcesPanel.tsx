import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { DataSourceId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DataSourceEditor } from "./DataSourceEditor";
import { DataSourcesSidebar } from "./DataSourcesSidebar";

interface DataSourcesPanelProps {
  packId: PackId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Inner content of the Data Sources panel — all hooks + UI, no Sheet chrome.
 * Used both by the modal wrapper (`DataSourcesPanel`) and the inline workspace tab.
 */
export function DataSourcesPanelContent({ packId }: { packId: PackId }) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const [selectedId, setSelectedId] = useState<DataSourceId | null>(null);

  const selected = pack && selectedId ? (pack.dataSources ?? []).find((d) => d.id === selectedId) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="text-zinc-100">{t("dataSources.title")}</div>
      </div>
      {!pack ? (
        <div className="p-4 text-zinc-400">{t("dataSources.packNotFound")}</div>
      ) : (
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <DataSourcesSidebar pack={pack} selectedId={selectedId} onSelect={setSelectedId} />
          <div className="flex min-h-0 flex-1 flex-col p-4">
            {selected ? (
              <DataSourceEditor packId={packId} source={selected} />
            ) : (
              <div className="mt-8 text-center text-sm text-zinc-500">
                {t("dataSources.selectHint")}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * @deprecated Use `DataSourcesPanelContent` for inline rendering.
 * This wrapper kept for backward compat — no callers after workspace migration.
 */
export function DataSourcesPanel({ packId, open, onOpenChange }: DataSourcesPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[780px] p-0 sm:max-w-[780px]">
        <DataSourcesPanelContent packId={packId} />
      </SheetContent>
    </Sheet>
  );
}

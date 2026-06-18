import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { DataSourceId, ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DataSourceEditor } from "./DataSourceEditor";
import { DataSourcesSidebar } from "./DataSourcesSidebar";

interface DataSourcesPanelProps {
  projectId: ProjectId;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Inner content of the Data Sources panel — all hooks + UI, no Sheet chrome.
 * Used both by the modal wrapper (`DataSourcesPanel`) and the inline workspace tab.
 */
export function DataSourcesPanelContent({ projectId }: { projectId: ProjectId }) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  const [selectedId, setSelectedId] = useState<DataSourceId | null>(null);

  const selected = pack && selectedId ? (pack.dataSources ?? []).find((d) => d.id === selectedId) : null;

  if (!pack) {
    return (
      <div className="card flex min-h-0 flex-1 items-center justify-center p-6">
        <p className="text-[var(--text-mut)]">{t("dataSources.projectNotFound")}</p>
      </div>
    );
  }

  return (
    <>
      {/* Left card — sources list */}
      <div className="card flex shrink-0 flex-col overflow-hidden lg:w-[224px]">
        <DataSourcesSidebar pack={pack} selectedId={selectedId} onSelect={setSelectedId} />
      </div>

      {/* Right card — editor or empty state */}
      <main className="card flex min-h-0 flex-1 flex-col overflow-auto p-6 md:p-8">
        {selected ? (
          <DataSourceEditor projectId={projectId} source={selected} />
        ) : (
          <div className="mt-8 text-center text-sm text-[var(--text-faint)]">
            {t("dataSources.selectHint")}
          </div>
        )}
      </main>
    </>
  );
}

/**
 * @deprecated Use `DataSourcesPanelContent` for inline rendering.
 * This wrapper kept for backward compat — no callers after workspace migration.
 */
export function DataSourcesPanel({ projectId, open, onOpenChange }: DataSourcesPanelProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full max-w-[780px] p-0 sm:max-w-[780px]">
        <DataSourcesPanelContent projectId={projectId} />
      </SheetContent>
    </Sheet>
  );
}

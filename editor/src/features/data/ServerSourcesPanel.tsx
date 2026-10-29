import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ServerSourceDetail } from "./ServerSourceDetail";
import { ServerSourcesSection } from "./ServerSourcesSection";

/**
 * The data sources the server's modules declare (`auctions:listings`…), in the server
 * page's Data tab: read-only references a menu reads, grouped by module, with the selected one's
 * schema and a live preview. Their rows are the server's live state — the last
 * deployed version, never a draft.
 */
export function ServerSourcesPanel({ serverKeyId }: { serverKeyId: string }) {
  const { t } = useTranslation();
  const sources = useServerDataSourcesStore((s) => s.sources);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const selected = sources.find((s) => s.ref === selectedRef) ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
      <div className="card max-h-[28rem] shrink-0 overflow-y-auto p-3 lg:max-h-none lg:w-[260px]">
        <ServerSourcesSection selectedRef={selectedRef} onSelect={setSelectedRef} />
      </div>
      <div className="card min-h-0 min-w-0 flex-1 overflow-auto p-5">
        {selected ? (
          <ServerSourceDetail serverId={serverKeyId} source={selected} />
        ) : (
          <p className="mt-6 text-center text-sm text-[var(--text-faint)]">
            {t(sources.length > 0 ? "dataSources.selectHint" : "dataSources.noServerSources")}
          </p>
        )}
      </div>
    </div>
  );
}

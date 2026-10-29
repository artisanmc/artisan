import { SERVER_SOURCES_ANCHOR } from "@/lib/projectNavigation";
import { useServerDataSourcesStore } from "@/state/serverDataSourcesStore";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ServerSourceDetail } from "./ServerSourceDetail";
import { ServerSourcesSection } from "./ServerSourcesSection";

/**
 * The data sources the server's modules declare (`auctions:listings`…), on the server
 * page: read-only references a menu reads, grouped by module, with the selected one's
 * schema and a live preview. Their rows are the server's live state — the last
 * deployed version, never a draft.
 */
export function ServerSourcesPanel({ serverKeyId }: { serverKeyId: string }) {
  const { t } = useTranslation();
  const sources = useServerDataSourcesStore((s) => s.sources);
  const [selectedRef, setSelectedRef] = useState<string | null>(null);
  const selected = sources.find((s) => s.ref === selectedRef) ?? null;
  // Reached by a "See the sources" link: the section renders once the server answered,
  // after the router's own hash scroll — bring it into view then.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.location.hash === `#${SERVER_SOURCES_ANCHOR}`) root.current?.scrollIntoView();
  }, []);
  return (
    <div ref={root} className="flex flex-col gap-3 lg:flex-row">
      <div className="card max-h-[28rem] shrink-0 overflow-y-auto p-3 lg:w-[240px]">
        <ServerSourcesSection selectedRef={selectedRef} onSelect={setSelectedRef} />
      </div>
      <div className="card min-w-0 flex-1 p-5">
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

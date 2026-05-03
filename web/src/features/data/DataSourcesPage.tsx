import type { DataSourceId, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DataSourceEditor } from "./DataSourceEditor";
import { DataSourcesSidebar } from "./DataSourcesSidebar";

interface DataSourcesPageProps {
  packId: PackId;
}

export function DataSourcesPage({ packId }: DataSourcesPageProps) {
  const { t } = useTranslation();
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));
  const [selectedId, setSelectedId] = useState<DataSourceId | null>(null);

  if (!pack) {
    return <div className="p-4 text-zinc-400">{t("dataSources.packNotFound")}</div>;
  }

  const selected = selectedId ? pack.dataSources.find((d) => d.id === selectedId) : null;

  return (
    <div className="flex h-full bg-zinc-950 text-zinc-100">
      <DataSourcesSidebar pack={pack} selectedId={selectedId} onSelect={setSelectedId} />
      <div className="flex-1 overflow-y-auto p-4">
        {selected ? (
          <DataSourceEditor packId={packId} source={selected} />
        ) : (
          <div className="text-zinc-500">{t("dataSources.selectHint")}</div>
        )}
      </div>
    </div>
  );
}

import type { PackId } from "@/domain/types";
import { DataSourcesPage } from "@/features/data/DataSourcesPage";
import { createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId/data")({
  component: DataPageRoute,
});

function DataPageRoute() {
  const { packId } = useParams({ from: "/pack/$packId/data" });
  return <DataSourcesPage packId={packId as PackId} />;
}

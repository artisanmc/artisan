import type { ProjectId } from "@/domain/types";
import { DataSourceView } from "@/features/data/DataSourceView";
import { ResolvedProjectContext } from "@/features/project/ResolvedProjectContext";
import { createFileRoute, useParams } from "@tanstack/react-router";
import { useContext } from "react";

/** One of a Project's own data sources, opened from the sidebar: `…/projects/main/data/speakers`. */
export const Route = createFileRoute("/servers/$serverId/projects/$projectId/data/$dataSourceId")({
  component: DataSourceRoute,
});

function DataSourceRoute() {
  const { projectId, dataSourceId } = useParams({
    from: "/servers/$serverId/projects/$projectId/data/$dataSourceId",
  });
  // The parent page resolves the URL's folder name to the Project's id.
  const resolvedId = useContext(ResolvedProjectContext) ?? (projectId as ProjectId);
  return <DataSourceView projectId={resolvedId} dataSourceId={dataSourceId} />;
}

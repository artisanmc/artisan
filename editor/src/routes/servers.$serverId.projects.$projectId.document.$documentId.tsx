import { createFileRoute, useParams } from "@tanstack/react-router";
import type { ElementId, ProjectId } from "@/domain/types";
import { DocumentView } from "@/features/project/DocumentView";

export const Route = createFileRoute("/servers/$serverId/projects/$projectId/document/$documentId")(
  { component: DocumentRoute },
);

function DocumentRoute() {
  const { projectId, documentId } = useParams({
    from: "/servers/$serverId/projects/$projectId/document/$documentId",
  });
  return <DocumentView projectId={projectId as ProjectId} documentId={documentId as ElementId} />;
}

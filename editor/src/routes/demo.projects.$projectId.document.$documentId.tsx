import type { ElementId, ProjectId } from "@/domain/types";
import { DocumentView } from "@/features/project/DocumentView";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/demo/projects/$projectId/document/$documentId")({
  component: DocumentPage,
});
function DocumentPage() {
  const { projectId, documentId } = Route.useParams();
  return <DocumentView projectId={projectId as ProjectId} documentId={documentId as ElementId} />;
}

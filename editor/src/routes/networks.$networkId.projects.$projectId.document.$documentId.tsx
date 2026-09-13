import { createFileRoute } from "@tanstack/react-router";
import { DocumentView } from "@/features/project/DocumentView";
import type { ElementId, ProjectId } from "@/domain/types";
export const Route = createFileRoute("/networks/$networkId/projects/$projectId/document/$documentId")({ component: DocumentPage });
function DocumentPage() {
  const { projectId, documentId } = Route.useParams();
  return <DocumentView projectId={projectId as ProjectId} documentId={documentId as ElementId} />;
}

import type { ProjectId } from "@/domain/types";
import { ProjectScreenView } from "@/features/screens/ProjectScreenView";
import { createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/servers/$serverId/projects/$projectId/screen/$screenId")({
  component: ProjectScreenRoute,
});

function ProjectScreenRoute() {
  const { projectId, screenId } = useParams({
    from: "/servers/$serverId/projects/$projectId/screen/$screenId",
  });
  return <ProjectScreenView projectId={projectId as ProjectId} screenId={screenId} />;
}

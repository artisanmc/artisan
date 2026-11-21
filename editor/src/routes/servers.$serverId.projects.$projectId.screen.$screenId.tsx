import type { ProjectId } from "@/domain/types";
import { ProjectScreenView } from "@/features/screens/ProjectScreenView";
import { projectDestination } from "@/lib/projectNavigation";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback } from "react";

export const Route = createFileRoute("/servers/$serverId/projects/$projectId/screen/$screenId")({
  component: ProjectScreenRoute,
});

function ProjectScreenRoute() {
  const { serverId, projectId, screenId } = useParams({
    from: "/servers/$serverId/projects/$projectId/screen/$screenId",
  });
  const navigate = useNavigate();
  const toProject = useCallback(
    () => navigate({ ...projectDestination(projectId, serverId), search: { tab: "board" } }),
    [navigate, projectId, serverId],
  );
  return (
    <ProjectScreenView
      projectId={projectId as ProjectId}
      screenId={screenId}
      toProject={toProject}
    />
  );
}

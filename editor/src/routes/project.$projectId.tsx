import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserProject, getNetworkOfProject } from "@/lib/api/userProjects";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectRedirect,
});

// Legacy redirect: old /workspace/$id and /project/$id URLs map to the new server-scoped URL.
function ProjectRedirect() {
  const { projectId } = useParams({ from: "/project/$projectId" });
  const { t } = useTranslation();
  const [dest, setDest] = useState<{ networkId: string; serverId: string } | null>(null);

  useEffect(() => {
    // Fetch the project to discover its network + server.
    loadUserProject(projectId)
      .then((res) => {
        if (res.networkId && res.serverKeyId) {
          setDest({ networkId: res.networkId, serverId: res.serverKeyId });
          return;
        }
        return getNetworkOfProject(projectId).then((networkId) => {
          if (networkId && res.serverKeyId) {
            setDest({ networkId, serverId: res.serverKeyId });
          }
        });
      })
      .catch(console.error);
  }, [projectId]);

  if (!dest) {
    return (
      <div className="flex h-full items-center justify-center text-[var(--text-mut)] text-[13px]">
        {t("redirect.redirecting", "Redirecting…")}
      </div>
    );
  }

  return (
    <Navigate
      to="/networks/$networkId/servers/$serverId/projects/$projectId"
      params={{
        networkId: dest.networkId,
        serverId: dest.serverId,
        projectId,
      }}
      replace
    />
  );
}

export default ProjectRedirect;

import { projectUrlId } from "@/lib/projectUrlId";
import { createFileRoute, useParams, Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { loadUserProject } from "@/lib/api/userProjects";
import { projectDestination } from "@/lib/projectNavigation";

export const Route = createFileRoute("/project/$projectId")({
  component: ProjectRedirect,
});

// Legacy redirect: old /workspace/$id and /project/$id URLs map to the new server-scoped URL.
function ProjectRedirect() {
  const { projectId } = useParams({ from: "/project/$projectId" });
  const { t } = useTranslation();
  const [dest, setDest] = useState<{ networkId: string | null; serverId: string | null; projectId: string } | null>(null);

  useEffect(() => {
    // Fetch the project to discover its network + server.
    loadUserProject(projectId)
      .then((res) => {
        setDest({ networkId: res.networkId, serverId: res.serverKeyId, projectId: projectUrlId(res.project) });
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
      {...projectDestination(dest.networkId, dest.projectId, dest.serverId)}
      replace
    />
  );
}

export default ProjectRedirect;

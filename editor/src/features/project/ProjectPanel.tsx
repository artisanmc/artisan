import type { ProjectId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useNavigate, useParams } from "@tanstack/react-router";
import { ProjectDocumentTree } from "./ProjectDocumentTree";
import { goToDocument } from "./goToDocument";

/** Le registre du project dans le panneau de droite (rendu partagé : `ProjectDocumentTree`). */
export function ProjectPanel({ projectId }: { projectId: ProjectId }) {
  const navigate = useNavigate();
  const params = useParams({ strict: false }) as { networkId?: string; serverId?: string };
  const project = useAccountStore((s) => s.account.projects.find((p) => p.id === projectId));
  if (!project) return null;

  return (
    <nav className="flex h-full flex-col overflow-auto p-2">
      <ProjectDocumentTree
        projectId={projectId}
        onOpen={(id) =>
          goToDocument(navigate, {
            networkId: params.networkId,
            serverId: params.serverId,
            project,
            ref: id,
          })
        }
      />
    </nav>
  );
}

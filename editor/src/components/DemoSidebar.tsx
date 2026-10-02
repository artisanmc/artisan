import { ArtisanWordmark } from "@/components/ArtisanWordmark";
import { ProjectDocumentTree } from "@/features/project/ProjectDocumentTree";
import { goToDocument } from "@/features/project/goToDocument";
import { projectUrlId } from "@/lib/projectUrlId";
import { useAccountStore } from "@/state/accountStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { Link, useNavigate, useParams } from "@tanstack/react-router";

/**
 * La barre de gauche de la démo : pas de compte, pas de serveur, donc pas de
 * liste de projects — seulement les Documents du project de démo, qui n'ont
 * plus d'autre place depuis le retrait du panneau de droite.
 */
export function DemoSidebar() {
  const navigate = useNavigate();
  const { projectId } = useParams({ strict: false }) as { projectId?: string };
  const project = useAccountStore((s) =>
    s.account.projects.find((p) => p.id === projectId || projectUrlId(p) === projectId),
  );
  return (
    <nav className="flex h-full flex-col gap-3.5 px-3 py-2">
      <Link
        to="/"
        onClick={() => useSidebarStore.getState().close()}
        className="flex h-12 shrink-0 items-center gap-1 rounded-[10px] px-1.5 transition-colors hover:bg-[var(--surface-hover)]"
      >
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="size-7 shrink-0"
        />
        <ArtisanWordmark />
      </Link>
      {project && (
        <div data-tour="elements" className="min-h-0 flex-1 overflow-auto">
          <ProjectDocumentTree
            projectId={project.id}
            onOpen={(documentId) => {
              useSidebarStore.getState().close();
              goToDocument(navigate, {
                networkId: undefined,
                serverId: undefined,
                project,
                ref: documentId,
              });
            }}
          />
        </div>
      )}
    </nav>
  );
}

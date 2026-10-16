import type { Project } from "@/domain/types";
import { OPEN_ELEMENT_EVENT } from "@/features/canvas/canvasEvents";
import type { ProjectRenamed } from "@/features/project/onProjectRenamed";
import { documentDestination, projectDestination } from "@/lib/projectNavigation";
import { projectUrlId } from "@/lib/projectUrlId";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { goToDocument } from "./goToDocument";

/**
 * Keeps the workspace URL in step with the Project: the `?doc=` deep link, the
 * canonical folder ID, a rename of the folder, and the "open this Document"
 * event of the board nodes.
 */
export function useProjectDeepLinks({
  project,
  urlId,
  projectId,
  serverId,
  documentId,
  doc,
}: {
  project: Project | null;
  /** The canonical folder ID the loader resolved, if any. */
  urlId: string | null;
  /** The project segment of the current URL. */
  projectId: string;
  serverId: string | undefined;
  documentId: string | undefined;
  /** `?doc=`: center the board on this Document on open. */
  doc: string | undefined;
}): void {
  const navigate = useNavigate();

  // `?doc=` deep link (another project's tree, overview board, palette): once
  // the project is loaded, center its board on the Document. goToDocument
  // removes the parameter, so a reload does not re-center.
  const loadedId = project?.id;
  // biome-ignore lint/correctness/useExhaustiveDependencies: reacts to the link and the load, not to every project edit.
  useEffect(() => {
    if (!doc || !project) return;
    goToDocument(navigate, { serverId, project, ref: doc });
  }, [doc, loadedId]);

  const canonicalId = urlId ?? (project ? projectUrlId(project) : null);
  useEffect(() => {
    if (!canonicalId || canonicalId === projectId) return;
    void navigate({
      ...projectDestination(canonicalId, serverId, documentId),
      replace: true,
      search: (previous) => previous,
      hash: true,
    });
  }, [canonicalId, projectId, serverId, documentId, navigate]);

  // The folder is the Project's identity: once renamed, it opens under its new name.
  useEffect(() => {
    const renamed = (raw: Event) => {
      const { previousDiskId, diskId } = (raw as CustomEvent<ProjectRenamed>).detail;
      if (previousDiskId !== projectId) return;
      void navigate({ ...projectDestination(diskId, serverId), replace: true });
    };
    window.addEventListener("ifz:project_renamed", renamed);
    return () => window.removeEventListener("ifz:project_renamed", renamed);
  }, [projectId, serverId, navigate]);

  // Open the individual element view on double-click (dispatched from board nodes).
  // A qualified ref (`boutique:main`, from a link chip) opens the project it names.
  useEffect(() => {
    function onOpen(e: Event) {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (id && project) navigate(documentDestination(project, serverId, id));
    }
    window.addEventListener(OPEN_ELEMENT_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_ELEMENT_EVENT, onOpen);
  }, [serverId, project, navigate]);
}

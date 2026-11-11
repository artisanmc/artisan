import { Spinner } from "@/components/ui/spinner";
import type { ProjectId } from "@/domain/types";
import { CollectionView } from "@/features/screens/CollectionView";
import { collectionKindOfDir } from "@/lib/documentCollections";
import { useModulesStore } from "@/state/modulesStore";
import { createFileRoute, useParams } from "@tanstack/react-router";

/** A collection's page at its kind's folder name: `…/projects/boutique_addon/catalogue`. */
export const Route = createFileRoute("/servers/$serverId/projects/$projectId/$collectionDir")({
  component: CollectionRoute,
});

function CollectionRoute() {
  const { projectId, collectionDir } = useParams({
    from: "/servers/$serverId/projects/$projectId/$collectionDir",
  });
  // A module's kind exists once its editor view is mounted, after the page opened on a
  // reload or a link: re-rendered when the modules settle, it is not "not found" meanwhile.
  const status = useModulesStore((s) => s.status);
  const kind = collectionKindOfDir(collectionDir);
  if (!kind && status !== "ready") {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Spinner />
      </div>
    );
  }
  return <CollectionView projectId={projectId as ProjectId} kind={kind ?? collectionDir} />;
}

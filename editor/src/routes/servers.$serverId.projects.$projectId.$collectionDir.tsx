import type { ProjectId } from "@/domain/types";
import { CollectionView } from "@/features/screens/CollectionView";
import { collectionKindOfDir } from "@/lib/documentCollections";
import { createFileRoute, useParams } from "@tanstack/react-router";

/** A collection's page at its kind's folder name: `…/projects/boutique_addon/catalogue`. */
export const Route = createFileRoute("/servers/$serverId/projects/$projectId/$collectionDir")({
  component: CollectionRoute,
});

function CollectionRoute() {
  const { projectId, collectionDir } = useParams({
    from: "/servers/$serverId/projects/$projectId/$collectionDir",
  });
  return (
    <CollectionView
      projectId={projectId as ProjectId}
      kind={collectionKindOfDir(collectionDir) ?? collectionDir}
    />
  );
}

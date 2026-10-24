import type { ProjectId } from "@/domain/types";
import { CollectionView } from "@/features/screens/CollectionView";
import { createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/servers/$serverId/projects/$projectId/collection/$collectionKind",
)({
  component: CollectionRoute,
});

function CollectionRoute() {
  const { projectId, collectionKind } = useParams({
    from: "/servers/$serverId/projects/$projectId/collection/$collectionKind",
  });
  return <CollectionView projectId={projectId as ProjectId} kind={collectionKind} />;
}

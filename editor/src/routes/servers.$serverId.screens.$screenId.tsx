import { ConfigScreenPage } from "@/features/screens/ConfigScreenPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/servers/$serverId/screens/$screenId",
)({
  component: ScreenRoute,
});

function ScreenRoute() {
  const { serverId, screenId } = Route.useParams();
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
      <ConfigScreenPage serverId={serverId} screenId={screenId} />
    </div>
  );
}

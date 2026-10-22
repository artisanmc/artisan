import { SystemCommandPage } from "@/components/SystemCommandPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/servers/$serverId/commands/$commandId")({
  component: CommandRoute,
});

function CommandRoute() {
  const { serverId, commandId } = Route.useParams();
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
      <SystemCommandPage serverId={serverId} commandId={commandId} />
    </div>
  );
}

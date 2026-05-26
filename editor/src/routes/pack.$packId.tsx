// editor/src/routes/pack.$packId.tsx
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

export const Route = createFileRoute("/pack/$packId")({ component: LegacyPackRedirect });

function LegacyPackRedirect() {
  const { packId } = Route.useParams();
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/workspace/$workspaceId", params: { workspaceId: packId }, replace: true });
  }, [packId, navigate]);
  return null;
}

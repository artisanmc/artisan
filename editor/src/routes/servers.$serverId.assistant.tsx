import { AssistantPage } from "@/features/assistant/AssistantPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/servers/$serverId/assistant")({
  component: AssistantPage,
});

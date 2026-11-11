import { PlayPage, validatePlaySearch } from "@/features/play/PlayPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/servers/$serverId/play")({
  component: PlayPage,
  validateSearch: validatePlaySearch,
});

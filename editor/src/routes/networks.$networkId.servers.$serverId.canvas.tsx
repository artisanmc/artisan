import {
  ServerCanvasPage,
  validateServerCanvasSearch,
} from "@/features/serverCanvas/ServerCanvasPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/networks/$networkId/servers/$serverId/canvas")({
  component: ServerCanvasPage,
  validateSearch: validateServerCanvasSearch,
});

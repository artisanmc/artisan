import { createFileRoute } from "@tanstack/react-router";
import { ProjectCanvasPage, validateProjectSearch } from "@/features/project/ProjectWorkspace";
export { ProjectCanvasPage } from "@/features/project/ProjectWorkspace";
export { ProjectCanvasPage as ServerProjectPage } from "@/features/project/ProjectWorkspace";
export const Route = createFileRoute("/networks/$networkId/servers/$serverId/projects/$projectId")({ component: ProjectCanvasPage, validateSearch: validateProjectSearch });

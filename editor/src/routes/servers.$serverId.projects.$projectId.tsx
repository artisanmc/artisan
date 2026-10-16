import { createFileRoute } from "@tanstack/react-router";
import { ProjectCanvasPage, validateProjectSearch } from "@/features/project/ProjectCanvasPage";
export { ProjectCanvasPage } from "@/features/project/ProjectCanvasPage";
export { ProjectCanvasPage as ServerProjectPage } from "@/features/project/ProjectCanvasPage";
export const Route = createFileRoute("/servers/$serverId/projects/$projectId")({ component: ProjectCanvasPage, validateSearch: validateProjectSearch });

import { createFileRoute } from "@tanstack/react-router";
import { ProjectCanvasPage, validateProjectSearch } from "@/features/project/ProjectWorkspace";
export const Route = createFileRoute("/networks/$networkId/projects/$projectId")({ component: ProjectCanvasPage, validateSearch: validateProjectSearch });

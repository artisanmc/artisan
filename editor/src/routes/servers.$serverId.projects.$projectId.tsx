import { themeImporter } from "@/features/import/themeImporter";
import { ProjectCanvasPage, validateProjectSearch } from "@/features/project/ProjectCanvasPage";
import { createFileRoute } from "@tanstack/react-router";
export { ProjectCanvasPage } from "@/features/project/ProjectCanvasPage";

/** A module, or a theme, of a server: its page, whose Resources import a theme too. */
export function ServerProjectPage() {
  return <ProjectCanvasPage importTheme={themeImporter} />;
}

export const Route = createFileRoute("/servers/$serverId/projects/$projectId")({
  component: ServerProjectPage,
  validateSearch: validateProjectSearch,
});

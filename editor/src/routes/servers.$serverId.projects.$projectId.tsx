import { themeImporter } from "@/features/import/themeImporter";
import { ProjectCanvasPage, validateProjectSearch } from "@/features/project/ProjectCanvasPage";
import { useServerPlaceHeader } from "@/features/serverPage/placeHeader";
import { createFileRoute } from "@tanstack/react-router";
export { ProjectCanvasPage } from "@/features/project/ProjectCanvasPage";

/** A module, or a theme, of a server: its page, whose Resources import a theme too. */
export function ServerProjectPage() {
  // The library and a theme are places of the server's resources: they keep its header.
  const placeHeader = useServerPlaceHeader();
  return <ProjectCanvasPage importTheme={themeImporter} placeHeader={placeHeader} />;
}

export const Route = createFileRoute("/servers/$serverId/projects/$projectId")({
  component: ServerProjectPage,
  validateSearch: validateProjectSearch,
});

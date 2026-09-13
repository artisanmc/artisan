import { DemoWorkspace } from "@/features/demo/DemoWorkspace";
import { validateProjectSearch } from "@/features/project/ProjectWorkspace";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/demo/projects/$projectId")({
  component: DemoWorkspace,
  validateSearch: validateProjectSearch,
});

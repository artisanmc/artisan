import { PackGrid } from "@/features/account/PackGrid";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: PackGrid,
});

import { DemoEntry } from "@/features/demo/DemoWorkspace";
import { createFileRoute } from "@tanstack/react-router";
export const Route = createFileRoute("/demo/")({ component: DemoEntry });

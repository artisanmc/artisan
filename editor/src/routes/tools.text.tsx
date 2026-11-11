import { TextToolPage } from "@/features/tools/TextToolPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/tools/text")({ component: TextToolPage });

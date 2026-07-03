import { AiLogsPage } from "@/features/admin/AiLogsPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/ai_/usage_/logs")({
  component: () => (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
        <AiLogsPage />
      </div>
    </div>
  ),
});

import { AiModelsPage } from "@/features/admin/AiModelsPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/ai")({
  component: () => (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
        <AiModelsPage />
      </div>
    </div>
  ),
});

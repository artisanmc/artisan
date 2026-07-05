import { BillingPage } from "@/features/admin/billing/BillingPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/admin/billing")({
  component: () => (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-12">
        <BillingPage />
      </div>
    </div>
  ),
});

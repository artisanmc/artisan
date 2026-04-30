import { useAccountStore } from "@/state/accountStore";
import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const firstPackId = useAccountStore((s) => s.account.packOrder[0]);
  if (!firstPackId) {
    // Empty-state CTA refined in Task 10. For now an inline placeholder.
    return (
      <div className="flex h-screen items-center justify-center text-zinc-500">
        No packs yet. (Empty state CTA arrives in Task 10.)
      </div>
    );
  }
  return <Navigate to="/pack/$packId" params={{ packId: firstPackId }} replace />;
}

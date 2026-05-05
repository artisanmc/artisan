import { EmptyState } from "@/features/canvas/EmptyState";
import { useAccountStore } from "@/state/accountStore";
import { useUiStore } from "@/state/uiStore";
import { Navigate, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: IndexRedirect,
});

function IndexRedirect() {
  const packs = useAccountStore((s) => s.account.packs);
  const packOrder = useAccountStore((s) => s.account.packOrder);
  const lastActive = useUiStore((s) => s.lastActivePackId);

  if (packs.length === 0) return <EmptyState />;

  const lastIsValid = lastActive && packs.some((p) => p.id === lastActive);
  const target = lastIsValid ? lastActive : packOrder[0];
  if (!target) return <EmptyState />;
  return <Navigate to="/pack/$packId" params={{ packId: target }} replace />;
}

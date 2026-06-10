import { useAuthStore } from "@/state/authStore";
import { Outlet, createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin")({ component: AdminLayout });

/**
 * Layout for /admin/* — gates on isAdmin once, child pages render in the
 * Outlet. Navigation lives in the AdminSidebar (swapped in by __root.tsx),
 * not in tabs.
 */
function AdminLayout() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const loading = useAuthStore((s) => s.isLoading);

  // Wait for hydration before gating, otherwise an admin briefly sees "forbidden"
  // while /me is still in flight (mirrors account.tsx's component-level gate).
  if (loading) return null;
  if (!user?.isAdmin) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-[var(--text-mut)]">
        {t("admin.forbidden")}
      </div>
    );
  }

  return <Outlet />;
}

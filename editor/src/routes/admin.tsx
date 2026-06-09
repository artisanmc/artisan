import { AssistantConfigForm } from "@/features/admin/AssistantConfigForm";
import { useAuthStore } from "@/state/authStore";
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin")({ component: AdminPage });

function AdminPage() {
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

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
        <h1
          className="display text-[32px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("admin.title")}
        </h1>
        {/* v1: a single "AI" tab. Add more tabs (users, logs) here later. */}
        <nav className="flex gap-2 border-b border-[var(--border-soft)]">
          <span className="border-b-2 border-[var(--brand)] pb-2 text-sm text-[var(--text)]">
            {t("admin.tabs.ai")}
          </span>
        </nav>
        <AssistantConfigForm />
      </div>
    </div>
  );
}

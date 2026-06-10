import { UsersList } from "@/features/admin/UsersList";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/users/")({ component: AdminUsersPage });

function AdminUsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
        <h1
          className="display text-[32px] tracking-tight text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("admin.users.title")}
        </h1>
        <UsersList
          onSelect={(id) => void navigate({ to: "/admin/users/$userId", params: { userId: id } })}
        />
      </div>
    </div>
  );
}

import { UserProfile } from "@/features/admin/UserProfile";
import { Link, createFileRoute } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/admin/users/$userId")({ component: AdminUserPage });

function AdminUserPage() {
  const { t } = useTranslation();
  const { userId } = Route.useParams();
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-8 py-12">
        <Link
          to="/admin/users"
          className="flex w-fit items-center gap-1 rounded-[8px] text-[12.5px] text-[var(--text-mut)] transition-colors hover:text-[var(--text)]"
        >
          <ChevronLeft className="size-[14px]" />
          {t("admin.users.back")}
        </Link>
        <UserProfile userId={userId} />
      </div>
    </div>
  );
}

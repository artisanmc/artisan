import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { type AdminUserDto, listAdminUsers } from "@/lib/api/adminUsers";
import { Search, Users } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

/**
 * Admin users list: search box (debounced) + one row per user. Selection is
 * delegated to the parent (the route navigates to /admin/users/$userId) so
 * the component stays router-free and easy to test.
 */
export function UsersList({ onSelect }: { onSelect: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<AdminUserDto[] | null>(null); // null = loading

  useEffect(() => {
    let cancelled = false;
    // Debounce keystrokes; also delays the initial load by 250ms, which is fine.
    const timer = setTimeout(() => {
      listAdminUsers(q).then((u) => {
        if (!cancelled) setUsers(u ?? []);
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  return (
    <div className="flex flex-col gap-4">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-[14px] -translate-y-1/2 text-[var(--text-faint)]" />
        <Input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("admin.users.searchPlaceholder")}
          aria-label={t("admin.users.searchPlaceholder")}
          className="pl-9!"
        />
      </div>

      {users && users.length === 0 && (
        <EmptyState icon={Users} title={t("admin.users.empty")} className="h-auto py-10" />
      )}

      <ul className="flex flex-col gap-1">
        {(users ?? []).map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onSelect(u.id)}
              className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
            >
              {u.avatarUrl ? (
                <img src={u.avatarUrl} alt="" className="size-8 shrink-0 rounded-full" />
              ) : (
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[13px] font-semibold text-[var(--text-mut)]">
                  {u.name.charAt(0).toUpperCase()}
                </span>
              )}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-2">
                  <span className="truncate text-[13.5px] font-medium text-[var(--text)]">
                    {u.name}
                  </span>
                  {u.isAdmin && <Badge variant="amber">{t("admin.users.adminBadge")}</Badge>}
                </span>
                <span className="truncate text-[12px] text-[var(--text-mut)]">{u.email}</span>
              </span>
              <span className="hidden shrink-0 text-[11.5px] text-[var(--text-faint)] sm:block">
                {new Date(u.createdAt).toLocaleDateString(i18n.language)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

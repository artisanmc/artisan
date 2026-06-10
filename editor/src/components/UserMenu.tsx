import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuthStore } from "@/state/authStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { Link } from "@tanstack/react-router";
import { LogOut, Settings as SettingsIcon, Shield, UserIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

function getInitial(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

export function UserMenu() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const closeSidebar = useSidebarStore((s) => s.close);
  const displayName = user?.name ?? t("userMenu.anonymous");
  const initial = getInitial(user?.name);
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  const onLogout = async () => {
    await useAuthStore.getState().logout(apiUrl);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-[12px] border border-[var(--border-soft)] px-2 py-2 text-left text-[13px] text-[var(--text)] transition-colors hover:border-[var(--border)] hover:bg-[var(--surface-hover)]"
        >
          {user?.avatarUrl ? (
            <img
              src={user.avatarUrl}
              alt={displayName}
              className="size-8 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--brand-soft)] font-semibold text-[12px] text-[var(--brand)]"
              aria-hidden
            >
              {initial}
            </div>
          )}
          <span className="truncate flex-1 font-medium">{displayName}</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[200px]">
        {user ? (
          <>
            <DropdownMenuItem asChild>
              <Link to="/account" onClick={closeSidebar} className="flex items-center gap-2.5">
                <UserIcon className="size-[14px]" />
                {t("userMenu.profile")}
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/settings" onClick={closeSidebar} className="flex items-center gap-2.5">
                <SettingsIcon className="size-[14px]" />
                {t("sidebar.settings")}
              </Link>
            </DropdownMenuItem>
            {user.isAdmin && (
              <DropdownMenuItem asChild>
                <Link to="/admin" onClick={closeSidebar} className="flex items-center gap-2.5">
                  <Shield className="size-[14px]" />
                  {t("userMenu.admin")}
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onLogout}
              className="flex items-center gap-2.5 text-[var(--danger)]"
            >
              <LogOut className="size-[14px]" />
              {t("auth.logout")}
            </DropdownMenuItem>
          </>
        ) : (
          <DropdownMenuItem asChild>
            <Link to="/login" onClick={closeSidebar} className="flex items-center gap-2.5">
              <UserIcon className="size-[14px]" />
              {t("userMenu.signIn")}
            </Link>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

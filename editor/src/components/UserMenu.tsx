import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EditorAccessNotice } from "@/features/project/EditorAccessNotice";
import { type SubscriptionDto, getSubscription } from "@/lib/api/billing";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { useSidebarStore } from "@/state/sidebarStore";
import { Link } from "@tanstack/react-router";
import { LogOut, Settings as SettingsIcon, Shield, UserIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

function getInitial(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

export function UserMenu({
  networkId: selectedNetworkId,
  serverId,
  serverLabel,
}: {
  networkId?: string | null;
  serverId?: string | null;
  serverLabel?: string;
} = {}) {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const storedNetworkId = useNetworksStore((s) => s.activeId);
  const networkId = selectedNetworkId === undefined ? storedNetworkId : selectedNetworkId;
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState<{
    networkId: string;
    value: SubscriptionDto;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening the menu refreshes the subscription.
  useEffect(() => {
    let live = true;
    setSubscription(null);
    if (user && networkId) {
      void getSubscription(networkId)
        .then((value) => {
          if (live && value) setSubscription({ networkId, value });
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [user, networkId, open]);
  const currentSubscription = subscription?.networkId === networkId ? subscription.value : null;
  const planName = currentSubscription
    ? currentSubscription.status &&
      !["canceled", "incomplete_expired"].includes(currentSubscription.status)
      ? currentSubscription.planName
      : "Free"
    : null;
  const closeSidebar = useSidebarStore((s) => s.close);
  const displayName = user?.name ?? t("userMenu.anonymous");
  const initial = getInitial(user?.name);
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  const onLogout = async () => {
    await useAuthStore.getState().logout(apiUrl);
  };

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
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
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium">{displayName}</span>
            {user && planName && (
              <span className="block truncate text-xs text-[var(--text-mut)]">{planName}</span>
            )}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-[280px] max-w-[calc(100vw-24px)]">
        {user ? (
          <>
            {networkId && serverId && (
              <>
                <div className="px-2.5 pt-2 text-xs font-medium text-[var(--text)]">
                  {t("userMenu.resourceUsage")}
                  {serverLabel && (
                    <div className="truncate pt-1 font-normal text-[var(--text-mut)]">
                      {serverLabel}
                    </div>
                  )}
                </div>
                <EditorAccessNotice
                  key={`${networkId}:${serverId}`}
                  networkId={networkId}
                  serverId={serverId}
                />
                <DropdownMenuSeparator />
              </>
            )}
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

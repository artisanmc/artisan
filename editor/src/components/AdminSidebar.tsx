import { ArtisanWordmark } from "@/components/ArtisanWordmark";
import { useSidebarStore } from "@/state/sidebarStore";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, BarChart3, Bot, CreditCard, Palette, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UserMenu } from "./UserMenu";

/**
 * Sidebar shown in place of the ProjectSidebar on /admin* routes.
 * Same shell (brand top, UserMenu bottom), admin section nav in between.
 */
export function AdminSidebar() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const entries = [
    { to: "/admin/ai", label: t("admin.nav.aiModels"), Icon: Bot },
    { to: "/admin/ai/usage", label: t("admin.nav.aiUsage"), Icon: BarChart3 },
    { to: "/admin/users", label: t("admin.nav.users"), Icon: Users },
    { to: "/admin/billing", label: t("admin.nav.billing"), Icon: CreditCard },
    { to: "/admin/design", label: t("admin.nav.design"), Icon: Palette },
  ] as const;

  return (
    <nav className="flex h-full flex-col gap-3.5 px-3 py-2">
      <Link
        to="/networks"
        onClick={() => useSidebarStore.getState().close()}
        className="flex h-12 shrink-0 items-center gap-1 rounded-[10px] px-1.5 transition-colors hover:bg-[var(--surface-hover)]"
      >
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="size-7 shrink-0"
        />
        <ArtisanWordmark />
      </Link>

      <Link
        to="/networks"
        onClick={() => useSidebarStore.getState().close()}
        className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-[12.5px] text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="size-[14px] shrink-0" />
        {t("admin.nav.back")}
      </Link>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="px-2 pt-0.5 pb-2 text-[9.5px] font-bold uppercase tracking-[.14em] text-[var(--text-faint)]">
          {t("admin.nav.section")}
        </div>
        <ul className="flex flex-col gap-0.5">
          {entries.map(({ to, label, Icon }) => {
            // "/admin/ai" is the AI models page, not a prefix of every admin route;
            // section entries stay active on their subpages (/admin/users/:id).
            const isActive =
              to === "/admin/ai"
                ? pathname === to || pathname === `${to}/`
                : pathname === to || pathname.startsWith(`${to}/`);
            return (
              <li key={to}>
                <Link
                  to={to}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => useSidebarStore.getState().close()}
                  className={
                    isActive
                      ? "flex items-center gap-2.5 rounded-[10px] bg-[var(--brand-soft)] px-2.5 py-2 text-[13px] font-semibold text-[var(--brand)]"
                      : "flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13px] font-medium text-[var(--text-mut)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
                  }
                >
                  <Icon className="size-[15px] shrink-0" />
                  <span className="truncate">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>

      <UserMenu />
    </nav>
  );
}

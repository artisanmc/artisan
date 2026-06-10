import { useSidebarStore } from "@/state/sidebarStore";
import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowLeft, Bot, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { UserMenu } from "./UserMenu";

/**
 * Sidebar shown in place of the WorkspaceSidebar on /admin* routes.
 * Same shell (brand top, UserMenu bottom), admin section nav in between.
 */
export function AdminSidebar() {
  const { t } = useTranslation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const entries = [
    { to: "/admin", label: t("admin.nav.ai"), Icon: Bot },
    { to: "/admin/design", label: t("admin.nav.design"), Icon: Palette },
  ] as const;

  return (
    <nav className="flex h-full flex-col gap-3.5 px-3 py-3.5">
      <Link
        to="/networks"
        onClick={() => useSidebarStore.getState().close()}
        className="flex items-center gap-2.5 rounded-[10px] px-1.5 pt-1 pb-0.5 transition-colors hover:bg-[var(--surface-hover)]"
      >
        <span className="pixel-mark">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span
          className="font-display text-[17px] font-semibold text-[var(--text)]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {t("sidebar.brand")}
        </span>
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
            const isActive = pathname === to || pathname === `${to}/`;
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

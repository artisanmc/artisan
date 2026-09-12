import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { listNetworks } from "@/lib/api/networks";
import { LogoutButton } from "@/features/auth/LogoutButton";
import { DeleteAccountSection } from "@/features/auth/DeleteAccount";

export const Route = createFileRoute("/account")({ component: AccountPage });

export function AccountPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const networks = useNetworksStore((s) => s.networks);
  const setNetworks = useNetworksStore((s) => s.setNetworks);
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  useEffect(() => {
    if (!user) return;
    listNetworks().then(setNetworks).catch(console.error);
  }, [user, setNetworks]);

  if (!user) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8">
        <p className="text-[var(--text-mut)]">{t("accountPage.notSignedIn")}</p>
        <Link to="/login" className="btn btn-primary">
          {t("auth.loginSubmit")}
        </Link>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-8 py-12">
        <header className="flex flex-col gap-2">
          <h1
            className="display text-[36px] tracking-tight text-[var(--text)]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {t("auth.account.title")}
          </h1>
          <p className="text-[14px] text-[var(--text-mut)]">
            {t("auth.account.signedInAs")}{" "}
            <strong className="text-[var(--text-mut)]">{user.name}</strong>{" "}
            <span className="text-[var(--text-faint)]">({user.email})</span>
          </p>
        </header>

        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <h2 className="eyebrow">{t("accountPage.networksSection")}</h2>
            <span className="h-px flex-1 bg-[var(--border-soft)]" />
          </div>
          {networks.length === 0 ? (
            <Link
              to="/setup"
              className="card flex items-center gap-3 p-5 transition-colors hover:border-[var(--brand-line)]"
            >
              <Plus className="size-[18px] text-[var(--brand)]" />
              <div className="flex flex-col">
                <span className="text-[14px] font-semibold text-[var(--text)]">
                  {t("accountPage.firstServerTitle")}
                </span>
              </div>
            </Link>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {networks.map((n) => (
                <li key={n.id}>
                  <Link
                    to="/networks/$networkId"
                    params={{ networkId: n.slug ?? n.id }}
                    className="card flex items-center justify-between gap-3 p-4 transition-colors hover:border-[var(--brand-line)]"
                  >
                    <span className="text-[14px] font-semibold text-[var(--text)]">{n.name}</span>
                    <span className="text-[11px] uppercase tracking-[.12em] text-[var(--text-faint)]">
                      {t("accountPage.networkBadge")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/setup"
            className="self-start text-[12.5px] text-[var(--text-mut)] underline-offset-2 hover:text-[var(--brand)] hover:underline"
          >
            {t("accountPage.addAnotherServer")}
          </Link>
        </section>

        {user.isAdmin && (
          <Link
            to="/admin"
            className="self-start text-[12.5px] text-[var(--text-mut)] underline-offset-2 hover:text-[var(--brand)] hover:underline"
          >
            {t("accountPage.adminLink")}
          </Link>
        )}

        <div className="rule" />

        <LogoutButton apiUrl={apiUrl} />
        <DeleteAccountSection apiUrl={apiUrl} email={user.email} />
      </div>
    </div>
  );
}

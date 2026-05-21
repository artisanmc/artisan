import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import { useNetworksStore } from "@/state/networksStore";
import { listNetworks } from "@/lib/api/networks";
import { LogoutButton } from "@/features/auth/LogoutButton";

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
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <p>{t("auth.account.signedInAs")} ?</p>
        <Link to="/login" className="underline">{t("auth.loginSubmit")}</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t("auth.account.title")}</h1>
      <p className="text-muted-foreground">{t("auth.account.signedInAs")} <strong>{user.name}</strong> ({user.email})</p>

      <section>
        <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-2">Networks</h2>
        {networks.length === 0 ? (
          <Link to="/setup" className="underline">Set up your first server</Link>
        ) : (
          <ul className="flex flex-col gap-2">
            {networks.map((n) => (
              <li key={n.id}>
                <Link to="/networks/$networkId" params={{ networkId: n.id }} className="block p-2 border rounded hover:bg-muted">
                  {n.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link to="/setup" className="mt-3 inline-block text-sm underline">+ Add another server</Link>
      </section>

      <LogoutButton apiUrl={apiUrl} />
    </div>
  );
}

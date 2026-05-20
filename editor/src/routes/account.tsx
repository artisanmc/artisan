import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
import { LogoutButton } from "@/features/auth/LogoutButton";

export const Route = createFileRoute("/account")({ component: AccountPage });

function AccountPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.currentUser);
  const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
        <p>{t("auth.account.signedInAs")} ?</p>
        <Link to="/login" className="underline">{t("auth.loginSubmit")}</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-xl font-semibold">{t("auth.account.title")}</h1>
      <p className="text-muted-foreground">{t("auth.account.signedInAs")} <strong>{user.name}</strong> ({user.email})</p>
      <LogoutButton apiUrl={apiUrl} />
    </div>
  );
}

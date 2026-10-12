import { AuthCard } from "@/features/auth/AuthCard";
import { useTranslation } from "react-i18next";

export function SelfHostedSignIn({ expired }: { expired: boolean }) {
  const { t } = useTranslation();
  return (
    <AuthCard title={t("selfHosted.signIn.title")}>
      {expired && (
        <p role="alert" className="badge badge-amber">
          {t("selfHosted.signIn.expired")}
        </p>
      )}
      <p className="text-sm text-[var(--text-mut)]">{t("selfHosted.signIn.body")}</p>
      <code className="input select-all font-mono">{t("selfHosted.signIn.command")}</code>
      <p className="text-xs text-[var(--text-mut)]">{t("selfHosted.signIn.permission")}</p>
    </AuthCard>
  );
}

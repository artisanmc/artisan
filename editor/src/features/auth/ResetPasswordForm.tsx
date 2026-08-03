import { FormField } from "@/components/ui/form-field";
import { resetPassword } from "@/lib/api/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthCard } from "./AuthCard";

interface Props {
  apiUrl: string;
  token: string;
}

export function ResetPasswordForm({ apiUrl, token }: Props) {
  const { t } = useTranslation();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      setErrorKey("passwords_mismatch");
      return;
    }
    setErrorKey(null);
    setIsLoading(true);
    try {
      const result = await resetPassword({ apiUrl }, { token, password });
      if (result.ok) setDone(true);
      else setErrorKey(result.error);
    } catch {
      setErrorKey("network");
    } finally {
      setIsLoading(false);
    }
  }

  const backLink = (
    <p className="text-center text-[13px] text-[var(--text-mut)]">
      <a href="/login" className="text-[var(--brand)] underline-offset-2 hover:underline">
        {t("auth.backToLogin")}
      </a>
    </p>
  );

  if (!token) {
    return (
      <AuthCard title={t("auth.reset.title")}>
        <p className="text-sm text-[var(--danger)]">{t("auth.errors.missing_token")}</p>
        {backLink}
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title={t("auth.reset.doneTitle")}>
        <p className="text-[13px] text-[var(--text-mut)]">{t("auth.reset.doneBody")}</p>
        {backLink}
      </AuthCard>
    );
  }

  const errorMsg = errorKey
    ? t(`auth.errors.${errorKey}` as const, { defaultValue: t("auth.errors.unknown") })
    : "";

  return (
    <AuthCard title={t("auth.reset.title")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <FormField label={t("auth.reset.newPassword")}>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              autoComplete="new-password"
            />
          </FormField>
          <FormField label={t("auth.reset.confirmPassword")}>
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input"
              autoComplete="new-password"
            />
          </FormField>
        </div>

        {errorMsg && <div className="text-sm text-[var(--danger)]">{errorMsg}</div>}

        <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
          {t("auth.reset.submit")}
        </button>
      </form>
      {backLink}
    </AuthCard>
  );
}

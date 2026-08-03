import { FormField } from "@/components/ui/form-field";
import { forgotPassword } from "@/lib/api/auth";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthCard } from "./AuthCard";

interface Props {
  apiUrl: string;
}

export function ForgotPasswordForm({ apiUrl }: Props) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorKey(null);
    setIsLoading(true);
    try {
      const result = await forgotPassword({ apiUrl }, { email });
      // The backend answers 204 whether or not the account exists — the
      // confirmation below must stay identical either way.
      if (result.ok) setSentTo(email);
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

  if (sentTo !== null) {
    return (
      <AuthCard title={t("auth.forgot.sentTitle")}>
        <p className="text-[13px] text-[var(--text-mut)]">
          {t("auth.forgot.sentBody", { email: sentTo })}
        </p>
        {backLink}
      </AuthCard>
    );
  }

  const errorMsg = errorKey
    ? t(`auth.errors.${errorKey}` as const, { defaultValue: t("auth.errors.unknown") })
    : "";

  return (
    <AuthCard title={t("auth.forgot.title")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <p className="text-[13px] text-[var(--text-mut)]">{t("auth.forgot.intro")}</p>

        <FormField label={t("auth.email")}>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            autoComplete="email"
          />
        </FormField>

        {errorMsg && <div className="text-sm text-[var(--danger)]">{errorMsg}</div>}

        <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
          {t("auth.forgot.submit")}
        </button>
      </form>
      {backLink}
    </AuthCard>
  );
}

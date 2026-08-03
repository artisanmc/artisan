import { FormField } from "@/components/ui/form-field";
import { useAuthStore } from "@/state/authStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AuthCard } from "./AuthCard";
import { DiscordLoginButton } from "./DiscordLoginButton";

interface Props {
  apiUrl: string;
  onSuccess: () => void;
}

export function SignupForm({ apiUrl, onSuccess }: Props) {
  const { t } = useTranslation();
  const storeError = useAuthStore((s) => s.error);
  const isLoading = useAuthStore((s) => s.isLoading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const result = await useAuthStore.getState().signup(apiUrl, { email, password, name });
    if (result.ok) {
      onSuccess();
    } else {
      setSubmitError(result.error);
    }
  }

  const errorKey = submitError ?? storeError ?? "";
  const errorMsg = errorKey
    ? t(`auth.errors.${errorKey}` as const, { defaultValue: t("auth.errors.unknown") })
    : "";

  return (
    <AuthCard title={t("auth.signupTitle")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <FormField label={t("auth.name")}>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input"
              autoComplete="name"
            />
          </FormField>
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
          <FormField label={t("auth.password")}>
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
        </div>

        {errorMsg && <div className="text-sm text-[var(--danger)]">{errorMsg}</div>}

        <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
          {t("auth.signupSubmit")}
        </button>

        <div className="flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--text-faint)]">
          <span className="h-px flex-1 bg-[var(--border-soft)]" />
          <span>{t("auth.orSeparator")}</span>
          <span className="h-px flex-1 bg-[var(--border-soft)]" />
        </div>

        <DiscordLoginButton apiUrl={apiUrl} />
      </form>

      <p className="text-center text-[13px] text-[var(--text-mut)]">
        {t("auth.haveAccount")}{" "}
        <a
          href={`/login${typeof window !== "undefined" ? window.location.search : ""}`}
          className="text-[var(--brand)] underline-offset-2 hover:underline"
        >
          {t("auth.loginLink")}
        </a>
      </p>
    </AuthCard>
  );
}

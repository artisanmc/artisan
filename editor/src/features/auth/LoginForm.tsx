import { FormField } from "@/components/ui/form-field";
import { useAuthStore } from "@/state/authStore";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { DiscordLoginButton } from "./DiscordLoginButton";

interface Props {
  apiUrl: string;
  onSuccess: () => void;
}

export function LoginForm({ apiUrl, onSuccess }: Props) {
  const { t } = useTranslation();
  const storeError = useAuthStore((s) => s.error);
  const isLoading = useAuthStore((s) => s.isLoading);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const result = await useAuthStore.getState().login(apiUrl, { email, password });
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
    <form
      onSubmit={onSubmit}
      className="card relative z-[1] mx-auto flex w-full max-w-[400px] flex-col gap-5 p-8"
    >
      <div className="flex items-center gap-2.5">
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
        <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--text-mut)]">
          Artisan
        </span>
      </div>

      <h1
        className="display text-[28px] text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("auth.loginTitle")}
      </h1>

      <div className="flex flex-col gap-3.5">
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
            autoComplete="current-password"
          />
        </FormField>
      </div>

      {errorMsg && <div className="text-sm text-[var(--danger)]">{errorMsg}</div>}

      <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
        {t("auth.loginSubmit")}
      </button>

      <div className="flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--text-faint)]">
        <span className="h-px flex-1 bg-[var(--border-soft)]" />
        <span>{t("auth.orSeparator")}</span>
        <span className="h-px flex-1 bg-[var(--border-soft)]" />
      </div>

      <DiscordLoginButton apiUrl={apiUrl} />

      <p className="text-center text-[13px] text-[var(--text-mut)]">
        {t("auth.noAccount")}{" "}
        <a
          href={`/signup${typeof window !== "undefined" ? window.location.search : ""}`}
          className="text-[var(--brand)] underline-offset-2 hover:underline"
        >
          {t("auth.signupLink")}
        </a>
      </p>
    </form>
  );
}

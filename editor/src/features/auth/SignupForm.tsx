import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
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
    <form
      onSubmit={onSubmit}
      className="card relative z-[1] mx-auto flex w-full max-w-[400px] flex-col gap-5 p-8"
    >
      <div className="flex items-center gap-2.5">
        <span className="pixel-mark">
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </span>
        <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-mut)]">
          Artisan
        </span>
      </div>

      <h1
        className="display text-[28px] text-[var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("auth.signupTitle")}
      </h1>

      <div className="flex flex-col gap-3.5">
        <label className="flex flex-col">
          <span className="field-label">{t("auth.name")}</span>
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="input"
            autoComplete="name"
          />
        </label>
        <label className="flex flex-col">
          <span className="field-label">{t("auth.email")}</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            autoComplete="email"
          />
        </label>
        <label className="flex flex-col">
          <span className="field-label">{t("auth.password")}</span>
          <input
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            autoComplete="new-password"
          />
        </label>
      </div>

      {errorMsg && <div className="text-sm text-[var(--brick)]">{errorMsg}</div>}

      <button type="submit" disabled={isLoading} className="btn btn-primary w-full">
        {t("auth.signupSubmit")}
      </button>

      <div className="flex items-center gap-3 text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--ink-faint)]">
        <span className="h-px flex-1 bg-[var(--line-soft)]" />
        <span>ou</span>
        <span className="h-px flex-1 bg-[var(--line-soft)]" />
      </div>

      <DiscordLoginButton apiUrl={apiUrl} />

      <p className="text-center text-[13px] text-[var(--ink-mut)]">
        {t("auth.haveAccount")}{" "}
        <a
          href={`/login${typeof window !== "undefined" ? window.location.search : ""}`}
          className="text-[var(--terra)] underline-offset-2 hover:underline"
        >
          {t("auth.loginLink")}
        </a>
      </p>
    </form>
  );
}

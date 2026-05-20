import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";
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
  // Track the last submit error locally too — useful in tests where the
  // store action is mocked and `state.error` is never updated, and as a
  // fallback when the store hasn't yet reflected the rejection.
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
  const errorMsg = errorKey ? t(`auth.errors.${errorKey}` as const, { defaultValue: t("auth.errors.unknown") }) : "";

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 max-w-sm mx-auto">
      <h1 className="text-xl font-semibold">{t("auth.loginTitle")}</h1>
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t("auth.email")}</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border px-3 py-2" />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-sm">{t("auth.password")}</span>
        <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} className="rounded border px-3 py-2" />
      </label>
      {errorMsg && <div className="text-sm text-red-600">{errorMsg}</div>}
      <button type="submit" disabled={isLoading} className="rounded bg-black text-white px-4 py-2 disabled:opacity-50">
        {t("auth.loginSubmit")}
      </button>
      <DiscordLoginButton apiUrl={apiUrl} />
    </form>
  );
}

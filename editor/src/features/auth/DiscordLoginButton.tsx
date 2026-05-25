import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

interface Props { apiUrl: string }

export function DiscordLoginButton({ apiUrl }: Props) {
  const { t } = useTranslation();
  // null = unknown (checking), true/false = answer from backend.
  // Hide the button entirely while unknown to avoid a flash, and hide
  // it permanently when Discord is not configured server-side.
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiUrl}/api/v1/auth/discord/configured`)
      .then((r) => r.ok ? r.json() as Promise<{ configured: boolean }> : { configured: false })
      .then((d) => { if (!cancelled) setConfigured(d.configured); })
      .catch(() => { if (!cancelled) setConfigured(false); });
    return () => { cancelled = true; };
  }, [apiUrl]);

  if (configured !== true) return null;

  function onClick() {
    window.location.href = `${apiUrl}/api/v1/auth/discord/start`;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded bg-[#5865F2] text-white px-4 py-2"
    >
      {t("auth.discordButton")}
    </button>
  );
}

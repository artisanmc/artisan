import { useTranslation } from "react-i18next";

interface Props { apiUrl: string }

export function DiscordLoginButton({ apiUrl }: Props) {
  const { t } = useTranslation();
  function onClick() {
    window.location.href = `${apiUrl}/api/auth/discord/start`;
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

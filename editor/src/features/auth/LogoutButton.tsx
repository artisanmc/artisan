import { useTranslation } from "react-i18next";
import { useAuthStore } from "@/state/authStore";

interface Props { apiUrl: string }

export function LogoutButton({ apiUrl }: Props) {
  const { t } = useTranslation();
  async function onClick() {
    await useAuthStore.getState().logout(apiUrl);
  }
  return (
    <button type="button" onClick={onClick} className="rounded border px-3 py-1 text-sm">
      {t("auth.logout")}
    </button>
  );
}

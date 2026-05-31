import { useTranslation } from "react-i18next";
import { LogOut } from "lucide-react";
import { useAuthStore } from "@/state/authStore";

interface Props { apiUrl: string }

export function LogoutButton({ apiUrl }: Props) {
  const { t } = useTranslation();
  async function onClick() {
    await useAuthStore.getState().logout(apiUrl);
  }
  return (
    <button type="button" onClick={onClick} className="btn btn-outline btn-sm">
      <LogOut className="size-[14px]" />
      {t("auth.logout")}
    </button>
  );
}

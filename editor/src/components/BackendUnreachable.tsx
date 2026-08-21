import { useAuthStore } from "@/state/authStore";
import { useTranslation } from "react-i18next";

/**
 * Écran affiché quand on n'a jamais pu savoir qui est là : le backend ne répond
 * pas. On dit ça, et rien d'autre — l'ancien réflexe (rebondir sur /login)
 * inventait une déconnexion et envoyait sur une page que le même backend est
 * censé animer. Les réessais tournent déjà en arrière-plan ; le bouton ne fait
 * qu'en déclencher un tout de suite.
 */
export function BackendUnreachable() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      <div className="card flex max-w-[420px] flex-col gap-3 p-6 text-center">
        <h1 className="text-[16px] font-semibold text-[var(--text)]">
          {t("auth.unreachableTitle")}
        </h1>
        <p className="text-[13px] leading-relaxed text-[var(--text-mut)]">
          {t("auth.unreachableBody")}
        </p>
        <button
          type="button"
          className="btn btn-primary self-center"
          onClick={() => {
            const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
            useAuthStore.getState().hydrate(apiUrl);
          }}
        >
          {t("auth.retryNow")}
        </button>
      </div>
    </div>
  );
}

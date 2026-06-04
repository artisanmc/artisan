import { Link, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export function UnknownElementFallback() {
  const { t } = useTranslation();
  const { workspaceId } = useParams({ strict: false }) as { workspaceId: string };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <p className="text-[15px] text-[var(--text)]">{t("focusMode.unknownElement")}</p>
      <Link
        to="/workspace/$workspaceId"
        params={{ workspaceId }}
        className="btn btn-sm btn-primary"
      >
        {t("focusMode.backToCanvas")}
      </Link>
    </div>
  );
}

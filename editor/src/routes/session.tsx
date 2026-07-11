import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useEffect } from "react";

export const Route = createFileRoute("/session")({
  component: SessionGoneRedirect,
});

/**
 * Old `/session?token=...` links (pre accounts-only cutover) no longer have
 * anything to exchange — the editor-session surface is gone (backend Task 7).
 * Surface a toast explaining why, then bounce to /login.
 */
function SessionGoneRedirect() {
  const { t } = useTranslation();

  useEffect(() => {
    toast.info(t("sessionGone.message"));
  }, [t]);

  return <Navigate to="/login" replace />;
}

export default SessionGoneRedirect;

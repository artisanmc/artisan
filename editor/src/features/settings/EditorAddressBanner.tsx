import { getEditorAddress } from "@/lib/api/editorAddress";
import { useAuthStore } from "@/state/authStore";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

const DISMISSED = "artisan.editor-address-banner.dismissed";

const dismissed = () => {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
};

/**
 * Offers a name for the editor's address while it has only its `<id>` one
 * (ADR `editor-tunnel`), to those who may choose it. Dismissed for good on this
 * browser; the setting stays under Settings.
 */
export function EditorAddressBanner() {
  const { t } = useTranslation();
  const canConfigure = useAuthStore(
    (s) => s.currentUser?.permissions?.includes("artisan.editor.config") ?? false,
  );
  const [url, setUrl] = useState<string | null>(null);
  const [hidden, setHidden] = useState(dismissed);

  useEffect(() => {
    if (!canConfigure || hidden) return;
    getEditorAddress()
      .then((a) => setUrl(a.tunnel && a.names && !a.name && a.url ? a.url : null))
      .catch(() => setUrl(null));
  }, [canConfigure, hidden]);

  if (!url || hidden) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      // Private window: hidden until the next visit.
    }
    setHidden(true);
  };
  return (
    <div className="card flex flex-wrap items-center gap-3 p-4">
      <p className="flex-1 text-[13px] text-[var(--text)]">{t("editorAddress.banner", { url })}</p>
      <Link to="/settings" hash="address" className="btn btn-primary btn-sm">
        {t("editorAddress.bannerAction")}
      </Link>
      <button type="button" className="btn btn-ghost btn-sm" onClick={dismiss}>
        {t("editorAddress.bannerLater")}
      </button>
    </div>
  );
}

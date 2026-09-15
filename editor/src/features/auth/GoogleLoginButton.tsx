import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function GoogleLoginButton({ apiUrl }: { apiUrl: string }) {
  const { t } = useTranslation();
  const [configuredApi, setConfiguredApi] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/api/v1/auth/google/configured`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { configured: false }))
      .then((data) => {
        if (!controller.signal.aborted) setConfiguredApi(data.configured === true ? apiUrl : null);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfiguredApi(null);
      });
    return () => controller.abort();
  }, [apiUrl]);
  if (configuredApi !== apiUrl) return null;
  const next = new URLSearchParams(window.location.search).get("next");
  const startUrl = `${apiUrl}/api/v1/auth/google/start${next ? `?${new URLSearchParams({ next })}` : ""}`;
  return (
    <Button asChild variant="outline" className="w-full">
      <a href={startUrl}>{t("auth.googleButton")}</a>
    </Button>
  );
}

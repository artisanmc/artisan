import { useAuthStore } from "@/state/authStore";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/")({
  component: HomeRoute,
});

export function HomeRoute() {
  const { t } = useTranslation();
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAuthLoading = useAuthStore((s) => s.isLoading);
  const navigate = useNavigate();

  useEffect(() => {
    if (isAuthLoading || !currentUser) return;
    navigate({
      to: "/networks",
    });
  }, [currentUser, isAuthLoading, navigate]);

  if (isAuthLoading || currentUser) return null;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center">
      <h1 className="font-display text-3xl">Artisan</h1>
      <p className="max-w-lg text-[var(--text-mut)]">{t("demo.intro")}</p>
      <div className="flex gap-3">
        <a href="/demo" className="btn btn-primary">
          {t("demo.try")}
        </a>
        <a href="/login" className="btn">
          {t("demo.signIn")}
        </a>
      </div>
    </div>
  );
}

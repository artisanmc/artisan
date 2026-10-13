import { ArtisanWordmark } from "@/components/ArtisanWordmark";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Shared shell of every auth screen: branded card + page title. */
export function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="card relative z-[1] mx-auto flex w-full max-w-[400px] flex-col gap-5 p-8">
      <div className="flex items-center gap-1">
        <img
          src="/logo.svg"
          alt=""
          aria-hidden="true"
          width={28}
          height={28}
          className="size-7 shrink-0"
        />
        <ArtisanWordmark />
      </div>

      <h1
        className="display text-[28px] text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {title}
      </h1>

      {children}
      <nav
        aria-label="Artisan"
        className="flex flex-wrap justify-center gap-3 text-xs text-[var(--text-mut)]"
      >
        <a href="/about.html" className="underline">
          Artisan
        </a>
        <a href="/privacy.html" className="underline">
          {t("auth.privacy")}
        </a>
        <a href="/terms.html" className="underline">
          {t("auth.terms")}
        </a>
      </nav>
    </div>
  );
}

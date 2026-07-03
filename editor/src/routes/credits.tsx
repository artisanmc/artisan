import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/credits")({ component: CreditsPage });

/** Placeholder — purchase flow is out of scope for V1. */
export function CreditsPage() {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <h1
        className="display text-[28px] tracking-tight text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("assistant.outOfCredits.cta")}
      </h1>
      <p className="max-w-md text-[14px] text-[var(--text-mut)]">
        {t("assistant.outOfCredits.soon")}
      </p>
      <Link
        to="/"
        className="text-[12.5px] text-[var(--text-mut)] underline-offset-2 hover:text-[var(--brand)] hover:underline"
      >
        {t("assistant.outOfCredits.back")}
      </Link>
    </div>
  );
}

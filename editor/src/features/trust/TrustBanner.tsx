import { useTranslation } from "react-i18next";

interface TrustBannerProps {
  trustCode: string;
}

export function TrustBanner({ trustCode }: TrustBannerProps) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-3 border-b border-[var(--gold-soft)] bg-[var(--gold-soft)] px-4 py-2 text-[13px] text-[var(--gold)]"
    >
      <span className="font-semibold">{t("trustBanner.deployDisabled")}</span>
      <span>
        {t("trustBanner.typeInGame")}{" "}
        <code className="mono rounded bg-[var(--inset)] px-2 py-0.5 text-[12.5px] text-[var(--gold)]">
          /artisan trusteditor {trustCode}
        </code>
      </span>
    </div>
  );
}

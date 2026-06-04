import { useTranslation } from "react-i18next";
import type { WizardState } from "../SetupWizard";

const WS_URL =
  import.meta.env.VITE_PLUGIN_WS_URL ?? "wss://editor.artisanmc.net/ws/plugin";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step4Install({ state }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-5">
      <h2
        className="display text-[20px] text-[var(--text)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("setupWizard.step4.title")}
      </h2>

      <InstallStep n={1} label={t("setupWizard.step4.configStep")}>
        <pre className="mono whitespace-pre-wrap break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-3 text-[12.5px] text-[var(--text-mut)]">
{`server-key: "${state.serverKey ?? "<your-server-key>"}"
backend-url: "${WS_URL}"`}
        </pre>
      </InstallStep>

      <InstallStep n={2} label={t("setupWizard.step4.keyStep")}>
        <code className="mono block break-all rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-3 py-2 text-[12.5px] text-[var(--text-mut)]">
          {state.serverKey ?? t("setupWizard.step4.noKey")}
        </code>
      </InstallStep>

      <InstallStep n={3} label={t("setupWizard.step4.reloadStep")}>
        <pre className="mono rounded-[14px] border border-[var(--border)] bg-[var(--surface-inset)] px-4 py-2 text-[12.5px] text-[var(--text-mut)]">
          /artisan reload
        </pre>
        <p className="text-[12px] text-[var(--text-faint)]">{t("setupWizard.step4.reloadHint")}</p>
      </InstallStep>
    </div>
  );
}

function InstallStep({
  n,
  label,
  children,
}: {
  n: number;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <span className="flex h-6 w-6 items-center justify-center rounded-full border border-[var(--brand-line)] bg-[var(--brand-soft)] text-[11px] font-bold text-[var(--brand)]">
          {n}
        </span>
        <span className="text-[12.5px] font-semibold text-[var(--text)]">{label}</span>
      </div>
      {children}
    </section>
  );
}

import { Button } from "@/components/ui/button";
import { listNetworks } from "@/lib/api/networks";
import { useNetworksStore } from "@/state/networksStore";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Step1Network } from "./SetupWizardSteps/Step1Network";
import { Step2Server } from "./SetupWizardSteps/Step2Server";
import { Step3Project } from "./SetupWizardSteps/Step3Project";
import { Step4Install } from "./SetupWizardSteps/Step4Install";

export interface WizardState {
  networkId: string | null;
  projectId: string | null;
  /** Link code minted when the server was created — run `/artisan link <code>`. */
  linkCode: string | null;
  serverKeyId: string | null;
}

/**
 * Exported for direct test coverage of the per-step enablement contract —
 * driving the full click-through to reach step 4 from RTL is exhaustive and
 * brittle, while this predicate is what the bug was actually in.
 */
export function canNext(step: number, state: WizardState): boolean {
  if (step === 1) return state.networkId !== null;
  if (step === 2) return state.serverKeyId !== null;
  if (step === 3) return state.projectId !== null;
  // Step 4 is the final "Install" instruction screen. By the time we got here,
  // all of networkId / serverKeyId / projectId are populated (each prior step
  // required them to move forward), so the "Terminé" button is always
  // enabled — clicking it exits the wizard into the just-created workspace.
  if (step === 4) return true;
  return false;
}

export function SetupWizard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stepLabels = [
    t("setupWizard.stepLabels.network"),
    t("setupWizard.stepLabels.server"),
    t("setupWizard.stepLabels.project"),
    t("setupWizard.stepLabels.install"),
  ];
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>({
    networkId: null,
    projectId: null,
    linkCode: null,
    serverKeyId: null,
  });

  const totalSteps = 4;

  function handleBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  async function handleNext() {
    if (!canNext(step, state)) return;
    if (step === totalSteps) {
      // Final step: exit the wizard. The new network/project/server_key were
      // created via API but the cached `networksStore` was populated when the
      // user landed on the wizard, so the sidebar wouldn't show the new ones
      // until a hard reload. Refetch now, then navigate — no reload needed.
      try {
        const fresh = await listNetworks();
        useNetworksStore.getState().setNetworks(fresh);
        if (state.networkId) {
          useNetworksStore.getState().setActiveId(state.networkId);
        }
      } catch {
        // Navigation still proceeds; sidebar will refetch on its own eventually.
      }
      if (state.projectId && state.networkId && state.serverKeyId) {
        // Server-scoped workspace route (a workspace belongs to exactly one
        // server) — not the legacy /workspace/$id. The wizard has all 3 params.
        navigate({
          to: "/networks/$networkId/servers/$serverId/projects/$projectId",
          params: {
            networkId: state.networkId,
            serverId: state.serverKeyId,
            projectId: state.projectId,
          },
        });
      } else {
        navigate({ to: "/" });
      }
      return;
    }
    setStep((s) => Math.min(totalSteps, s + 1));
  }

  return (
    <div className="grain relative flex min-h-screen items-center justify-center bg-[var(--surface)] p-8">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: "radial-gradient(80% 60% at 50% 0%, rgba(223,107,65,.06), transparent 60%)",
        }}
      />

      <div className="card relative z-[1] flex w-full max-w-[560px] flex-col gap-7 p-8">
        <header className="flex flex-col gap-4">
          <div className="flex items-center gap-2.5">
            <span className="pixel-mark">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[.18em] text-[var(--text-mut)]">
              {t("setupWizard.eyebrow")}
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            {stepLabels.map((label, i) => {
              const n = i + 1;
              const isActive = n === step;
              const isDone = n < step;
              return (
                <div key={label} className="flex flex-1 items-center gap-2.5">
                  <div className="flex flex-col items-center gap-1">
                    <span
                      className={[
                        "flex h-7 w-7 items-center justify-center rounded-full text-[11.5px] font-semibold transition-colors",
                        isActive
                          ? "border border-[var(--brand-line)] bg-[var(--brand-soft)] text-[var(--brand)]"
                          : isDone
                            ? "bg-[var(--brand)] text-[#2A140C]"
                            : "border border-[var(--border)] text-[var(--text-faint)]",
                      ].join(" ")}
                    >
                      {isDone ? "✓" : n}
                    </span>
                    <span
                      className={[
                        "text-[10.5px] font-semibold uppercase tracking-[.14em]",
                        isActive
                          ? "text-[var(--text)]"
                          : isDone
                            ? "text-[var(--text-mut)]"
                            : "text-[var(--text-faint)]",
                      ].join(" ")}
                    >
                      {label}
                    </span>
                  </div>
                  {i < stepLabels.length - 1 && (
                    <div
                      className="-mt-4 h-px flex-1"
                      style={{
                        background: isDone ? "var(--brand)" : "var(--border-soft)",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </header>

        <div className="flex flex-col gap-4">
          {step === 1 && <Step1Network state={state} setState={setState} />}
          {step === 2 && <Step2Server state={state} setState={setState} />}
          {step === 3 && <Step3Project state={state} setState={setState} />}
          {step === 4 && <Step4Install state={state} setState={setState} />}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border-soft)] pt-5">
          <Button variant="ghost" onClick={handleBack} disabled={step === 1}>
            {t("setupWizard.back")}
          </Button>
          <Button variant="primary" onClick={handleNext} disabled={!canNext(step, state)}>
            {step === totalSteps ? t("setupWizard.done") : t("setupWizard.next")}
          </Button>
        </div>
      </div>
    </div>
  );
}

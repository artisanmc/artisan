import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Step1Network } from "./SetupWizardSteps/Step1Network";
import { Step2Pack } from "./SetupWizardSteps/Step2Pack";
import { Step3ServerKey } from "./SetupWizardSteps/Step3ServerKey";
import { Step4Install } from "./SetupWizardSteps/Step4Install";

export interface WizardState {
  networkId: string | null;
  packId: string | null;
  serverKey: string | null;
  serverKeyId: string | null;
}

function canNext(step: number, state: WizardState): boolean {
  if (step === 1) return state.networkId !== null;
  if (step === 2) return state.packId !== null;
  if (step === 3) return state.serverKeyId !== null;
  return false; // step 4 is terminal
}

export function SetupWizard() {
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>({
    networkId: null,
    packId: null,
    serverKey: null,
    serverKeyId: null,
  });

  const totalSteps = 4;

  function handleBack() {
    setStep((s) => Math.max(1, s - 1));
  }

  function handleNext() {
    if (canNext(step, state)) setStep((s) => Math.min(totalSteps, s + 1));
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-lg flex flex-col gap-6">
        <div className="text-xs text-muted-foreground text-right">
          Step {step} of {totalSteps}
        </div>

        {step === 1 && <Step1Network state={state} setState={setState} />}
        {step === 2 && <Step2Pack state={state} setState={setState} />}
        {step === 3 && <Step3ServerKey state={state} setState={setState} />}
        {step === 4 && <Step4Install state={state} setState={setState} />}

        <div className="flex justify-between">
          <Button variant="outline" onClick={handleBack} disabled={step === 1}>
            Back
          </Button>
          <Button onClick={handleNext} disabled={!canNext(step, state)}>
            {step === totalSteps ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  );
}

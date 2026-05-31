import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step3ServerKey(_props: Props) {
  return <div>Step 3: Generate Server Key (stub)</div>;
}

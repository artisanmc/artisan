import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step4Install(_props: Props) {
  return <div>Step 4: Install Instructions (stub)</div>;
}

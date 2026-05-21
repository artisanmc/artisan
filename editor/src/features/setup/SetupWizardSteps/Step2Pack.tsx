import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step2Pack(_props: Props) {
  return <div>Step 2: Choose a Pack (stub)</div>;
}

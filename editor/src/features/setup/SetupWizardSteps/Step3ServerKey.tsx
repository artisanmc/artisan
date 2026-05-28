import { useState } from "react";
import { Button } from "@/components/ui/button";
import * as networksApi from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step3ServerKey({ state, setState }: Props) {
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  async function handleGenerate() {
    if (!state.networkId || !state.packId) return;
    setGenerating(true);
    try {
      const sk = await networksApi.createServerKey(state.networkId);
      await networksApi.bindPackToServerKey(state.networkId, state.packId, sk.id);
      setState((s) => ({ ...s, serverKey: sk.key, serverKeyId: sk.id }));
      setDone(true);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Step 3: Generate Server Key</h2>
      <p className="text-sm text-muted-foreground">
        A server key authenticates your Minecraft server with the Artisan backend.
        Click below to generate one and bind it to the selected pack.
      </p>

      {state.serverKey && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Your server key (copy now — shown only once):</span>
          <code className="block bg-muted rounded px-3 py-2 font-mono text-sm break-all">
            {state.serverKey}
          </code>
        </div>
      )}

      <Button onClick={handleGenerate} disabled={generating || done}>
        {done ? "Generated" : generating ? "Generating…" : "Generate server key"}
      </Button>
    </div>
  );
}

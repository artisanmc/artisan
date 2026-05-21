import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as networksApi from "@/lib/api/networks";
import type { NetworkSummary } from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step1Network({ state, setState }: Props) {
  const [networks, setNetworks] = useState<NetworkSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    networksApi.listNetworks().then(setNetworks).catch(console.error);
  }, []);

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const n = await networksApi.createNetwork(newName.trim());
      setNetworks((prev) => [...prev, n]);
      setState((s) => ({ ...s, networkId: n.id }));
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Step 1: Choose a Network</h2>

      {networks.length > 0 && (
        <ul className="flex flex-col gap-2">
          {networks.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, networkId: n.id }))}
                className={`w-full text-left p-3 border rounded hover:bg-muted ${
                  state.networkId === n.id ? "border-primary bg-muted" : ""
                }`}
              >
                <div className="font-medium">{n.name}</div>
                <div className="text-xs text-muted-foreground">Tier: {n.tier}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="New network name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
          Create
        </Button>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import * as networksApi from "@/lib/api/networks";
import type { PackSummary } from "@/lib/api/networks";
import type { WizardState } from "../SetupWizard";

interface Props {
  state: WizardState;
  setState: React.Dispatch<React.SetStateAction<WizardState>>;
}

export function Step2Pack({ state, setState }: Props) {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!state.networkId) return;
    networksApi
      .getNetwork(state.networkId)
      .then((detail) => setPacks(detail.packs))
      .catch(console.error);
  }, [state.networkId]);

  async function handleCreate() {
    if (!newName.trim() || !state.networkId) return;
    setCreating(true);
    try {
      const p = await networksApi.createPack(state.networkId, newName.trim());
      setPacks((prev) => [...prev, p]);
      setState((s) => ({ ...s, packId: p.id }));
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Step 2: Choose a Pack</h2>

      {packs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {packs.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => setState((s) => ({ ...s, packId: p.id }))}
                className={`w-full text-left p-3 border rounded hover:bg-muted ${
                  state.packId === p.id ? "border-primary bg-muted" : ""
                }`}
              >
                <div className="font-medium">{p.name}</div>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <Input
          placeholder="New pack name"
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

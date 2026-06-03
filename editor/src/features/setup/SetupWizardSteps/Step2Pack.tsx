import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      // serverKeyId is not yet available at Step2 (generated in Step3); P7 will wire this properly
      const p = await networksApi.createPack(state.networkId, state.serverKeyId ?? "", newName.trim());
      setPacks((prev) => [...prev, p]);
      setState((s) => ({ ...s, packId: p.id }));
      setNewName("");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <h2
        className="display text-[20px] text-[var(--ink)]"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {t("setupWizard.step2.title")}
      </h2>

      {packs.length > 0 && (
        <ul className="flex flex-col gap-2">
          {packs.map((p) => {
            const isActive = state.packId === p.id;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setState((s) => ({ ...s, packId: p.id }))}
                  className={[
                    "flex w-full items-center justify-between gap-3 rounded-[14px] border px-4 py-3 text-left transition-colors",
                    isActive
                      ? "border-[var(--terra-line)] bg-[var(--terra-soft)]"
                      : "border-[var(--line)] bg-[var(--inset)] hover:border-[var(--line-strong)]",
                  ].join(" ")}
                >
                  <span className="text-[13.5px] font-semibold text-[var(--ink)]">{p.name}</span>
                  {isActive && (
                    <span className="text-[11px] font-bold uppercase tracking-[.14em] text-[var(--terra)]">
                      {t("setupWizard.selected")}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="field-label">{t("setupWizard.step2.newLabel")}</span>
        <div className="flex gap-2">
          <Input
            placeholder={t("setupWizard.step2.placeholder")}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Button variant="outline" onClick={handleCreate} disabled={creating || !newName.trim()}>
            {t("setupWizard.step2.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}

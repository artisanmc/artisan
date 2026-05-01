import { getStep } from "@/domain/stepPath";
import type { Action, Command, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useFlowSelectionStore } from "@/state/flowSelectionStore";
import { ActionEditor } from "./ActionEditor";
import { ConditionListEditor } from "./ConditionListEditor";
import { PropertyField } from "./PropertyField";

interface CommandPropertiesProps {
  packId: PackId;
  command: Command;
}

export function CommandProperties({ packId, command }: CommandPropertiesProps) {
  const setCommandField = useAccountStore((s) => s.setCommandField);
  const setCommandStep = useAccountStore((s) => s.setCommandStep);
  const setCommandIfCaseConditions = useAccountStore((s) => s.setCommandIfCaseConditions);
  const setCommandIfCaseMatch = useAccountStore((s) => s.setCommandIfCaseMatch);
  const sub = useFlowSelectionStore((s) => s.sub);

  // When a step in the command's tree is sub-selected, edit it inline.
  if (sub?.kind === "step" && sub.clickType === undefined && sub.stateIndex === undefined) {
    const step = getStep(command.steps, sub.path);
    if (!step) {
      return (
        <div className="rounded border border-zinc-800 border-dashed bg-zinc-900/50 px-2 py-3 text-[11px] text-zinc-500">
          Step no longer exists. Pick another in the flow canvas.
        </div>
      );
    }
    if (step.kind === "action") {
      const onChange = (next: Action) =>
        setCommandStep({
          packId,
          commandId: command.id,
          path: sub.path,
          step: { kind: "action", action: next },
        });
      return (
        <div className="flex flex-col gap-2 rounded border border-zinc-800 bg-zinc-900/40 p-2">
          <div className="flex items-center gap-2 text-[10px] text-zinc-500">
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono uppercase tracking-wide text-zinc-300">
              {step.action.type}
            </span>
            <span>command step</span>
          </div>
          <ActionEditor packId={packId} action={step.action} onChange={onChange} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-3 rounded border border-zinc-800 bg-zinc-900/40 p-2">
        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
          <span className="rounded bg-blue-500/20 px-1.5 py-0.5 font-mono uppercase tracking-wide text-blue-200">
            if
          </span>
          <span>command step · edit case conditions</span>
        </div>
        {step.cases.map((c, ci) => (
          <ConditionListEditor
            // biome-ignore lint/suspicious/noArrayIndexKey: case index stable
            key={ci}
            label={ci === 0 ? "if conditions" : `else if (#${ci}) conditions`}
            conditions={c.conditions}
            match={c.match ?? "all"}
            onMatchChange={(match) =>
              setCommandIfCaseMatch({
                packId,
                commandId: command.id,
                frames: sub.path.frames,
                ifStepIndex: sub.path.index,
                caseIndex: ci,
                match,
              })
            }
            emptyHint="(no conditions — always matches)"
            onChange={(conditions) =>
              setCommandIfCaseConditions({
                packId,
                commandId: command.id,
                frames: sub.path.frames,
                ifStepIndex: sub.path.index,
                caseIndex: ci,
                conditions,
              })
            }
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">id</div>
        <div className="font-mono text-xs text-zinc-400">{command.id}</div>
      </div>
      <PropertyField
        label="name"
        value={command.name}
        onChange={(v) =>
          setCommandField({ packId, commandId: command.id, field: "name", value: v })
        }
      />
      <PropertyField
        label="permission"
        value={command.permission ?? ""}
        placeholder="(none)"
        onChange={(v) =>
          setCommandField({ packId, commandId: command.id, field: "permission", value: v })
        }
      />
      <PropertyField
        label="description"
        value={command.description ?? ""}
        placeholder="(none)"
        multiline
        onChange={(v) =>
          setCommandField({ packId, commandId: command.id, field: "description", value: v })
        }
      />
    </div>
  );
}

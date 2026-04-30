import type { Pack } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { PropertyField } from "./PropertyField";

interface PackPropertiesProps {
  pack: Pack;
}

const sourceLabel = (source: Pack["source"]) =>
  source === "imported" ? "imported" : source === "forked" ? "forked" : "user";

const sourceColor = (source: Pack["source"]) =>
  source === "imported"
    ? "bg-blue-500/15 text-blue-300"
    : source === "forked"
      ? "bg-amber-500/15 text-amber-300"
      : "bg-emerald-500/15 text-emerald-300";

export function PackProperties({ pack }: PackPropertiesProps) {
  const setPackField = useAccountStore((s) => s.setPackField);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">id</div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-zinc-400">{pack.id}</span>
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${sourceColor(pack.source)}`}>
            {sourceLabel(pack.source)}
          </span>
        </div>
      </div>
      <PropertyField
        label="name"
        value={pack.name}
        onChange={(v) => setPackField({ packId: pack.id, field: "name", value: v })}
      />
      <PropertyField
        label="description"
        value={pack.description ?? ""}
        placeholder="(none)"
        multiline
        onChange={(v) => setPackField({ packId: pack.id, field: "description", value: v })}
      />
      <div className="text-[10px] text-zinc-500">
        {pack.menus.length} menus · {pack.commands.length} commands · {pack.templates.length}{" "}
        templates
      </div>
    </div>
  );
}

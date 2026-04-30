import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { useState } from "react";

const VANILLA_MATERIALS = [
  "DIAMOND",
  "DIAMOND_SWORD",
  "DIAMOND_PICKAXE",
  "IRON_INGOT",
  "IRON_PICKAXE",
  "GOLD_INGOT",
  "PAPER",
  "BOOK",
  "EMERALD",
  "NETHERITE_INGOT",
  "ENDER_PEARL",
  "BARRIER",
  "REDSTONE",
  "GOLDEN_APPLE",
  "ENCHANTED_BOOK",
  "EXPERIENCE_BOTTLE",
];

export const MATERIAL_DRAG_MIME = "application/x-interfaze-material";

interface MaterialChipProps {
  name: string;
}

function MaterialChip({ name }: MaterialChipProps) {
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MATERIAL_DRAG_MIME, name);
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.effectAllowed = "copy";
      }}
      className={cx(
        "shrink-0 cursor-grab select-none rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5",
        "font-mono text-xs hover:border-zinc-600 active:cursor-grabbing",
      )}
    >
      {name}
    </div>
  );
}

export function MaterialPalette() {
  const [search, setSearch] = useState("");
  const filtered = VANILLA_MATERIALS.filter((m) => m.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="shrink-0 text-xs uppercase text-zinc-500">Materials</div>
      <Input
        placeholder="Search…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-40 shrink-0"
      />
      <div className="flex flex-1 gap-1 overflow-x-auto">
        {filtered.map((m) => (
          <MaterialChip key={m} name={m} />
        ))}
      </div>
    </div>
  );
}

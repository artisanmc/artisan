import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { useDraggable } from "@dnd-kit/core";
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
];

function MaterialItem({ name }: { name: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `palette:${name}`,
    data: { kind: "material", material: name },
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cx(
        "cursor-grab rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 font-mono text-xs hover:border-zinc-600",
        isDragging && "opacity-50",
      )}
    >
      {name}
    </div>
  );
}

export function Palette() {
  const [search, setSearch] = useState("");
  const filtered = VANILLA_MATERIALS.filter((m) => m.toLowerCase().includes(search.toLowerCase()));
  return (
    <aside className="flex w-56 flex-col gap-2 border-r border-zinc-800 bg-zinc-950 p-3">
      <div className="text-xs uppercase text-zinc-500">Palette · Vanilla</div>
      <Input placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="flex flex-col gap-1 overflow-auto">
        {filtered.map((m) => (
          <MaterialItem key={m} name={m} />
        ))}
      </div>
    </aside>
  );
}

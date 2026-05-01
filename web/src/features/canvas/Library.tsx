import { Input } from "@/components/ui/input";
import { cx } from "@/lib/cx";
import { useState } from "react";
import { itemTextureUrl, knownMaterials } from "./itemTextures";

export const MATERIAL_DRAG_MIME = "application/x-interfaze-material";

interface ItemTileProps {
  name: string;
}

function ItemTile({ name }: ItemTileProps) {
  const url = itemTextureUrl(name);
  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(MATERIAL_DRAG_MIME, name);
        e.dataTransfer.setData("text/plain", name);
        e.dataTransfer.effectAllowed = "copy";
      }}
      title={name}
      className={cx(
        "group relative flex aspect-square cursor-grab select-none items-center justify-center",
        "rounded border border-zinc-800 bg-zinc-900 hover:border-zinc-600 active:cursor-grabbing",
      )}
    >
      {url ? (
        <img
          src={url}
          alt={name}
          draggable={false}
          className="pixelated h-3/4 w-3/4 object-contain"
          style={{ imageRendering: "pixelated" }}
        />
      ) : (
        <span className="text-[8px] text-zinc-400">{name.slice(0, 4)}</span>
      )}
      <span
        className={cx(
          "pointer-events-none absolute bottom-0 left-0 right-0 truncate rounded-b bg-black/60",
          "px-1 py-px text-center font-mono text-[8px] text-zinc-300 opacity-0 group-hover:opacity-100",
        )}
      >
        {name.toLowerCase()}
      </span>
    </div>
  );
}

export function Library() {
  const [search, setSearch] = useState("");
  const all = knownMaterials();
  const filtered = all.filter((m) => m.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex h-full flex-col gap-2">
      <Input
        placeholder="Search items…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="grid grid-cols-4 gap-1.5 overflow-y-auto pb-2">
        {filtered.map((m) => (
          <ItemTile key={m} name={m} />
        ))}
        {filtered.length === 0 && (
          <div className="col-span-4 py-4 text-center text-xs text-zinc-500">No items match.</div>
        )}
      </div>
    </div>
  );
}

import type { Menu, PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useState } from "react";
import { PropertyField } from "./PropertyField";

interface MenuPropertiesProps {
  packId: PackId;
  menu: Menu;
}

const ROWS_OPTIONS = [1, 2, 3, 4, 5, 6] as const;

export function MenuProperties({ packId, menu }: MenuPropertiesProps) {
  const setMenuField = useAccountStore((s) => s.setMenuField);
  const [rowsError, setRowsError] = useState<string | null>(null);

  const onRowsChange = (rows: 1 | 2 | 3 | 4 | 5 | 6) => {
    try {
      setMenuField({ packId, menuId: menu.id, field: "rows", value: rows });
      setRowsError(null);
    } catch (e) {
      setRowsError(e instanceof Error ? e.message : "rows change rejected");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">id</div>
        <div className="font-mono text-xs text-zinc-400">{menu.id}</div>
      </div>
      <PropertyField
        label="title"
        value={menu.title}
        onChange={(v) => setMenuField({ packId, menuId: menu.id, field: "title", value: v })}
      />
      <PropertyField
        label="permission"
        value={menu.permission ?? ""}
        placeholder="(none)"
        onChange={(v) => setMenuField({ packId, menuId: menu.id, field: "permission", value: v })}
      />
      <div>
        <div className="mb-1 text-[10px] uppercase text-zinc-500">rows</div>
        <div className="flex gap-1">
          {ROWS_OPTIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => onRowsChange(r)}
              className={
                r === menu.rows
                  ? "rounded border border-emerald-500 bg-emerald-900/40 px-2 py-1 text-xs"
                  : "rounded border border-zinc-700 px-2 py-1 text-xs hover:border-zinc-500"
              }
            >
              {r}
            </button>
          ))}
        </div>
        {rowsError && <div className="mt-1 text-[10px] text-red-400">{rowsError}</div>}
      </div>
    </div>
  );
}

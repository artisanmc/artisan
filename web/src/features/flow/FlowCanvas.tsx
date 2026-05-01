import type { PackId } from "@/domain/types";
import { useAccountStore } from "@/state/accountStore";
import { useSelectionStore } from "@/state/selectionStore";

interface FlowCanvasProps {
  packId: PackId;
}

/**
 * Bottom canvas. Shows the structure of the currently selected element or
 * command — states, click handlers, action chains. This is phase-1 scaffold:
 * detect what's selected and render a placeholder. Subsequent phases will
 * fill in the actual flow tree and editing affordances.
 */
export function FlowCanvas({ packId }: FlowCanvasProps) {
  const ids = useSelectionStore((s) => s.ids);
  const pack = useAccountStore((s) => s.account.packs.find((p) => p.id === packId));

  if (!pack) return <EmptyHint label="Pack not found." />;
  if (ids.size === 0) {
    return <EmptyHint label="Select an element or command to edit its flow." />;
  }
  if (ids.size > 1) {
    return <EmptyHint label="Flow editing is per-button — narrow the selection." />;
  }

  const id = [...ids][0]!;
  // Resolve what kind of entity is selected.
  const command = pack.commands.find((c) => c.id === id);
  if (command) {
    return <PlaceholderHeader title={`Command · ${command.name}`} subtitle="action flow" />;
  }
  for (const menu of pack.menus) {
    for (const layer of menu.layers) {
      const el = layer.elements.find((e) => e.id === id);
      if (el) {
        const material = el.appearances[0]?.material ?? "(empty)";
        return (
          <PlaceholderHeader
            title={`Element · ${material}`}
            subtitle={`${menu.title} · ${el.positions}`}
          />
        );
      }
    }
  }
  // Could be a menu id — flow canvas isn't relevant for menus.
  if (pack.menus.some((m) => m.id === id)) {
    return <EmptyHint label="Menu selected — click an item or command to edit its flow." />;
  }
  return <EmptyHint label="Selection has no flow." />;
}

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 text-xs text-zinc-500">
      {label}
    </div>
  );
}

function PlaceholderHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex h-full flex-col bg-zinc-950">
      <div className="border-zinc-800 border-b bg-zinc-900 px-3 py-2">
        <div className="font-mono text-xs text-zinc-200">{title}</div>
        <div className="text-[10px] text-zinc-500">{subtitle}</div>
      </div>
      <div className="flex flex-1 items-center justify-center text-xs text-zinc-600">
        Flow editor coming next phase.
      </div>
    </div>
  );
}

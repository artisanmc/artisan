import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Pack } from "@/domain/types";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";

interface PackCardProps {
  pack: Pack;
}

export function PackCard({ pack }: PackCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: pack.id,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const sourceLabel =
    pack.source === "imported" ? "imported" : pack.source === "forked" ? "forked" : "user";
  const sourceColor =
    pack.source === "imported"
      ? "bg-blue-500/15 text-blue-300"
      : pack.source === "forked"
        ? "bg-amber-500/15 text-amber-300"
        : "bg-emerald-500/15 text-emerald-300";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`pack-card-${pack.id}`}
    >
      <Link to="/pack/$packId" params={{ packId: pack.id }}>
        <Card className="cursor-pointer transition-colors hover:border-emerald-600">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-mono text-base">
              {pack.name}
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${sourceColor}`}>
                {sourceLabel}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-zinc-400">
            {pack.menus.length} menus · {pack.commands.length} cmds
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}

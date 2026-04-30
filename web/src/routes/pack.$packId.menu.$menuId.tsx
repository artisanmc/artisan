import type { MenuId, PackId } from "@/domain/types";
import { MenuEditor } from "@/features/menu-editor/MenuEditor";
import { createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId/menu/$menuId")({
  component: MenuEditorPage,
});

function MenuEditorPage() {
  const { packId, menuId } = useParams({ from: "/pack/$packId/menu/$menuId" });
  return <MenuEditor packId={packId as PackId} menuId={menuId as MenuId} />;
}

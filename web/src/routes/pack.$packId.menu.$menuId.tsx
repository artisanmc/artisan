import { Link, createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId/menu/$menuId")({
  component: MenuEditorPage,
});

function MenuEditorPage() {
  const { packId, menuId } = useParams({ from: "/pack/$packId/menu/$menuId" });
  return (
    <div className="p-8">
      <h1 className="mb-4 font-semibold text-2xl">Menu editor: {menuId}</h1>
      <Link to="/pack/$packId" params={{ packId }} className="underline">
        ← back to pack
      </Link>
    </div>
  );
}

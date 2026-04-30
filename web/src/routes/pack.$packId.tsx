import { Link, createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/pack/$packId")({
  component: PackCanvasPage,
});

function PackCanvasPage() {
  const { packId } = useParams({ from: "/pack/$packId" });
  return (
    <div className="p-8">
      <h1 className="mb-4 font-semibold text-2xl">Pack: {packId}</h1>
      <Link to="/" className="underline">
        ← back
      </Link>
      <div className="mt-4">
        <Link
          to="/pack/$packId/menu/$menuId"
          params={{ packId, menuId: "m_profile" }}
          className="underline"
        >
          Open profile menu
        </Link>
      </div>
    </div>
  );
}

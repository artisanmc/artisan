import { createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/workspace/$workspaceId/element/$elementId")({
  component: ElementFocusPage,
});

function ElementFocusPage() {
  const { workspaceId, elementId } = useParams({ from: "/workspace/$workspaceId/element/$elementId" });
  return (
    <div style={{ padding: 24 }}>
      <p>Focus mode placeholder</p>
      <p>workspace: {workspaceId}</p>
      <p>element: {elementId}</p>
    </div>
  );
}

export default ElementFocusPage;

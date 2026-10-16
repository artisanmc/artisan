import { resolveModule } from "@/distribution/resolveModule";
import { useModulesStore } from "@/state/modulesStore";
import { createFileRoute, useParams } from "@tanstack/react-router";

export const Route = createFileRoute("/m/$moduleId")({ component: ModuleHost });

function ModuleHost() {
  const { moduleId } = useParams({ from: "/m/$moduleId" });
  // Subscribe to status so the host re-renders when async integration settles.
  const status = useModulesStore((s) => s.status);
  const r = resolveModule(moduleId, status);

  if (r.kind === "loading") {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-mut)]">
        Loading module…
      </div>
    );
  }
  if (r.kind === "missing") {
    return (
      <div className="flex flex-1 items-center justify-center text-[var(--text-mut)]">
        Module not available on this server.
      </div>
    );
  }
  const Cmp = r.component;
  return <Cmp />;
}

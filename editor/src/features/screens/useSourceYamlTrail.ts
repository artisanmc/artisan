import { useDocumentTrailStore } from "@/state/documentTrailStore";
import { useEffect, useState } from "react";

/**
 * The topbar's breadcrumb for a page over one data source file (a module's Config screen, a
 * Project's own source): its label after the project, and the switch to its YAML, like a
 * Document's (`DocumentView`). Returns whether the YAML is shown; off when there is no file.
 */
export function useSourceYamlTrail({
  label,
  relPath,
  toProject,
}: {
  label: string | undefined;
  relPath: string | null;
  toProject: () => void;
}): boolean {
  const setTrail = useDocumentTrailStore((s) => s.setTrail);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (label === undefined) return setTrail(null);
    setTrail({
      toProject,
      label,
      yaml: relPath ? { on, toggle: () => setOn((v) => !v), path: relPath } : undefined,
    });
  }, [setTrail, toProject, label, relPath, on]);
  useEffect(() => () => setTrail(null), [setTrail]);
  return on && relPath !== null;
}

import { getModule } from "@artisan/editor-sdk";
import type { ComponentType } from "react";

export type ModuleResolution =
  | { kind: "component"; component: ComponentType }
  | { kind: "loading" }
  | { kind: "missing" };

/** Resolve the host catch-all route to the active module's root component. */
export function resolveModule(
  moduleId: string,
  status: "idle" | "loading" | "ready" | "failed",
): ModuleResolution {
  const mod = getModule(moduleId);
  const rootRoute = mod?.routes[0];
  if (mod && rootRoute) {
    return { kind: "component", component: rootRoute.component };
  }
  // A failed load will not bring it: missing, not loading for good.
  return status === "ready" || status === "failed" ? { kind: "missing" } : { kind: "loading" };
}

/**
 * Legacy path. The Properties panel moved to `features/inspector/`; the state-card drop id
 * prefix is still read from here by the workspace drag-and-drop routing until that routing
 * moves to its own module (audit P1-2 / P2-5). Import from `@/lib/stateDropId`.
 */
export { STATE_DROP_PREFIX } from "@/lib/stateDropId";

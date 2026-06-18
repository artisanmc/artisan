export type ModuleEvent =
  | { kind: "config_reload"; module_id: string }
  | { kind: "data_reload"; data_source_ref: string };

type Listener = (e: ModuleEvent) => void;
const listeners: Map<string, Set<Listener>> = new Map();

export function onModuleEvent(kind: ModuleEvent["kind"], fn: Listener): () => void {
  if (!listeners.has(kind)) listeners.set(kind, new Set());
  listeners.get(kind)!.add(fn);
  return () => listeners.get(kind)!.delete(fn);
}

export function emitModuleEvent(e: ModuleEvent): void {
  for (const fn of listeners.get(e.kind) ?? []) fn(e);
}

export function clearModuleBus(): void {
  listeners.clear();
}

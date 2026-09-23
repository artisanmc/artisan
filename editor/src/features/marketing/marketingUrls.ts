const editorOrigin = import.meta.env.VITE_EDITOR_URL ?? "";

export function editorHref(path: string, origin = editorOrigin): string {
  return `${origin.replace(/\/$/, "")}${path}`;
}

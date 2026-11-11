/**
 * A module's stylesheet, injected once into the page under its id. A bundle loaded at
 * runtime was not scanned by the editor's Tailwind build, so it cannot count on utility
 * classes the editor itself does not use: it styles its own markup here, with class
 * names prefixed by its id and colours through `var(--token)`. The editor's design
 * system classes (`.btn`, `.input`, `.card`, `.chip`, `.field-label`…) are always there.
 */
export function injectModuleStyles(moduleId: string, css: string): void {
  if (typeof document === "undefined") return;
  const id = `artisan-module-style-${moduleId}`;
  let el = document.getElementById(id) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement("style");
    el.id = id;
    document.head.appendChild(el);
  }
  if (el.textContent !== css) el.textContent = css;
}
